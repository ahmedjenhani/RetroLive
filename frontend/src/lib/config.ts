interface AppConfig {
  /** Base URL of the API without a trailing slash. Empty string means "same origin". */
  apiUrl: string;
}

let config: AppConfig = { apiUrl: 'http://localhost:4000' };

/** The API address is read at runtime from /config.json, so one build works for every environment. */
export async function loadConfig(): Promise<void> {
  try {
    const response = await fetch('/config.json', { cache: 'no-store' });
    if (response.ok) {
      const json = (await response.json()) as Partial<AppConfig>;
      config = { apiUrl: String(json.apiUrl ?? config.apiUrl).replace(/\/+$/, '') };
    }
  } catch {
    // keep the default
  }
}

export const apiUrl = (): string => config.apiUrl;

/** Socket.IO connects to the API origin, or to this page's own origin when the API is proxied. */
export const socketUrl = (): string => config.apiUrl || window.location.origin;
