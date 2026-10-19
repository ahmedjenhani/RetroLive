import { errors } from '../util/errors';
import type { GenerateJsonRequest, LlmClient } from './llm';

export interface GeminiOptions {
  apiKey: string;
  model: string;
  fallbackModel?: string;
  baseUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Google Gemini (free tier). Tries the primary model first and falls back to a second one
 * when the first is rate limited, retired or failing.
 */
export class GeminiClient implements LlmClient {
  private readonly models: string[];
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GeminiOptions) {
    this.models = [options.model];
    if (options.fallbackModel && options.fallbackModel !== options.model) {
      this.models.push(options.fallbackModel);
    }
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generateJson({ system, user, schema }: GenerateJsonRequest): Promise<unknown> {
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.3 },
    });

    let quotaExhausted = false;
    for (const model of this.models) {
      try {
        const response = await this.fetchImpl(`${this.options.baseUrl}/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': this.options.apiKey },
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!response.ok) {
          quotaExhausted ||= response.status === 429;
          console.warn(`[gemini] model ${model} answered HTTP ${response.status}`);
          continue;
        }
        const json = (await response.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
          console.warn(`[gemini] model ${model} returned an empty answer`);
          continue;
        }
        return JSON.parse(text);
      } catch (err) {
        console.warn(`[gemini] model ${model} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (quotaExhausted) {
      throw errors.rateLimited(60, 'The free AI quota is used up for now. Please try again in a minute');
    }
    throw errors.aiUnavailable('The AI service is not reachable right now');
  }
}
