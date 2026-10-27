import type { AiConfig } from '../config';

// Provider-independent contract. The service depends only on this; adding a vendor means adding one class below.
export interface ChatTurn { role: 'user' | 'assistant'; content: string }
export interface AiRequest { system: string; messages: ChatTurn[]; maxTokens: number }
export interface AiProvider { readonly id: string; readonly label: string; readonly model: string; complete(req: AiRequest): Promise<{ text: string }> }
// `category` is all that is ever logged or shown: never the upstream body, the URL or any credential.
export type AiFailure = 'timeout' | 'upstream_error' | 'bad_response';
export class AiProviderError extends Error { constructor(public readonly category: AiFailure, public readonly upstreamStatus?: number) { super(category); } }
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

async function post(fetchImpl: FetchLike, url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal });
    if (!res.ok) throw new AiProviderError('upstream_error', res.status);
    try { return await res.json(); } catch { throw new AiProviderError('bad_response'); }
  } catch (e) {
    if (e instanceof AiProviderError) throw e;
    if (ctl.signal.aborted) throw new AiProviderError('timeout');
    throw new AiProviderError('upstream_error'); // network failure, DNS, TLS ...
  } finally { clearTimeout(timer); }
}
const textOf = (v: unknown): string => { if (typeof v !== 'string' || !v.trim()) throw new AiProviderError('bad_response'); return v.trim(); };

export class AnthropicProvider implements AiProvider {
  readonly id = 'anthropic';
  readonly label = 'Anthropic Claude';
  constructor(private readonly key: string, readonly model: string, private readonly baseUrl: string, private readonly timeoutMs: number, private readonly fetchImpl: FetchLike) {}
  async complete(req: AiRequest) {
    const data = (await post(this.fetchImpl, `${this.baseUrl}/v1/messages`, { 'x-api-key': this.key, 'anthropic-version': '2023-06-01' },
      { model: this.model, max_tokens: req.maxTokens, system: req.system, messages: req.messages }, this.timeoutMs)) as { content?: { type?: string; text?: unknown }[] };
    const block = Array.isArray(data?.content) ? data.content.find((b) => b?.type === 'text') : undefined;
    return { text: textOf(block?.text) };
  }
}
// Any server that speaks the OpenAI chat-completions format (OpenAI itself, or a local/open-source gateway such as Ollama or vLLM).
export class OpenAiCompatibleProvider implements AiProvider {
  readonly id = 'openai-compatible';
  readonly label = 'OpenAI-compatible model';
  constructor(private readonly key: string, readonly model: string, private readonly baseUrl: string, private readonly timeoutMs: number, private readonly fetchImpl: FetchLike) {}
  async complete(req: AiRequest) {
    const data = (await post(this.fetchImpl, `${this.baseUrl}/chat/completions`, { authorization: `Bearer ${this.key}` },
      { model: this.model, max_tokens: req.maxTokens, messages: [{ role: 'system', content: req.system }, ...req.messages] }, this.timeoutMs)) as { choices?: { message?: { content?: unknown } }[] };
    return { text: textOf(data?.choices?.[0]?.message?.content) };
  }
}
export function createAiProvider(cfg: AiConfig, fetchImpl: FetchLike = (url, init) => fetch(url, init)): AiProvider | null {
  if (!cfg.provider || !cfg.apiKey || !cfg.model) return null;
  if (cfg.provider === 'anthropic') return new AnthropicProvider(cfg.apiKey, cfg.model, cfg.baseUrl ?? 'https://api.anthropic.com', cfg.timeoutMs, fetchImpl);
  return cfg.baseUrl ? new OpenAiCompatibleProvider(cfg.apiKey, cfg.model, cfg.baseUrl, cfg.timeoutMs, fetchImpl) : null;
}
