// AG Studio LLM adapter for Claude (browser half). AG Studio ships no adapters; this implements
// AgLlmAdapter against our own /api/ai/claude route, which holds the Anthropic key and translates
// between Studio's conversation format and the Claude Messages API.

import type { AgAiEvent, AgLlmAdapter, AgLlmRequest, AgLlmResponse } from 'ag-studio';

type WireLine = { event: AgAiEvent } | { complete: AgLlmResponse } | { error: { code: string; message: string } };

export function claudeAdapter({ endpoint = '/api/ai/claude' }: { endpoint?: string } = {}): AgLlmAdapter {
  return {
    executeTurn(request: AgLlmRequest, options) {
      let resolve!: (r: AgLlmResponse) => void;
      const complete = new Promise<AgLlmResponse>((r) => (resolve = r));
      const failed = (message: string, code = 'error'): AgLlmResponse => ({ id: `err-${Date.now()}`, createdAt: Date.now(), output: [], status: 'failed', error: { code, message } });

      // Fetch lazily when Studio starts draining the stream, and resolve `complete` when it ends.
      async function* events(): AsyncGenerator<AgAiEvent> {
        let finished = false;
        try {
          const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: options?.signal });
          if (!res.ok || !res.body) {
            const j = await res.json().catch(() => ({}));
            resolve(failed(j?.error?.message ?? `Assistant request failed (${res.status})`, String(res.status)));
            finished = true;
            return;
          }
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = '';
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const parts = buf.split('\n\n');
            buf = parts.pop() ?? '';
            for (const part of parts) {
              if (!part.startsWith('data: ')) continue;
              const line = JSON.parse(part.slice(6)) as WireLine;
              if ('event' in line) yield line.event;
              else if ('complete' in line) {
                resolve(line.complete);
                finished = true;
              } else if ('error' in line) {
                resolve(failed(line.error.message, line.error.code));
                finished = true;
              }
            }
          }
        } catch (e) {
          if (!finished) resolve(options?.signal?.aborted ? { ...failed('Cancelled', 'cancelled'), status: 'cancelled' } : failed((e as Error).message));
          finished = true;
        } finally {
          if (!finished) resolve(failed('The assistant stream ended unexpectedly.'));
        }
      }

      return { stream: { [Symbol.asyncIterator]: () => events() }, complete };
    },
  };
}
