import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../lib/auth';
import { loadParticipant } from '../lib/participant';
import { JoinPage } from './JoinPage';

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

const fetchMock = vi.fn();

function renderAt(path: string) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<JoinPage />} />
          <Route path="/join/:code" element={<JoinPage />} />
          <Route path="/s/:id" element={<p>The live board</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('JoinPage', () => {
  it('keeps the button disabled until the code is complete and a nickname is typed', async () => {
    renderAt('/');
    const submit = screen.getByTestId('join-submit');
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByTestId('code'), 'abc23');
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByTestId('nickname'), 'Sam');
    expect(submit).toBeDisabled(); // code still one character short
    await userEvent.type(screen.getByTestId('code'), '4');
    fetchMock.mockImplementation(() => json({ title: 'Sprint 7', phase: 'WRITING', hostName: 'Hannah' }));
    await waitFor(() => expect(submit).toBeEnabled());
  });

  it('cleans up the code as you type: upper case, no stray characters, six at most', async () => {
    renderAt('/');
    await userEvent.type(screen.getByTestId('code'), 'a-b c2#34567');
    expect(screen.getByTestId('code')).toHaveValue('ABC234');
  });

  it('prefills the code from an invite link and shows which session it is', async () => {
    fetchMock.mockImplementation(() => json({ title: 'Sprint 7 retro', phase: 'WRITING', hostName: 'Hannah' }));
    renderAt('/join/abc234');
    expect(screen.getByTestId('code')).toHaveValue('ABC234');
    expect(await screen.findByTestId('preview')).toHaveTextContent('Sprint 7 retro');
    expect(screen.getByTestId('preview')).toHaveTextContent('Hannah');
  });

  it('says so when no session has that code', async () => {
    fetchMock.mockImplementation(() => json({ error: { code: 'NOT_FOUND', message: 'Session with that code not found' } }, 404));
    renderAt('/join/ZZZZZZ');
    expect(await screen.findByText('No session has that code.')).toBeInTheDocument();
  });

  it('refuses to join a session that has ended', async () => {
    fetchMock.mockImplementation(() => json({ title: 'Old retro', phase: 'CLOSED', hostName: 'Hannah' }));
    renderAt('/join/ABC234');
    await userEvent.type(screen.getByTestId('nickname'), 'Sam');
    expect(await screen.findByText('This retrospective has already ended.')).toBeInTheDocument();
    expect(screen.getByTestId('join-submit')).toBeDisabled();
  });

  it('joins, remembers who you are for a refresh, and opens the board', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return json(
          {
            token: 'participant-token',
            session: { id: 'sess-1', title: 'Sprint 7', code: 'ABC234', phase: 'WRITING', timerEndsAt: null, hostName: 'Hannah' },
            participant: { id: 'p-1', nickname: 'Sam', isHost: false },
          },
          201,
        );
      }
      return json({ title: 'Sprint 7', phase: 'WRITING', hostName: 'Hannah' });
    });
    renderAt('/join/ABC234');
    await userEvent.type(screen.getByTestId('nickname'), 'Sam');
    await userEvent.click(screen.getByTestId('join-submit'));

    expect(await screen.findByText('The live board')).toBeInTheDocument();
    expect(loadParticipant('sess-1')).toEqual({ token: 'participant-token', nickname: 'Sam', isHost: false });

    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
    expect(JSON.parse((post?.[1] as RequestInit).body as string)).toEqual({ code: 'ABC234', nickname: 'Sam' });
  });

  it('shows the server\'s reason when the nickname is taken, and stays on the page', async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? json({ error: { code: 'CONFLICT', message: 'That nickname is already taken in this session, pick another one' } }, 409)
        : json({ title: 'Sprint 7', phase: 'WRITING', hostName: 'Hannah' }),
    );
    renderAt('/join/ABC234');
    await userEvent.type(screen.getByTestId('nickname'), 'Sam');
    await userEvent.click(screen.getByTestId('join-submit'));
    expect(await screen.findByRole('alert')).toHaveTextContent('already taken');
    expect(screen.queryByText('The live board')).toBeNull();
  });

  it('explains a sleeping server instead of failing silently', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    renderAt('/join/ABC234');
    await userEvent.type(screen.getByTestId('nickname'), 'Sam');
    await userEvent.click(screen.getByTestId('join-submit'));
    expect(await screen.findByText(/waking up/)).toBeInTheDocument();
  });
});

describe('Try a demo', () => {
  const demoResponse = {
    token: 'demo-host-token',
    user: { id: 'u-demo', name: 'Demo Host', email: 'demo-1@demo.invalid', isDemo: true },
    sessionId: 'sess-demo',
  };

  it('starts a demo, signs the visitor in as its host, and opens the board', async () => {
    fetchMock.mockImplementation(() => json(demoResponse, 201));
    renderAt('/');
    await userEvent.click(screen.getByTestId('try-demo'));

    expect(await screen.findByText('The live board')).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith('/api/demo')).toBe(true);
    expect(init.method).toBe('POST');
    const stored = JSON.parse(localStorage.getItem('retrolive.auth') as string);
    expect(stored.token).toBe('demo-host-token');
    expect(stored.user.isDemo).toBe(true);
  });

  it('explains why when the demo is unavailable and stays on the page', async () => {
    fetchMock.mockImplementation(() =>
      json({ error: { code: 'RATE_LIMITED', message: 'You have started several demos already. Please try again in a while' } }, 429),
    );
    renderAt('/');
    await userEvent.click(screen.getByTestId('try-demo'));
    expect(await screen.findByRole('alert')).toHaveTextContent('several demos already');
    expect(screen.queryByText('The live board')).toBeNull();
    expect(localStorage.getItem('retrolive.auth')).toBeNull();
  });

  it('is not offered to a signed-in host, so it cannot replace their own account', () => {
    localStorage.setItem(
      'retrolive.auth',
      JSON.stringify({ token: 't', user: { id: 'u1', name: 'Real Host', email: 'host@example.com', isDemo: false } }),
    );
    renderAt('/');
    expect(screen.queryByTestId('try-demo')).toBeNull();
    expect(screen.getByTestId('join-submit')).toBeInTheDocument();
  });

  it('is still offered to someone who is already in a demo', () => {
    localStorage.setItem(
      'retrolive.auth',
      JSON.stringify({ token: 't', user: { id: 'u1', name: 'Demo Host', email: 'demo-1@demo.invalid', isDemo: true } }),
    );
    renderAt('/');
    expect(screen.getByTestId('try-demo')).toBeInTheDocument();
  });
});
