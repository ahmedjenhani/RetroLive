import { useCallback, useEffect, useState } from 'react';
import { readStorage, writeStorage } from './storage';

const KEY = 'retrolive.theme';

function initial(): boolean {
  const saved = readStorage(KEY);
  if (saved) {
    return saved === 'dark';
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export function useTheme(): { dark: boolean; toggle: () => void } {
  const [dark, setDark] = useState(initial);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  const toggle = useCallback(() => {
    setDark((current) => {
      writeStorage(KEY, current ? 'light' : 'dark');
      return !current;
    });
  }, []);

  return { dark, toggle };
}
