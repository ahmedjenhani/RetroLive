/** localStorage can be missing or throw (private mode, blocked data), so every access is guarded. */
export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // not persisted; the app still works until the page is reloaded
  }
}

export function readJson<T>(key: string): T | null {
  const raw = readStorage(key);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
