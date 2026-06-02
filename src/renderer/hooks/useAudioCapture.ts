/**
 * 麦克风采集 hook
 * - AudioContext @ 16kHz mono
 * - AudioWorklet 转 Int16 PCM
 * - 帧大小 40ms = 640 samples
 * - 通过 IPC 发送到主进程
 * - 同时上报 RMS 音量
 */
import { useEffect, useRef } from 'react';
import { useVoiceflowStore } from '@/store';

declare global {
  interface Window {
    voiceflow: {
      sendAudioFrame: (pcm: Uint8Array) => void;
      log?: (level: string, msg: string) => void;
      [k: string]: any;
    };
  }
}

const R = (level: string, msg: string) => {
  if (window.voiceflow?.log) window.voiceflow.log(level, msg);
  else console[level === 'error' ? 'error' : 'log'](msg);
};

const SAMPLE_RATE = 16000;
const FRAME_MS = 40;
const FRAME_SIZE = (SAMPLE_RATE * FRAME_MS) / 1000; // 640

// worklet 源码（inline 模式）
const WORKLET_CODE = `
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
`;

let workletBlobUrl: string | null = null;
function getWorkletUrl(): string {
  if (!workletBlobUrl) {
    const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
    workletBlobUrl = URL.createObjectURL(blob);
  }
  return workletBlobUrl;
}

export function useAudioCapture(active: boolean) {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!active) {
      cleanup();
      return;
    }
    let cancelled = false;
    R('info', '[audio] useAudioCapture active=true, requesting mic');
    start().catch((e) => {
      if (cancelled) return;
      R('error', `[audio] capture failed: ${e?.name} ${e?.message}`);
      useVoiceflowStore.getState().setError(
        `麦克风启动失败: ${e?.name || ''} ${e?.message || e}`
      );
      useVoiceflowStore.getState().setBubbleState('idle');
    });

    return () => {
      cancelled = true;
      cleanup();
    };

    async function start() {
      R('info', `[audio] calling getUserMedia @ ${SAMPLE_RATE}Hz mono`);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      R('info', `[audio] got stream, tracks=${stream.getTracks().length}`);
      streamRef.current = stream;

      const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioCtxRef.current = ctx;
      R('info', '[audio] AudioContext created');
      const url = getWorkletUrl();
      R('info', `[audio] worklet url: ${url.slice(0, 50)}...`);
      await ctx.audioWorklet.addModule(url);
      if (cancelled) {
        ctx.close();
        return;
      }
      R('info', '[audio] worklet module added');
      const source = ctx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(ctx, 'pcm-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        processorOptions: { frameSize: FRAME_SIZE },
      });
      workletRef.current = worklet;

      worklet.port.onmessage = (e) => {
        const { pcm, rms } = e.data;
        window.voiceflow.sendAudioFrame(new Uint8Array(pcm));
        useVoiceflowStore.getState().setMicVolume(rms);
      };

      source.connect(worklet);
      R('info', '[audio] source connected to worklet, capturing...');
    }

    function cleanup() {
      try {
        workletRef.current?.disconnect();
      } catch {}
      try {
        audioCtxRef.current?.close();
      } catch {}
      try {
        streamRef.current?.getTracks().forEach((t) => t.stop());
      } catch {}
      workletRef.current = null;
      audioCtxRef.current = null;
      streamRef.current = null;
      useVoiceflowStore.getState().setMicVolume(0);
    }
  }, [active]);
}
