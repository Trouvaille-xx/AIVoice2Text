/**
 * 腾讯云实时语音识别客户端
 * - WebSocket 协议 v2
 * - 客户端发送: 二进制音频帧 (pcm)
 * - 周期性发送: JSON {"type":"...","seq":...}
 * - 服务端返回: JSON {"code":0,"message":"...","voice_text_str":"...","result_type":...}
 */
import WebSocket from 'ws';
import { EventEmitter } from 'node:events';
import log from 'electron-log/main';
import { signTencentASR } from './signer';

export interface ASRConfig {
  appId: string;
  secretId: string;
  secretKey: string;
  engineType: '16k_zh' | '16k_zh-PY' | '16k_zh_en' | '16k_en';
}

export interface ASRPartialResult {
  text: string;
  seq: number;
}

export interface ASRFinalResult {
  text: string;
  durationMs: number;
}

export class TencentASRClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: ASRConfig;
  private seq = 0;
  private startTime = 0;
  private isClosed = false;
  private voiceId = '';
  private currentAccumText = '';
  // WS 还在握手时的音频帧缓冲：握手完成（onopen）后一次性回放
  // 解决"录音开始后 WS 慢 3~5s 才连上、用户首句音频被丢"的问题
  private pendingFrames: Buffer[] = [];
  private wsReady = false;
  // 缓冲上限：防止 WS 长时间连不上时把整段录音无限制堆在内存里
  // 16kHz 16bit mono = 32KB/s；8s 约 256KB，够覆盖一般网络抖动
  private static readonly MAX_PENDING_BYTES = 256 * 1024;

  constructor(config: ASRConfig) {
    super();
    this.config = config;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.voiceId = `vf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const url = signTencentASR({
          appId: this.config.appId,
          secretId: this.config.secretId,
          secretKey: this.config.secretKey,
          engineModelType: this.config.engineType,
          voiceFormat: 1, // pcm
          voiceId: this.voiceId,
        });

        log.info(`[ASR] connecting to ${url.slice(0, 80)}...`);

        this.ws = new WebSocket(url, {
          perMessageDeflate: false,
          headers: {
            'X-TC-Version': 'v2',
          },
        });

        this.ws.on('open', () => {
          this.startTime = Date.now();
          this.seq = 0;
          this.isClosed = false;
          this.wsReady = true;
          log.info(`[ASR] connected, voice_id=${this.voiceId} pending=${this.pendingFrames.length} frames`);
          // 把握手期间累积的音频一次性回放出去（按到达顺序）
          if (this.pendingFrames.length > 0) {
            const drained = this.pendingFrames.length;
            const bytes = this.pendingFrames.reduce((s, b) => s + b.length, 0);
            for (const frame of this.pendingFrames) {
              try {
                this.ws!.send(frame, { binary: true });
              } catch (e) {
                log.error('[ASR] drain pending frame error', e);
              }
            }
            this.pendingFrames = [];
            log.info(`[ASR] drained ${drained} pending frames (${bytes} bytes) after WS open`);
          }
          this.emit('open');
          resolve();
        });

        this.ws.on('message', (data) => {
          try {
            const text = data.toString('utf-8');
            if (!text) return;
            const msg = JSON.parse(text);
            log.info(`[ASR] recv: ${text.slice(0, 200)}`);

            if (msg.code !== 0) {
              log.error(`[ASR] server error: code=${msg.code} ${msg.message}`);
              this.emit('error', {
                code: String(msg.code),
                message: msg.message || 'ASR server error',
              });
              return;
            }

            // 检查 final 字段
            if (msg.final === 1) {
              log.info('[ASR] stream finished (final=1)');
              this.emit('final', {
                text: this.currentAccumText,
                durationMs: Date.now() - this.startTime,
              });
              this.currentAccumText = '';
              return;
            }

            // 解析 result
            const result = msg.result;
            if (result) {
              const sliceType = result.slice_type;
              const voiceText = result.voice_text_str || '';
              if (voiceText) {
                if (sliceType === 1) {
                  // partial (识别中)
                  this.emit('partial', {
                    text: voiceText,
                    seq: this.seq++,
                  });
                } else if (sliceType === 2) {
                  // 一段话结束
                  this.currentAccumText += voiceText;
                  this.emit('partial', {
                    text: this.currentAccumText,
                    seq: this.seq++,
                  });
                  // 触发 sentence_end 事件（用于自动停止录音）
                  this.emit('sentence_end');
                } else if (sliceType === 0) {
                  // 一段话开始（通常 text 为空）
                }
              }
            }

            // 兼容旧格式
            const resultType = msg.result_type ?? msg.ResultType;
            const voiceTextOld =
              msg.voice_text_str ?? msg.VoiceTextStr ?? msg.text ?? '';
            if (voiceTextOld && !result) {
              if (resultType === 1 || resultType === '1') {
                this.emit('final', {
                  text: voiceTextOld,
                  durationMs: Date.now() - this.startTime,
                });
              } else {
                this.emit('partial', {
                  text: voiceTextOld,
                  seq: this.seq++,
                });
              }
            }
          } catch (e) {
            log.error('[ASR] parse error', e);
          }
        });

        this.ws.on('error', (err) => {
          log.error('[ASR] ws error', err);
          this.emit('error', {
            code: 'WS_ERROR',
            message: err.message || 'WebSocket error',
          });
          if (this.ws?.readyState !== WebSocket.OPEN) {
            reject(err);
          }
        });

        this.ws.on('close', (code, reason) => {
          log.info(`[ASR] closed: ${code} ${reason.toString()}`);
          this.emit('close', { code, reason: reason.toString() });
        });
      } catch (e: any) {
        reject(e);
      }
    });
  }

  /** 发送音频帧 (16k 16bit mono PCM Buffer) */
  sendAudio(pcm: Buffer) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // WS 还在握手 → 暂存到 pendingFrames，onopen 时按顺序回放
      // 超过 MAX_PENDING_BYTES 后丢弃最旧帧（防 OOM）
      if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
        const currentBytes = this.pendingFrames.reduce((s, b) => s + b.length, 0);
        if (currentBytes + pcm.length > TencentASRClient.MAX_PENDING_BYTES) {
          // 丢最旧一帧腾位置
          this.pendingFrames.shift();
        }
        this.pendingFrames.push(pcm);
        return;
      }
      // WS 已关闭/异常 → 真正该 skip
      log.warn(`[ASR] skip audio frame: ws not open (readyState=${this.ws?.readyState})`);
      return;
    }
    try {
      this.ws.send(pcm, { binary: true });
    } catch (e) {
      log.error('[ASR] send audio error', e);
    }
  }

  /** 结束识别 */
  async stop(): Promise<void> {
    if (!this.ws || this.isClosed) {
      return;
    }
    // WS 还在握手 → 等握手完再发 end 标记（onopen 里会回放 pendingFrames）
    // 必须同时监听 error/close：若连接失败/被关，Promise 不能挂死
    // 否则 stopRecording() 会卡住直到 30s 兜底超时，期间所有音频都已丢
    if (this.ws.readyState === WebSocket.CONNECTING) {
      log.info('[ASR] stop() called during CONNECTING, waiting for onopen to send end');
      await new Promise<void>((resolve) => {
        let settled = false;
        const settle = (after?: () => Promise<void> | void) => {
          if (settled) return;
          settled = true;
          this.ws?.off('open', onOpen);
          this.ws?.off('error', onError);
          this.ws?.off('close', onClose);
          Promise.resolve(after?.()).finally(() => resolve());
        };
        const onOpen = () => {
          log.info('[ASR] stop(): WS opened, sending end marker');
          // onopen 已经回放过 pendingFrames；这里只发 end 标记
          settle(() => this.sendEndAndClose());
        };
        const onError = (err: Error) => {
          log.warn(`[ASR] stop(): WS error during connect: ${err.message}`);
          settle();
        };
        const onClose = (code: number, reason: Buffer) => {
          log.warn(`[ASR] stop(): WS closed during connect (code=${code} reason=${reason?.toString() || ''})`);
          settle();
        };
        this.ws!.once('open', onOpen);
        this.ws!.once('error', onError);
        this.ws!.once('close', onClose);
      });
      return;
    }
    if (this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.isClosed = true;
    return this.sendEndAndClose();
  }

  private sendEndAndClose(): Promise<void> {
    return new Promise((resolve) => {
      const finish = () => {
        try {
          this.ws?.close();
        } catch {}
        this.ws = null;
        resolve();
      };
      try {
        this.ws!.send(
          JSON.stringify({ type: 'end' }),
          () => finish()
        );
      } catch {
        finish();
      }
    });
  }
}
