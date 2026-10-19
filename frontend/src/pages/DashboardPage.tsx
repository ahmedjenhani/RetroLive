import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { LIMITS, PHASE_LABEL, type Phase, type SessionInfo, type SessionListItem } from '@retrolive/shared';
import { Alert, Badge, Button, Card, Input, Spinner, cn } from '../components/ui';
import { ApiError, api, errorText } from '../lib/api';
import { useAuth } from '../lib/auth';

export const PHASE_STYLE: Record<Phase, string> = {
  WRITING: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  VOTING: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  DISCUSSING: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
  CLOSED: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

export function DashboardPage() {
  const { token, user, logout } = useAuth();
  const [sessions, setSessions] = useState<SessionListItem[] | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const fail = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        logout(); // the token expired: back to the sign-in page
        return;
      }
      setError(errorText(err));
    },
    [logout],
  );

  useEffect(() => {
    api<SessionListItem[]>('/sessions', { token })
      .then(setSessions)
      .catch(fail);
  }, [token, fail]);

  async function create(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const created = await api<SessionInfo>('/sessions', { method: 'POST', body: { title }, token });
      setSessions((list) => [
        {
          id: created.id,
          title: created.title,
          code: created.code,
          phase: created.phase,
          createdAt: new Date().toISOString(),
          participantCount: 0,
          noteCount: 0,
        },
        ...(list ?? []),
      ]);
      setTitle('');
    } catch (err) {
      fail(err);
    } finally {
      setCreating(false);
    }
  }

  async function remove(id: string) {
    try {
      await api<void>(`/sessions/${id}`, { method: 'DELETE', token });
      setSessions((list) => (list ?? []).filter((s) => s.id !== id));
      setConfirmDelete(null);
    } catch (err) {
      fail(err);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-3xl font-bold tracking-tight">Hello, {user?.name}</h1>
      <p className="mt-1 text-slate-600 dark:text-slate-400">Create a session, share its code, and run your retro.</p>

      <Card className="mt-6">
        <form onSubmit={create} className="flex flex-col gap-3 sm:flex-row" noValidate>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={LIMITS.TITLE_MAX}
            placeholder="Session title, e.g. Sprint 42 retrospective"
            aria-label="Session title"
            data-testid="session-title"
          />
          <Button type="submit" busy={creating} disabled={title.trim().length === 0} data-testid="create-session">
            Create session
          </Button>
        </form>
      </Card>

      {error && (
        <div className="mt-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <h2 className="mt-8 mb-3 text-lg font-semibold">Your sessions</h2>
      {sessions === null && !error && (
        <div className="flex justify-center py-10 text-slate-400">
          <Spinner />
        </div>
      )}
      {sessions?.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 py-10 text-center text-slate-500 dark:border-slate-700 dark:text-slate-400">
          No sessions yet. Create your first one above.
        </p>
      )}
      <ul className="space-y-3">
        {sessions?.map((s) => (
          <li
            key={s.id}
            data-testid={`session-${s.code}`}
            className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate font-semibold">{s.title}</h3>
                <Badge className={cn(PHASE_STYLE[s.phase])}>{PHASE_LABEL[s.phase]}</Badge>
              </div>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Code <span className="font-mono font-semibold tracking-widest">{s.code}</span> · {s.participantCount}{' '}
                {s.participantCount === 1 ? 'person' : 'people'} · {s.noteCount} {s.noteCount === 1 ? 'note' : 'notes'} ·{' '}
                {new Date(s.createdAt).toLocaleDateString()}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {confirmDelete === s.id ? (
                <>
                  <span className="text-sm text-slate-600 dark:text-slate-300">Delete for good?</span>
                  <Button variant="danger" small onClick={() => remove(s.id)} data-testid="confirm-delete">
                    Yes, delete
                  </Button>
                  <Button variant="ghost" small onClick={() => setConfirmDelete(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Link
                    to={`/s/${s.id}`}
                    data-testid={`open-${s.code}`}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
                  >
                    Open
                  </Link>
                  <Button variant="ghost" small onClick={() => setConfirmDelete(s.id)} aria-label={`Delete ${s.title}`}>
                    Delete
                  </Button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
