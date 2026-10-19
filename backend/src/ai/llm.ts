import { errors } from '../util/errors';

export interface GenerateJsonRequest {
  /** Trusted instructions written by us. */
  system: string;
  /** Untrusted content (the team's notes). Must be treated as data, never as instructions. */
  user: string;
  /** JSON schema the answer has to follow. */
  schema: Record<string, unknown>;
}

/** The only thing the rest of the app knows about the AI provider. */
export interface LlmClient {
  generateJson(request: GenerateJsonRequest): Promise<unknown>;
}

/** Used when no API key is configured: the summary button answers 503 and the rest of the app is unaffected. */
export class DisabledLlm implements LlmClient {
  async generateJson(): Promise<unknown> {
    throw errors.aiUnavailable('The AI summary is not configured on this server');
  }
}
