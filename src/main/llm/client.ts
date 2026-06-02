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
    const url = new URL('/chat/completions', this.config.baseURL);
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

        let buffer = '';
        res.on('data', (chunk) => {
          buffer += chunk.toString('utf-8');
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
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
                this.queueChunk(delta);
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
