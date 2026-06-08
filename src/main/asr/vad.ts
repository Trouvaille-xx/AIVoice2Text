/**
 * 双判据 VAD（Voice Activity Detection）：RMS + ZCR
 *
 * 不引入 silero-vad/onnxruntime 这种重依赖，直接对 PCM16 数据计算：
 *   1) RMS（能量）：语音帧能量明显高于静音
 *   2) ZCR（过零率）：语音帧过零率集中在 5-30/10ms，纯静音接近 0
 *
 * 双判据组合能区分：
 *   - 语音     ：RMS 高 + ZCR 中  ← 唯一判为语音
 *   - 静音     ：RMS 低 + ZCR 低
 *   - 键盘声   ：RMS 高（瞬态）+ ZCR 低   ← RMS 单判据会误判，加 ZCR 排除
 *   - 风扇/交流：RMS 中   + ZCR 极低     ← 同上
 *   - 音乐/噪声：RMS 中 + ZCR 极高        ← 一般不会出现，不专门处理
 *
 * 用法：
 *   const vad = new EnergyVAD();
 *   vad.pushFrame(pcm);
 *   const stats = vad.summary();  // { speechStartSample, speechEndSample, hasSpeech, ... }
 */
export interface VADConfig {
  sampleRate: number;        // 16000
  frameMs: number;           // 40
  /** 进入语音状态的 RMS 阈值（0~1） */
  speechRmsThreshold: number; // 0.012
  /** 退出语音状态的 RMS 阈值（必须 < speechRmsThreshold，避免抖动） */
  silenceRmsThreshold: number; // 0.008
  /** 最小过零率（语音帧的 ZCR 不会低于此值） */
  minZcr: number;            // 0.04 (~6.4/10ms @ 16kHz)
  /** 连续多少帧同时满足 RMS+ZCR 才认为开始说话（避免咔嗒声误触发） */
  minSpeechFrames: number;   // 3 (~120ms)
  /** 连续多少帧低于阈值才认为说话结束（保留自然停顿） */
  minSilenceFrames: number;  // 15 (~600ms)
  /** 语音段前后各保留多少 ms 静音 padding，避免截断首尾辅音 */
  paddingMs: number;         // 500
}

export const DEFAULT_VAD_CONFIG: VADConfig = {
  sampleRate: 16000,
  frameMs: 40,
  speechRmsThreshold: 0.012,
  silenceRmsThreshold: 0.008,
  minZcr: 0.04,
  minSpeechFrames: 3,
  minSilenceFrames: 15,
  paddingMs: 500,
};

export interface VADSummary {
  /** 第一个语音帧的采样索引（注意：用于字节偏移需 *2） */
  speechStartSample: number;
  /** 最后一个语音帧**之后**的采样索引（用于 slice 终点） */
  speechEndSample: number;
  /** 总采样数 */
  totalSamples: number;
  /** 语音帧占比 0~1 */
  speechRatio: number;
  /** 整段是否检测到任何语音 */
  hasSpeech: boolean;
}

export class EnergyVAD {
  private cfg: VADConfig;
  private samplesPerFrame: number;

  // 滑动窗口状态
  private aboveCount = 0;     // 连续超过阈值的帧数
  private belowCount = 0;     // 连续低于阈值的帧数
  private inSpeech = false;

  private speechStartFrame = -1;
  private speechEndFrame = -1;

  private totalFrames = 0;
  private speechFrames = 0;

  constructor(cfg: Partial<VADConfig> = {}) {
    this.cfg = { ...DEFAULT_VAD_CONFIG, ...cfg };
    this.samplesPerFrame = (this.cfg.sampleRate * this.cfg.frameMs) / 1000;
  }

  /** 推入一帧 PCM16 数据。返回是否检测到语音状态翻转。 */
  pushFrame(pcm: Buffer): { speechStarted: boolean; speechEnded: boolean } {
    const { rms, zcr } = analyzeFrame(pcm);
    this.totalFrames++;

    // 双判据：RMS 高 + ZCR 不太低 → 语音
    const isSpeechFrame = rms >= this.cfg.speechRmsThreshold && zcr >= this.cfg.minZcr;
    const isSilenceFrame = rms < this.cfg.silenceRmsThreshold;

    if (isSpeechFrame) {
      this.aboveCount++;
      this.belowCount = 0;
    } else if (isSilenceFrame) {
      this.belowCount++;
      this.aboveCount = 0;
    } else {
      // 中间态：缓慢衰减
      this.aboveCount = Math.max(0, this.aboveCount - 1);
      this.belowCount = Math.max(0, this.belowCount - 1);
    }

    let speechStarted = false;
    let speechEnded = false;

    if (!this.inSpeech && this.aboveCount >= this.cfg.minSpeechFrames) {
      this.inSpeech = true;
      this.speechStartFrame = this.totalFrames - this.cfg.minSpeechFrames;
      speechStarted = true;
    } else if (this.inSpeech && this.belowCount >= this.cfg.minSilenceFrames) {
      this.inSpeech = false;
      this.speechEndFrame = this.totalFrames - this.cfg.minSilenceFrames;
      speechEnded = true;
    }

    if (this.inSpeech) this.speechFrames++;
    return { speechStarted, speechEnded };
  }

  summary(): VADSummary {
    const totalSamples = this.totalFrames * this.samplesPerFrame;
    const endFrame = this.speechEndFrame >= 0
      ? this.speechEndFrame
      : (this.speechStartFrame >= 0 ? this.totalFrames : -1);

    const startSample = this.speechStartFrame >= 0
      ? Math.max(0, this.speechStartFrame * this.samplesPerFrame - (this.cfg.paddingMs * this.cfg.sampleRate) / 1000)
      : -1;
    const endSample = endFrame >= 0
      ? Math.min(totalSamples, endFrame * this.samplesPerFrame + (this.cfg.paddingMs * this.cfg.sampleRate) / 1000)
      : -1;

    return {
      speechStartSample: Math.floor(startSample),
      speechEndSample: Math.floor(endSample),
      totalSamples,
      speechRatio: this.totalFrames > 0 ? this.speechFrames / this.totalFrames : 0,
      hasSpeech: this.speechStartFrame >= 0,
    };
  }

  reset() {
    this.aboveCount = 0;
    this.belowCount = 0;
    this.inSpeech = false;
    this.speechStartFrame = -1;
    this.speechEndFrame = -1;
    this.totalFrames = 0;
    this.speechFrames = 0;
  }
}

/** 一帧分析：返回 RMS（0~1）和 ZCR（过零率，0~1） */
export function analyzeFrame(pcm: Buffer): { rms: number; zcr: number } {
  if (pcm.length < 4) return { rms: 0, zcr: 0 };
  const samples = pcm.length / 2;
  let sumSq = 0;
  let zeroCrossings = 0;
  let prevSample = pcm.readInt16LE(0);

  for (let i = 2; i < pcm.length; i += 2) {
    const s = pcm.readInt16LE(i);
    // 符号位变化算一次过零
    if ((s >= 0) !== (prevSample >= 0)) zeroCrossings++;
    prevSample = s;
    const f = s / 32768;
    sumSq += f * f;
  }
  // 首样本与 0 比较（避免漏算）
  if ((pcm.readInt16LE(0) >= 0) !== (0 >= 0)) zeroCrossings++;

  return {
    rms: Math.sqrt(sumSq / (samples - 1)),
    zcr: zeroCrossings / (samples - 1),
  };
}

/** 兼容旧接口 */
export function computeRMS(pcm: Buffer): number {
  return analyzeFrame(pcm).rms;
}
