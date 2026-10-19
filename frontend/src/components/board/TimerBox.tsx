import { useState } from 'react';
import { LIMITS, type Phase } from '@retrolive/shared';
import { formatCountdown, useCountdown } from '../../lib/time';
import { Button, cn } from '../ui';

const PRESETS = [
  { label: '1 min', seconds: 60 },
  { label: '3 min', seconds: 180 },
  { label: '5 min', seconds: 300 },
  { label: '10 min', seconds: 600 },
];

interface Props {
  endsAt: string | null;
  clockOffsetMs: number;
  isHost: boolean;
  phase: Phase;
  onStart: (seconds: number) => Promise<void>;
  onStop: () => Promise<void>;
}

/** A countdown everyone sees, driven by the server's clock. Only the host can start or stop it. */
export function TimerBox({ endsAt, clockOffsetMs, isHost, phase, onStart, onStop }: Props) {
  const left = useCountdown(endsAt, clockOffsetMs);
  const [busy, setBusy] = useState(false);
  const running = endsAt !== null;
  const over = running && left === 0;

  if (phase === 'CLOSED') {
    return null;
  }
  if (!running && !isHost) {
    return null;
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    await action();
    setBusy(false);
  }

  return (
    <section
      aria-label="Timer"
      className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900"
    >
      {running ? (
        <p
          role="timer"
          data-testid="timer"
          className={cn(
            'font-mono text-2xl font-bold tabular-nums',
            over ? 'text-rose-600 dark:text-rose-400' : left < 30_000 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-slate-100',
          )}
        >
          {over ? "Time's up" : formatCountdown(left)}
        </p>
      ) : (
        <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Timer</p>
      )}

      {isHost && (
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {!running &&
            PRESETS.map((p) => (
              <Button
                key={p.seconds}
                variant="secondary"
                small
                disabled={busy || p.seconds < LIMITS.TIMER_MIN_SECONDS}
                onClick={() => run(() => onStart(p.seconds))}
                data-testid={`timer-start-${p.seconds}`}
              >
                {p.label}
              </Button>
            ))}
          {running && (
            <Button variant="secondary" small disabled={busy} onClick={() => run(onStop)} data-testid="timer-stop">
              Stop timer
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
