import type { ApiErrorBody, ErrorCode } from '@retrolive/shared';
import { apiUrl } from './config';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK',
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  token?: string | null;
}

async function send(path: string, { method = 'GET', body, token }: RequestOptions): Promise<Response> {
  try {
    return await fetch(`${apiUrl()}/api${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(
      0,
      'NETWORK',
      'Cannot reach the server. It may be waking up (free hosting), please try again in a few seconds.',
    );
  }
}

async function failure(response: Response): Promise<ApiError> {
  try {
    const { error } = (await response.json()) as ApiErrorBody;
    return new ApiError(response.status, error.code, error.message, error.fields);
  } catch {
    return new ApiError(response.status, 'INTERNAL', 'The server had a problem. Please try again.');
  }
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(path, options);
  if (!response.ok) {
    throw await failure(response);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export async function apiText(path: string, token: string): Promise<string> {
  const response = await send(path, { token });
  if (!response.ok) {
    throw await failure(response);
  }
  return response.text();
}

export function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';
}
