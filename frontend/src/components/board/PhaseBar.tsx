import { useState } from 'react';
import { PHASES, PHASE_HINT, PHASE_LABEL, canTransition, type Phase } from '@retrolive/shared';
import { Button, cn } from '../ui';

const FORWARD_LABEL: Partial<Record<Phase, string>> = {
  WRITING: 'Start voting',
  VOTING: 'Move to discussion',
  DISCUSSING: 'Close session',
};
const BACK_LABEL: Partial<Record<Phase, string>> = {
  VOTING: 'Back to writing',
  DISCUSSING: 'Back to voting',
};

interface Props {
  phase: Phase;
  isHost: boolean;
  onSetPhase: (phase: Phase) => Promise<void>;
}

/** Shows where the session is and, for the host, the buttons that move it along. */
export function PhaseBar({ phase, isHost, onSetPhase }: Props) {
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const index = PHASES.indexOf(phase);
  const next = PHASES[index + 1];
  const back = PHASES[index - 1];
  const canNext = next !== undefined && canTransition(phase, next);
  const canBack = back !== undefined && canTransition(phase, back);

  async function go(target: Phase) {
    setBusy(true);
    setConfirmClose(false);
    await onSetPhase(target);
    setBusy(false);
  }

  return (
    <section aria-label="Session progress" className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <ol className="flex items-center gap-2">
        {PHASES.map((p, i) => (
          <li key={p} className="flex flex-1 items-center gap-2" aria-current={p === phase ? 'step' : undefined}>
            <span
              className={cn(
                'grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold',
                i < index && 'bg-indigo-600 text-white',
                i === index && 'bg-indigo-600 text-white ring-4 ring-indigo-200 dark:ring-indigo-900',
                i > index && 'bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
              )}
            >
              {i < index ? '✓' : i + 1}
            </span>
            <span
              className={cn(
                'hidden text-sm sm:inline',
                i === index ? 'font-semibold' : 'text-slate-500 dark:text-slate-400',
              )}
              data-testid={i === index ? 'current-phase' : undefined}
            >
              {PHASE_LABEL[p]}
            </span>
            {i < PHASES.length - 1 && (
              <span className={cn('h-0.5 flex-1', i < index ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-800')} />
            )}
          </li>
        ))}
      </ol>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <p className="mr-auto text-sm text-slate-600 dark:text-slate-400">
          <span className="font-semibold sm:hidden">{PHASE_LABEL[phase]}: </span>
          {PHASE_HINT[phase]}
        </p>
        {isHost && (
          <div className="flex flex-wrap items-center gap-2">
            {canBack && (
              <Button variant="secondary" small disabled={busy} onClick={() => go(back as Phase)} data-testid="phase-back">
                {BACK_LABEL[phase]}
              </Button>
            )}
            {canNext && next !== 'CLOSED' && (
              <Button small busy={busy} onClick={() => go(next as Phase)} data-testid="phase-next">
                {FORWARD_LABEL[phase]}
              </Button>
            )}
            {canNext && next === 'CLOSED' && !confirmClose && (
              <Button small variant="danger" onClick={() => setConfirmClose(true)} data-testid="phase-next">
                {FORWARD_LABEL[phase]}
              </Button>
            )}
            {canNext && next === 'CLOSED' && confirmClose && (
              <>
                <span className="text-sm text-slate-600 dark:text-slate-300">Nobody can add or vote after this.</span>
                <Button small variant="danger" busy={busy} onClick={() => go('CLOSED')} data-testid="phase-confirm-close">
                  Yes, close it
                </Button>
                <Button small variant="ghost" onClick={() => setConfirmClose(false)}>
                  Cancel
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
