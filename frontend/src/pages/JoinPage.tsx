import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { LIMITS, PHASE_LABEL, type DemoResponse, type JoinPreview, type JoinResponse } from '@retrolive/shared';
import { Alert, Button, Card, Field, Input } from '../components/ui';
import { ApiError, api, errorText } from '../lib/api';
import { useAuth } from '../lib/auth';
import { lastNickname, rememberNickname, saveParticipant } from '../lib/participant';

const CODE_PATTERN = new RegExp(`^[A-Z0-9]{${LIMITS.JOIN_CODE_LENGTH}}$`);

export function JoinPage() {
  const { code: codeParam } = useParams();
  const navigate = useNavigate();
  const { user, signIn } = useAuth();
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);
  const [code, setCode] = useState((codeParam ?? '').toUpperCase());
  const [nickname, setNickname] = useState(lastNickname);
  const [preview, setPreview] = useState<JoinPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // Once the code looks complete, show which session it belongs to, so people know they typed it right.
  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    if (!CODE_PATTERN.test(code)) {
      return;
    }
    let cancelled = false;
    api<JoinPreview>(`/join/${code}`)
      .then((p) => !cancelled && setPreview(p))
      .catch((err: unknown) => {
        // Only a wrong code deserves a message here. If the server is unreachable, the join button reports it.
        if (!cancelled && err instanceof ApiError && err.status === 404) {
          setPreviewError('No session has that code.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const ended = preview?.phase === 'CLOSED';

  // A signed-in host does not need the demo, and starting one would sign them out of their own account.
  const offerDemo = !user || user.isDemo;

  async function startDemo() {
    setDemoBusy(true);
    setDemoError(null);
    try {
      const demo = await api<DemoResponse>('/demo', { method: 'POST' });
      signIn({ token: demo.token, user: demo.user });
      navigate(`/s/${demo.sessionId}`);
    } catch (err) {
      setDemoError(errorText(err));
    } finally {
      setDemoBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFields({});
    setBusy(true);
    try {
      const joined = await api<JoinResponse>('/join', { method: 'POST', body: { code, nickname } });
      rememberNickname(joined.participant.nickname);
      saveParticipant(joined.session.id, { token: joined.token, nickname: joined.participant.nickname, isHost: false });
      navigate(`/s/${joined.session.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        setFields(err.fields);
      }
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-5xl items-center gap-10 py-6 md:grid-cols-2 md:py-14">
      <section>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Run a retro your team will <span className="text-indigo-600 dark:text-indigo-400">actually enjoy</span>.
        </h1>
        <p className="mt-4 text-lg text-slate-600 dark:text-slate-400">
          Everyone adds notes and votes on the same live board, from their own device. No sign-up needed to take part.
        </p>
        <ul className="mt-6 space-y-2 text-sm text-slate-600 dark:text-slate-400">
          <li>Notes and votes appear instantly for everyone</li>
          <li>The host guides the session from writing to voting to discussion</li>
          <li>One click turns the notes into themes and action items with AI</li>
        </ul>
        <p className="mt-8 text-sm text-slate-600 dark:text-slate-400">
          Want to host one?{' '}
          <Link to="/register" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            Create a free account
          </Link>{' '}
          or{' '}
          <Link to="/login" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            sign in
          </Link>
          .
        </p>
      </section>

      <Card>
        <h2 className="text-xl font-semibold">Join a session</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Enter the code your host shared with you.</p>

        <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
          <Field label="Session code" error={fields['code']}>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, LIMITS.JOIN_CODE_LENGTH))}
              placeholder="ABC234"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="text-center font-mono text-lg uppercase tracking-[0.3em]"
              data-testid="code"
            />
          </Field>

          {preview && !ended && (
            <Alert tone="success">
              <span data-testid="preview">
                <strong>{preview.title}</strong>, hosted by {preview.hostName} ({PHASE_LABEL[preview.phase]})
              </span>
            </Alert>
          )}
          {ended && <Alert tone="error">This retrospective has already ended.</Alert>}
          {previewError && <Alert tone="error">{previewError}</Alert>}

          <Field label="Your nickname" error={fields['nickname']} hint="Shown next to the notes you write">
            <Input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={LIMITS.NICKNAME_MAX}
              placeholder="e.g. Sam"
              autoComplete="nickname"
              data-testid="nickname"
            />
          </Field>

          {error && Object.keys(fields).length === 0 && <Alert tone="error">{error}</Alert>}

          <Button
            type="submit"
            className="w-full"
            busy={busy}
            disabled={!CODE_PATTERN.test(code) || nickname.trim().length < LIMITS.NICKNAME_MIN || ended}
            data-testid="join-submit"
          >
            Join session
          </Button>
        </form>

        {offerDemo && (
          <div className="mt-6 border-t border-slate-200 pt-5 dark:border-slate-800">
            <p className="text-sm font-medium">Just looking around?</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Open a ready-made sample retro with a few teammates. No sign-up, and it is deleted after 24 hours.
            </p>
            {demoError && (
              <div className="mt-3">
                <Alert tone="error">{demoError}</Alert>
              </div>
            )}
            <Button variant="secondary" className="mt-3 w-full" busy={demoBusy} onClick={startDemo} data-testid="try-demo">
              Try a demo retro
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
