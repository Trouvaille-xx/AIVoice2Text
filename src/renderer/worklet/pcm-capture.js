// 麦克风采集 AudioWorklet
// 接收 16kHz mono Float32 输入，输出 Int16 PCM 帧（40ms = 640 samples）
class PCMCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.frameSize = (options.processorOptions && options.processorOptions.frameSize) || 640;
    this.buffer = new Float32Array(this.frameSize);
    this.idx = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) return true;
    const ch = input[0];
    for (let i = 0; i < ch.length; i++) {
      this.buffer[this.idx++] = ch[i];
      if (this.idx >= this.frameSize) {
        const pcm = new Int16Array(this.frameSize);
        let sum = 0;
        for (let j = 0; j < this.frameSize; j++) {
          const s = Math.max(-1, Math.min(1, this.buffer[j]));
          pcm[j] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          sum += this.buffer[j] * this.buffer[j];
        }
        const rms = Math.sqrt(sum / this.frameSize);
        this.port.postMessage({ pcm: pcm.buffer, rms }, [pcm.buffer]);
        this.buffer = new Float32Array(this.frameSize);
        this.idx = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PCMCapture);
