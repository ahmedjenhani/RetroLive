import { useEffect, useState } from 'react';

/** Milliseconds left until `endsAt`, using the server's clock (offset = serverTime - browserTime). */
export function remainingMs(endsAt: string | null, clockOffsetMs: number, now: number = Date.now()): number {
  if (!endsAt) {
    return 0;
  }
  return Math.max(0, new Date(endsAt).getTime() - (now + clockOffsetMs));
}

/** 125000 -> "2:05" */
export function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Re-renders a few times a second while a timer runs, and returns the time left. */
export function useCountdown(endsAt: string | null, clockOffsetMs: number): number {
  const [left, setLeft] = useState(() => remainingMs(endsAt, clockOffsetMs));

  useEffect(() => {
    setLeft(remainingMs(endsAt, clockOffsetMs));
    if (!endsAt) {
      return;
    }
    const id = window.setInterval(() => setLeft(remainingMs(endsAt, clockOffsetMs)), 250);
    return () => window.clearInterval(id);
  }, [endsAt, clockOffsetMs]);

  return left;
}
