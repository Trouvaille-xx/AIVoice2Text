/**
 * 本地 ASR 客户端 (whisper.cpp 引擎)
 * - 录音期间累积 PCM(不实时转写)
 * - stop() 时: VAD 切尾 → 写临时 wav → spawn whisper-cli → 解析 stdout → emit final
 * - 事件同 TencentASRClient: 'final' | 'error' | 'close'(本地无 'partial' 流)
 * - forceKill(): 用于 startRecording 杀掉上一个还在跑转写的 session
 */
import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import log from 'electron-log/main';
import { EnergyVAD } from './vad';

export interface LocalASRConfig {
  modelPath: string;              // 绝对路径 (e.g. .../ggml-base.bin)
  language?: 'zh' | 'en' | 'auto';
  threads?: number;
}

export class LocalASRClient extends EventEmitter {
  private config: LocalASRConfig;
  private chunks: Buffer[] = [];        // 录音期间累积 PCM
  private proc: ChildProcess | null = null;
  private wavPath: string | null = null;
  private startTime = 0;
  private cancelled = false;
  private forceKilled = false;
  private vad = new EnergyVAD();

  constructor(config: LocalASRConfig) {
    super();
    this.config = { language: 'zh', threads: 4, ...config };
  }

  /**
   * 启动会话: 启动计时器 + 重置 VAD,不等任何外部握手
   * 之所以不立即 spawn whisper: 整个录音一次性 batch 喂更快、更准
   */
  async start(): Promise<void> {
    this.startTime = Date.now();
    this.chunks = [];
    this.cancelled = false;
    this.forceKilled = false;
    this.vad.reset();
    log.info(
      `[LocalASR] start, model=${path.basename(this.config.modelPath)}, ` +
        `lang=${this.config.language}, threads=${this.config.threads}`,
    );
    // 注意: 故意不在这里开引擎,等 stop() 才转写
  }

  /** 录音中: 累积 PCM 帧(同 TencentASRClient API) */
  sendAudio(pcm: Buffer) {
    if (this.cancelled) return;
    this.chunks.push(Buffer.from(pcm));
    this.vad.pushFrame(pcm);
  }

  /**
   * 结束识别: VAD 切尾 → 写 wav → spawn whisper-cli → emit final
   * - 调用后内部 cancelled = true, sendAudio 后续无效
   * - 转写成功: emit 'final' {text, durationMs} → emit 'close'
   * - 转写失败: emit 'error' {code, message} → emit 'close'
   * - forceKill 后: 只 emit 'close'
   */
  async stop(): Promise<void> {
    if (this.cancelled) return;
    this.cancelled = true;

    if (this.forceKilled) {
      log.info('[LocalASR] stop() called after forceKill, noop');
      this.emit('close');
      return;
    }

    if (this.chunks.length === 0) {
      log.info('[LocalASR] no audio captured, skip transcription');
      this.emit('final', { text: '', durationMs: 0 });
      this.emit('close');
      return;
    }

    // VAD 切尾: 拿有语音的 PCM 段(去掉首尾静音)
    const summary = this.vad.summary();
    const fullPcm = Buffer.concat(this.chunks);
    let trimmedPcm: Buffer;
    if (summary.hasSpeech && summary.speechStartSample >= 0 && summary.speechEndSample > summary.speechStartSample) {
      const startByte = Math.max(0, summary.speechStartSample * 2);
      const endByte = Math.min(fullPcm.length, summary.speechEndSample * 2);
      trimmedPcm = fullPcm.subarray(startByte, endByte);
      log.info(
        `[LocalASR] VAD trim: ${(fullPcm.length / 2 / 16000).toFixed(2)}s → ` +
          `${(trimmedPcm.length / 2 / 16000).toFixed(2)}s ` +
          `(${(summary.speechRatio * 100) | 0}% speech)`,
      );
    } else {
      trimmedPcm = fullPcm;
      log.warn('[LocalASR] VAD found no speech, transcribing full audio');
    }

    // 写 wav 到临时文件
    try {
      this.wavPath = path.join(app.getPath('temp'), `vf-${Date.now()}.wav`);
      await this.writeWav(trimmedPcm, this.wavPath);
      log.info(
        `[LocalASR] wav written: ${this.wavPath} (${(trimmedPcm.length / 1024).toFixed(1)} KB)`,
      );
    } catch (e: any) {
      log.error('[LocalASR] writeWav failed', e);
      this.emit('error', { code: 'WAV_WRITE_FAILED', message: `写 wav 失败: ${e.message}` });
      this.emit('close');
      return;
    }

    // 拿 whisper-cli 路径
    const binDir = app.isPackaged
      ? path.join(process.resourcesPath, 'bin')
      : path.join(__dirname, '../../bin');
    const whisperExe = path.join(binDir, 'whisper-cli.exe');

    // v1.8.6 命令行参数
    // --no-timestamps: 输出纯文本(不输出 [00:00:00.000 --> ...] 之类)
    // --no-prints: 关闭 progress stderr 噪声(memory: 默认就是 false, 显式声明保险)
    const args = [
      '-m', this.config.modelPath!,
      '-f', this.wavPath,
      '-l', this.config.language === 'auto' ? 'auto' : this.config.language!,
      '-t', String(this.config.threads),
      '--no-timestamps',
    ];

    log.info(`[LocalASR] spawn: ${whisperExe} ${args.join(' ')}`);

    try {
      this.proc = spawn(whisperExe, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (e: any) {
      log.error('[LocalASR] spawn threw', e);
      this.emit('error', { code: 'ENGINE_ERROR', message: `whisper-cli 启动失败: ${e.message}` });
      this.emit('close');
      await this.cleanup();
      return;
    }

    this.proc.on('error', (err) => {
      log.error('[LocalASR] process error', err);
      this.emit('error', { code: 'ENGINE_ERROR', message: `whisper-cli 进程错误: ${err.message}` });
    });

    let stdout = '';
    let stderr = '';
    this.proc.stdout?.on('data', (b: Buffer) => {
      stdout += b.toString('utf-8');
    });
    this.proc.stderr?.on('data', (b: Buffer) => {
      stderr += b.toString('utf-8');
    });

    await new Promise<void>((resolve) => {
      this.proc!.on('close', async (code) => {
        if (this.forceKilled) {
          log.info('[LocalASR] killed (force)');
          this.emit('close');
          await this.cleanup();
          resolve();
          return;
        }
        if (code !== 0) {
          log.error(
            `[LocalASR] whisper exit code=${code}, stderr=${stderr.slice(0, 300)}`,
          );
          this.emit('error', {
            code: 'ENGINE_FAILED',
            message: `whisper-cli 退出码 ${code}: ${stderr.slice(0, 100)}`,
          });
          this.emit('close');
          await this.cleanup();
          resolve();
          return;
        }

        // 解析 stdout: 每行一个 segment。 --no-timestamps 时是纯文本(可能多行)
        const text = stdout
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .join(' ')
          .trim();
        log.info(`[LocalASR] FINAL (${text.length} chars): "${text.slice(0, 100)}"`);
        this.emit('final', { text, durationMs: Date.now() - this.startTime });
        this.emit('close');
        await this.cleanup();
        resolve();
      });
    });
  }

  /**
   * 同步强制杀掉(用于 startRecording 杀掉上一个还在跑转写的 session)
   * 必须在 asrClient.stop() 之前调用
   */
  forceKill() {
    this.forceKilled = true;
    if (this.proc && !this.proc.killed) {
      log.info('[LocalASR] forceKill: killing pid');
      try {
        this.proc.kill('SIGKILL');
      } catch (e: any) {
        log.warn(`[LocalASR] forceKill kill failed: ${e.message}`);
      }
    }
  }

  private async cleanup() {
    if (this.wavPath) {
      try {
        await fs.unlink(this.wavPath);
      } catch {
        /* ignore */
      }
      this.wavPath = null;
    }
    this.proc = null;
  }

  /** 写 PCM16 mono 16kHz wav 文件 */
  private async writeWav(pcm: Buffer, outPath: string): Promise<void> {
    const dataSize = pcm.length;
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(16000, 24);
    header.writeUInt32LE(32000, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);
    await fs.writeFile(outPath, Buffer.concat([header, pcm]));
  }
}
