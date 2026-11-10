// Server half of AG Studio's Claude adapter (lib/ui/claude-adapter.ts). Studio's agent runtime runs
// in the browser and sends one AgLlmRequest per turn; this route translates it into a Claude
// Messages request (the key never leaves the server), streams Claude's reply back as AG-UI events,
// and ends with the assembled AgLlmResponse. Wire format: SSE lines of {event} | {complete} | {error}.

import Anthropic from '@anthropic-ai/sdk';
import type { AgAiConversationItem, AgAiEvent, AgAiOutputItem, AgAiToolSchema, AgLlmRequest, AgLlmResponse } from 'ag-studio';
import { audit, getDb } from '@/lib/db';
import { assertHourlyLimit, RateLimitError } from '@/lib/rate-limit';

const MAX_TOKENS = 8000;
type Msg = Anthropic.MessageParam;
type Block = Anthropic.ContentBlockParam;

function toClaude(request: AgLlmRequest): { system: string; messages: Msg[]; tools: Anthropic.Tool[] } {
  const system: string[] = request.instructions ? [request.instructions] : [];
  const messages: Msg[] = [];
  const push = (role: 'user' | 'assistant', blocks: Block[]) => {
    if (!blocks.length) return;
    const last = messages.at(-1);
    if (last && last.role === role) (last.content as Block[]).push(...blocks); // keep tool_use / tool_result pairs adjacent
    else messages.push({ role, content: blocks });
  };
  for (const item of request.input as AgAiConversationItem[]) {
    if (item.type === 'message' && item.kind === 'input') {
      const text = item.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('\n');
      if (item.role === 'system') system.push(text);
      else if (text) push('user', [{ type: 'text', text }]);
    } else if (item.type === 'message') {
      const text = item.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('');
      if (text) push('assistant', [{ type: 'text', text }]);
    } else if (item.type === 'function_call') {
      let input: unknown = {};
      try {
        input = item.arguments ? JSON.parse(item.arguments) : {};
      } catch {
        input = { raw: item.arguments };
      }
      push('assistant', [{ type: 'tool_use', id: item.callId, name: item.name, input: input as Record<string, unknown> }]);
    } else if (item.type === 'function_call_output') {
      push('user', [{ type: 'tool_result', tool_use_id: item.callId, content: item.output }]);
    }
    // Reasoning items are not replayed: Claude's thinking is bound to the model that produced it.
  }
  if (!messages.length || messages[0].role !== 'user') messages.unshift({ role: 'user', content: 'Continue.' });

  const tools = (request.tools ?? [])
    .filter((t: AgAiToolSchema & { kind?: string }) => t.kind !== 'provided')
    .map((t) => ({ name: t.name, description: t.description, input_schema: (t.parameters ?? { type: 'object', properties: {} }) as Anthropic.Tool.InputSchema }));
  if (request.responseFormat?.type === 'json') {
    const fmt = request.responseFormat as { name: string; description?: string; schema: unknown };
    system.push(`Reply with only a JSON object (${fmt.name}${fmt.description ? `: ${fmt.description}` : ''}) matching this JSON Schema, no prose:\n${JSON.stringify(fmt.schema)}`);
  }
  return { system: system.join('\n\n'), messages, tools };
}

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: { message: 'The assistant is not configured.' } }, { status: 503 });
  let request: AgLlmRequest;
  try {
    request = (await req.json()) as AgLlmRequest;
  } catch {
    return Response.json({ error: { message: 'Request body must be JSON.' } }, { status: 400 });
  }
  const db = getDb();
  try {
    assertHourlyLimit(db, 'ai.chat.turn', Number(process.env.AI_CHAT_MAX_TURNS_PER_HOUR ?? 120));
  } catch (e) {
    if (e instanceof RateLimitError) return Response.json({ error: { message: e.message } }, { status: 429 });
    throw e;
  }
  audit(db, 'human', 'ai.chat.turn', null, { tools: request.tools?.length ?? 0, items: request.input.length });

  const { system, messages, tools } = toClaude(request);
  const client = new Anthropic();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: { event: AgAiEvent } | { complete: AgLlmResponse } | { error: { code: string; message: string } }) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      try {
        const claude = client.messages.stream(
          {
            model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
            max_tokens: MAX_TOKENS,
            system,
            messages,
            ...(tools.length ? { tools, tool_choice: { type: request.toolChoice === 'none' ? 'none' : 'auto' } as Anthropic.ToolChoice } : {}),
            output_config: { effort: 'low' },
          } as Anthropic.MessageStreamParams,
          { signal: req.signal },
        );
        let msgId = 'msg';
        const blockIds: Record<number, { kind: 'text' | 'tool'; id: string }> = {};
        for await (const ev of claude) {
          if (ev.type === 'message_start') msgId = ev.message.id;
          else if (ev.type === 'content_block_start') {
            if (ev.content_block.type === 'text') {
              const id = `${msgId}-${ev.index}`;
              blockIds[ev.index] = { kind: 'text', id };
              send({ event: { type: 'TEXT_MESSAGE_START', messageId: id, role: 'assistant' } as AgAiEvent });
            } else if (ev.content_block.type === 'tool_use') {
              blockIds[ev.index] = { kind: 'tool', id: ev.content_block.id };
              send({ event: { type: 'TOOL_CALL_START', toolCallId: ev.content_block.id, toolCallName: ev.content_block.name } as AgAiEvent });
            }
          } else if (ev.type === 'content_block_delta') {
            const b = blockIds[ev.index];
            if (!b) continue;
            if (ev.delta.type === 'text_delta') send({ event: { type: 'TEXT_MESSAGE_CONTENT', messageId: b.id, delta: ev.delta.text } as AgAiEvent });
            else if (ev.delta.type === 'input_json_delta') send({ event: { type: 'TOOL_CALL_ARGS', toolCallId: b.id, delta: ev.delta.partial_json } as AgAiEvent });
          } else if (ev.type === 'content_block_stop') {
            const b = blockIds[ev.index];
            if (b?.kind === 'text') send({ event: { type: 'TEXT_MESSAGE_END', messageId: b.id } as AgAiEvent });
            if (b?.kind === 'tool') send({ event: { type: 'TOOL_CALL_END', toolCallId: b.id } as AgAiEvent });
          }
        }
        const final = await claude.finalMessage();
        const output: AgAiOutputItem[] = [];
        final.content.forEach((block, i) => {
          if (block.type === 'text' && block.text) {
            output.push({ id: `${final.id}-${i}`, kind: 'output', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'text', text: block.text, annotations: [] }] });
          } else if (block.type === 'tool_use') {
            output.push({ id: block.id, kind: 'output', type: 'function_call', callId: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}), status: 'completed' });
          }
        });
        const incomplete = final.stop_reason === 'max_tokens';
        send({
          complete: {
            id: final.id,
            createdAt: Date.now(),
            output,
            status: final.stop_reason === 'refusal' ? 'failed' : incomplete ? 'incomplete' : 'completed',
            ...(incomplete ? { incompleteDetails: { reason: 'max_output_tokens' as const } } : {}),
            ...(final.stop_reason === 'refusal' ? { error: { code: 'refusal', message: 'The model declined this request.' } } : {}),
            usage: { inputTokens: final.usage.input_tokens, outputTokens: final.usage.output_tokens, totalTokens: final.usage.input_tokens + final.usage.output_tokens },
            model: final.model,
          },
        });
      } catch (e) {
        if (!req.signal.aborted) {
          console.error('[ai] Claude turn failed:', e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : (e as Error).message);
          send({ error: { code: e instanceof Anthropic.APIError ? String(e.status) : 'error', message: 'The assistant could not answer. Please try again.' } });
        }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } });
}
