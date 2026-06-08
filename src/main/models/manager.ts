/**
 * 本地 ASR 模型管理
 * - 维护 4 格内置模型清单 (Tiny/Base/Small/Medium)
 * - 从 HF mirror (hf-mirror.com) 下载 ggml-{model}.bin
 * - 流式下载 + 进度推送
 * - 存储位置: app.getPath('userData')/models/
 */
import { app } from 'electron';
import { promises as fs, createWriteStream, existsSync } from 'node:fs';
import path from 'node:path';
import log from 'electron-log/main';
import type { LocalModelInfo, ModelDownloadProgress } from '@shared/types';

const HF_BASE = 'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main';

/** 4 格内置默认模型(UI 选哪个推哪个) */
export const BUILTIN_MODELS: LocalModelInfo[] = [
  {
    id: 'tiny',
    name: 'Tiny',
    displayName: '🤖 Whisper Tiny',
    filename: 'ggml-tiny.bin',
    sizeBytes: 77_700_000,
    url: `${HF_BASE}/ggml-tiny.bin`,
    description: '最快,准确度一般,适合命令词/短句',
  },
  {
    id: 'base',
    name: 'Base',
    displayName: '🤖 Whisper Base',
    filename: 'ggml-base.bin',
    sizeBytes: 148_000_000,
    url: `${HF_BASE}/ggml-base.bin`,
    description: '快,中英混合日常够用,推荐轻度使用',
  },
  {
    id: 'small',
    name: 'Small',
    displayName: '🤖 Whisper Small',
    filename: 'ggml-small.bin',
    sizeBytes: 488_000_000,
    url: `${HF_BASE}/ggml-small.bin`,
    description: '推荐,准确度高,大多数场景足够',
  },
  {
    id: 'medium',
    name: 'Medium',
    displayName: '🤖 Whisper Medium',
    filename: 'ggml-medium.bin',
    sizeBytes: 1_530_000_000,
    url: `${HF_BASE}/ggml-medium.bin`,
    description: '最慢,最高准确度,CPU 建议 8 核+',
  },
];

export class ModelManager {
  private modelsDir: string;
  private activeDownloads = new Map<string, AbortController>();

  constructor() {
    this.modelsDir = path.join(app.getPath('userData'), 'models');
  }

  async init() {
    await fs.mkdir(this.modelsDir, { recursive: true });
    log.info(`[models] init: dir=${this.modelsDir}`);
  }

  /** 列出所有内置模型(不查磁盘) */
  listAvailable(): LocalModelInfo[] {
    return BUILTIN_MODELS;
  }

  /** 列出已下载到磁盘的模型 */
  async listDownloaded(): Promise<
    Array<LocalModelInfo & { path: string; sizeOnDisk: number }>
  > {
    const out = [];
    for (const m of BUILTIN_MODELS) {
      const p = path.join(this.modelsDir, m.filename);
      try {
        const stat = await fs.stat(p);
        if (stat.isFile() && stat.size > 0) {
          out.push({ ...m, path: p, sizeOnDisk: stat.size });
        }
      } catch {
        /* 不存在 → 跳过 */
      }
    }
    return out;
  }

  /** 给 modelId 拿磁盘绝对路径(没下载返回 null) */
  getModelPath(id: string): string | null {
    const m = BUILTIN_MODELS.find((x) => x.id === id);
    return m ? path.join(this.modelsDir, m.filename) : null;
  }

  /** 同步检查: 某 id 是否已下载(用于 hot path 启动前快速判断) */
  isDownloaded(id: string): boolean {
    const p = this.getModelPath(id);
    if (!p) return false;
    try {
      return existsSync(p);
    } catch {
      return false;
    }
  }

  /**
   * 流式下载 + 进度回调
   * - 下载到 `<dest>.part`,完成后 rename 到 `<dest>`(原子替换)
   * - 失败 / 取消时清理 .part
   * - 同一 id 同时只能有一个下载
   */
  async download(
    id: string,
    onProgress: (p: ModelDownloadProgress) => void,
  ): Promise<string> {
    const m = BUILTIN_MODELS.find((x) => x.id === id);
    if (!m) throw new Error(`Unknown model: ${id}`);
    if (this.activeDownloads.has(id)) throw new Error('Already downloading');

    const dest = path.join(this.modelsDir, m.filename);
    const tmp = dest + '.part';
    const controller = new AbortController();
    this.activeDownloads.set(id, controller);

    try {
      log.info(`[models] download start: ${id} url=${m.url}`);
      const res = await fetch(m.url, { signal: controller.signal });
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }
      const total = Number(res.headers.get('content-length') || m.sizeBytes);
      const file = createWriteStream(tmp);
      const reader = res.body.getReader();
      let downloaded = 0;
      let lastProgressTime = 0;
      onProgress({
        modelId: id,
        state: 'downloading',
        bytesDownloaded: 0,
        totalBytes: total,
      });

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!file.write(value)) {
            await new Promise<void>((r) => file.once('drain', r));
          }
          downloaded += value.length;
          // 节流：最多每 200ms 发一次进度，避免 IPC 风暴
          const now = Date.now();
          if (now - lastProgressTime >= 200) {
            lastProgressTime = now;
            onProgress({
              modelId: id,
              state: 'downloading',
              bytesDownloaded: downloaded,
              totalBytes: total,
            });
          }
        }
      } finally {
        await new Promise<void>((r) => file.end(r));
      }

      // 原子替换
      await fs.rename(tmp, dest);
      const stat = await fs.stat(dest);
      log.info(
        `[models] download done: ${id} bytes=${stat.size} (${(stat.size / 1e6).toFixed(1)} MB)`,
      );
      onProgress({
        modelId: id,
        state: 'completed',
        bytesDownloaded: stat.size,
        totalBytes: stat.size,
      });
      return dest;
    } catch (e: any) {
      // 清理 .part
      try {
        await fs.unlink(tmp);
      } catch {
        /* ignore */
      }
      if (e?.name === 'AbortError') {
        log.info(`[models] download cancelled: ${id}`);
        onProgress({
          modelId: id,
          state: 'cancelled',
          bytesDownloaded: 0,
          totalBytes: 0,
        });
      } else {
        log.error(`[models] download failed: ${id} ${e?.message}`);
        onProgress({
          modelId: id,
          state: 'failed',
          bytesDownloaded: 0,
          totalBytes: 0,
          error: e?.message || String(e),
        });
      }
      throw e;
    } finally {
      this.activeDownloads.delete(id);
    }
  }

  /** 取消下载(同步触发 AbortController.abort) */
  cancel(id: string) {
    this.activeDownloads.get(id)?.abort();
  }

  /** 删除已下载模型 */
  async delete(id: string): Promise<boolean> {
    const p = this.getModelPath(id);
    if (!p) return false;
    try {
      await fs.unlink(p);
      log.info(`[models] deleted: ${id}`);
      return true;
    } catch (e: any) {
      log.warn(`[models] delete failed: ${id} ${e?.message}`);
      return false;
    }
  }
}
