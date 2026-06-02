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
          log.info(`[ASR] connected, voice_id=${this.voiceId}`);
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
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.isClosed) {
      return;
    }
    this.isClosed = true;
    return new Promise((resolve) => {
      const finish = () => {
        try {
          this.ws?.close();
        } catch {}
        this.ws = null;
        resolve();
      };
      // 发送结束标记
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
