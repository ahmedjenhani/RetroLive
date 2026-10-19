import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { COLUMNS, LIMITS, type Column, type JoinResponse, type NoteDto, type RetroSummary } from '@retrolive/shared';
import { PhaseBar } from '../components/board/PhaseBar';
import { NoteColumn } from '../components/board/NoteColumn';
import { SummaryPanel } from '../components/board/SummaryPanel';
import { TimerBox } from '../components/board/TimerBox';
import { Alert, Badge, Button, Card, Spinner, cn } from '../components/ui';
import { ApiError, api, apiText, errorText } from '../lib/api';
import { useAuth } from '../lib/auth';
import { forgetParticipant, loadParticipant, saveParticipant, type ParticipantCredentials } from '../lib/participant';
import { useSession, type ActionResult } from '../session/useSession';

const MIN_NOTES_FOR_SUMMARY = 3;

/** Free hosting can take a while to wake up, so say so instead of showing a silent spinner. */
function Waiting({ text }: { text: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setSlow(true), 4000);
    return () => window.clearTimeout(id);
  }, []);
  return (
    <div className="grid place-items-center gap-3 py-24 text-center text-slate-500 dark:text-slate-400">
      <Spinner />
      <p>{text}</p>
      {slow && <p className="max-w-sm text-sm">The server is waking up (free hosting). This can take up to a minute the first time.</p>}
    </div>
  );
}

export function BoardPage() {
  const { sessionId = '' } = useParams();
  const auth = useAuth();
  const [creds, setCreds] = useState<ParticipantCredentials | null>(() => loadParticipant(sessionId));
  const [enterError, setEnterError] = useState<string | null>(null);
  const reentered = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);

  const { state, clockOffsetMs, status, actions, applySummary } = useSession(creds?.token ?? null);

  // A signed-in host re-enters their own session (this also refreshes an expired participant token).
  useEffect(() => {
    if (creds || !auth.token || !sessionId || reentered.current) {
      return;
    }
    reentered.current = true;
    api<JoinResponse>(`/sessions/${sessionId}/enter`, { method: 'POST', token: auth.token })
      .then((res) => {
        const next = { token: res.token, nickname: res.participant.nickname, isHost: true };
        saveParticipant(sessionId, next);
        setCreds(next);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) {
          auth.logout();
        }
        setEnterError(err instanceof ApiError && err.status === 404 ? 'This session does not exist, or it is not yours.' : errorText(err));
      });
  }, [creds, auth, sessionId]);

  // An expired or invalid token: forget it, and a host will quietly get a new one.
  useEffect(() => {
    if (status === 'unauthorized') {
      forgetParticipant(sessionId);
      reentered.current = false;
      setCreds(null);
    }
  }, [status, sessionId]);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const id = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(id);
  }, [notice]);

  /** Runs an action and shows the server's reason if it was refused. */
  const run = useCallback(async (pending: Promise<ActionResult>): Promise<boolean> => {
    const result = await pending;
    if (!result.ok) {
      setNotice(result.error.message);
    }
    return result.ok;
  }, []);

  const notesByColumn = useMemo(() => {
    const notes = state?.notes ?? [];
    const closing = state?.session.phase === 'DISCUSSING' || state?.session.phase === 'CLOSED';
    const sort = (a: NoteDto, b: NoteDto) =>
      closing && b.voteCount !== a.voteCount ? b.voteCount - a.voteCount : a.createdAt.localeCompare(b.createdAt);
    return Object.fromEntries(COLUMNS.map((c) => [c, notes.filter((n) => n.column === c).sort(sort)])) as Record<Column, NoteDto[]>;
  }, [state?.notes, state?.session.phase]);

  async function generateSummary(): Promise<string | null> {
    try {
      // Everyone else gets the summary through the live connection; the host also shows it straight away.
      applySummary(await api<RetroSummary>(`/sessions/${sessionId}/summary`, { method: 'POST', token: auth.token }));
      return null;
    } catch (err) {
      return errorText(err);
    }
  }

  async function exportMarkdown(): Promise<string | null> {
    try {
      const markdown = await apiText(`/sessions/${sessionId}/export`, auth.token ?? '');
      try {
        await navigator.clipboard.writeText(markdown);
      } catch {
        const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }));
        const link = Object.assign(document.createElement('a'), { href: url, download: 'retrospective.md' });
        link.click();
        URL.revokeObjectURL(url);
      }
      return null;
    } catch (err) {
      return errorText(err);
    }
  }

  async function copyLink(code: string) {
    const link = `${window.location.origin}/join/${code}`;
    try {
      await navigator.clipboard.writeText(link);
      setNotice('Invite link copied. Send it to your team.');
    } catch {
      setNotice(`Invite link: ${link}`);
    }
  }

  // ---------------------------------------------------------------- not connected yet

  if (!creds && !auth.token) {
    return (
      <Card className="mx-auto mt-10 max-w-md text-center">
        <h1 className="text-xl font-semibold">You have not joined this session</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Ask the host for the session code, then join with a nickname.</p>
        <Link to="/" className="mt-5 inline-block rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500">
          Join a session
        </Link>
      </Card>
    );
  }
  if (enterError && !creds) {
    return (
      <div className="mx-auto mt-10 max-w-md space-y-4">
        <Alert tone="error">{enterError}</Alert>
        <Link to="/host" className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          Back to my sessions
        </Link>
      </div>
    );
  }
  if (status === 'ended') {
    return (
      <Card className="mx-auto mt-10 max-w-md text-center">
        <h1 className="text-xl font-semibold">This session was ended by the host</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">It has been deleted, so there is nothing more to see here.</p>
        <Link to="/" className="mt-5 inline-block text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          Back to the start
        </Link>
      </Card>
    );
  }
  if (!state) {
    return <Waiting text={creds ? 'Connecting to the board…' : 'Entering your session…'} />;
  }

  // ---------------------------------------------------------------- the live board

  const { session, me, summary } = state;
  const isHost = me.isHost;

  return (
    <div className="space-y-4" data-testid="board">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight" data-testid="session-title">
            {session.title}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Hosted by {session.hostName} · you are <strong>{me.nickname}</strong>
          </p>
        </div>

        {status === 'reconnecting' && <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">Reconnecting…</Badge>}
        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          <span className="mr-1.5 h-2 w-2 rounded-full bg-emerald-500" />
          <span data-testid="presence">{state.presence}</span>&nbsp;online
        </Badge>
        {session.phase !== 'CLOSED' && (
          <button
            type="button"
            onClick={() => copyLink(session.code)}
            data-testid="copy-link"
            title="Copy the invite link"
            className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700"
          >
            <span className="text-slate-500 dark:text-slate-400">Code</span>
            <span className="font-mono text-base font-bold tracking-[0.25em]" data-testid="join-code">
              {session.code}
            </span>
          </button>
        )}
      </div>

      {notice && (
        <div aria-live="polite">
          <Alert tone="info">{notice}</Alert>
        </div>
      )}

      <PhaseBar phase={session.phase} isHost={isHost} onSetPhase={async (phase) => void (await run(actions.setPhase(phase)))} />

      <div className="flex flex-wrap items-stretch gap-3">
        <div className="min-w-64 flex-1">
          <TimerBox
            endsAt={session.timerEndsAt}
            clockOffsetMs={clockOffsetMs}
            isHost={isHost}
            phase={session.phase}
            onStart={async (seconds) => void (await run(actions.startTimer(seconds)))}
            onStop={async () => void (await run(actions.stopTimer()))}
          />
        </div>
        {session.phase === 'VOTING' && (
          <div
            className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900"
            data-testid="votes-left"
            aria-label={`${me.votesLeft} votes left`}
          >
            <span className="text-sm font-medium text-slate-600 dark:text-slate-400">Your votes</span>
            <span className="flex gap-1.5">
              {Array.from({ length: LIMITS.MAX_VOTES }, (_, i) => (
                <span
                  key={i}
                  className={cn('h-4 w-4 rounded-full', i < me.votesLeft ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-700')}
                />
              ))}
            </span>
            <span className="text-sm font-semibold" data-testid="votes-left-count">
              {me.votesLeft} left
            </span>
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {COLUMNS.map((column) => (
          <NoteColumn
            key={column}
            column={column}
            notes={notesByColumn[column]}
            phase={session.phase}
            myId={me.participantId}
            isHost={isHost}
            myVotes={me.myVotes}
            votesLeft={me.votesLeft}
            onAdd={(c, text) => run(actions.addNote(c, text))}
            onEdit={(noteId, text) => run(actions.editNote(noteId, text))}
            onDelete={(noteId) => void run(actions.deleteNote(noteId))}
            onVote={(noteId) => void run(actions.vote(noteId))}
            onUnvote={(noteId) => void run(actions.unvote(noteId))}
          />
        ))}
      </div>

      <SummaryPanel
        summary={summary}
        notes={state.notes}
        phase={session.phase}
        isHost={isHost}
        noteCountEnough={state.notes.length >= MIN_NOTES_FOR_SUMMARY}
        onGenerate={generateSummary}
        onExport={exportMarkdown}
      />

      {isHost && session.phase === 'CLOSED' && (
        <div className="flex justify-center pt-2">
          <Link to="/host">
            <Button variant="secondary">Back to my sessions</Button>
          </Link>
        </div>
      )}
    </div>
  );
}
