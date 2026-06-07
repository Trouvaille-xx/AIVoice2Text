/**
 * LLM 客户端 (OpenAI 兼容协议)
 * - 支持流式 (SSE)
 * - 支持任意兼容 baseURL
 */
import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';
import log from 'electron-log/main';

export interface LLMConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
}

export class LLMClient {
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  /**
   * 流式优化文本
   * 返回 AsyncIterable<string>，每段是一个 delta
   */
  async *polishStream(text: string): AsyncIterable<string> {
    // 用相对路径，避免 baseURL 带路径时被覆盖（如 /v1）
    const url = new URL('chat/completions', this.config.baseURL.endsWith('/') ? this.config.baseURL : this.config.baseURL + '/');
    const body = JSON.stringify({
      model: this.config.model,
      messages: [
        { role: 'system', content: this.config.systemPrompt },
        { role: 'user', content: text },
      ],
      stream: true,
      temperature: 0.3,
    });

    const lib = url.protocol === 'https:' ? https : http;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
      Accept: 'text/event-stream',
    };

    log.info(`[LLM] POST ${url.toString()}`);

    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers,
      },
      (res) => {
        if (res.statusCode !== 200) {
          let errBody = '';
          res.on('data', (d) => (errBody += d.toString()));
          res.on('end', () => {
            log.error(`[LLM] HTTP ${res.statusCode}: ${errBody}`);
            this.queueError(
              new Error(`LLM HTTP ${res.statusCode}: ${errBody.slice(0, 200)}`)
            );
          });
          return;
        }

        // 实时过滤 <think>...</think> 标签
        let rawAccum = '';
        let lastVisibleLen = 0;
        const filterThink = (chunk: string): string | null => {
          rawAccum += chunk;
          // 去掉已闭合的 think 标签及内容，也去掉未闭合的（流式中间态）
          const visible = rawAccum
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/<think>[\s\S]*$/gi, '');
          // 只返回增量部分（避免每次发送完整文本造成前端抖动）
          if (visible.length > lastVisibleLen) {
            const delta = visible.slice(lastVisibleLen);
            lastVisibleLen = visible.length;
            return delta;
          }
          return null;
        };

        let sseBuffer = '';
        res.on('data', (chunk) => {
          sseBuffer += chunk.toString('utf-8');
          const lines = sseBuffer.split('\n');
          sseBuffer = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data:')) continue;
            const data = trimmed.slice(5).trim();
            if (data === '[DONE]') {
              this.queueDone();
              return;
            }
            try {
              const json = JSON.parse(data);
              const delta =
                json.choices?.[0]?.delta?.content ||
                json.choices?.[0]?.message?.content ||
                '';
              if (delta) {
                // 实时过滤 think，只输出可见内容
                const visible = filterThink(delta);
                if (visible) {
                  this.queueChunk(visible);
                }
              }
            } catch (e) {
              // ignore parse error
            }
          }
        });

        res.on('end', () => {
          this.queueDone();
        });

        res.on('error', (err) => {
          log.error('[LLM] response error', err);
          this.queueError(err);
        });
      }
    );

    req.on('error', (err) => {
      log.error('[LLM] request error', err);
      this.queueError(err);
    });

    req.write(body);
    req.end();

    // 消费队列
    yield* this.consume();
  }

  // ---- 内部队列（异步迭代） ----
  private queue: Array<
    | { type: 'chunk'; value: string }
    | { type: 'done' }
    | { type: 'error'; value: Error }
  > = [];
  private waiters: Array<(v: IteratorResult<string>) => void> = [];

  private queueChunk(v: string) {
    if (this.waiters.length) {
      this.waiters.shift()!({ value: v, done: false });
    } else {
      this.queue.push({ type: 'chunk', value: v });
    }
  }

  private queueDone() {
    if (this.waiters.length) {
      this.waiters.shift()!({ value: undefined as any, done: true });
    } else {
      this.queue.push({ type: 'done' });
    }
  }

  private queueError(e: Error) {
    if (this.waiters.length) {
      this.waiters.shift()!({ value: undefined as any, done: true });
    } else {
      this.queue.push({ type: 'error', value: e });
    }
  }

  private async *consume(): AsyncIterable<string> {
    while (true) {
      if (this.queue.length) {
        const item = this.queue.shift()!;
        if (item.type === 'done') return;
        if (item.type === 'error') {
          log.error('[LLM] stream error', item.value);
          return;
        }
        yield item.value;
      } else {
        const result = await new Promise<IteratorResult<string>>((res) => {
          this.waiters.push(res);
        });
        if (result.done) return;
        yield result.value;
      }
    }
  }
}
