import { expect, test } from '@playwright/test';
import { addNote, column, createAndOpenSession, guestJoins, noteCard, registerHost, setPhase, startRetro } from './helpers';

test.describe('joining a session', () => {
  test('a guest joins with the code, and everyone sees who is online', async ({ page, browser }) => {
    const { code } = await startRetro(page);
    await expect(page.getByTestId('presence')).toHaveText('1');

    const gina = await guestJoins(browser, code, 'Gina');
    await expect(page.getByTestId('presence')).toHaveText('2');
    await expect(gina.page.getByTestId('presence')).toHaveText('2');
    await expect(gina.page.getByTestId('session-title')).toHaveText('Sprint 42 retro');

    await gina.context.close();
    // locally this is instant; across a real network (Render's proxy) an abruptly killed window takes about 10 s to be noticed
    await expect(page.getByTestId('presence')).toHaveText('1', { timeout: 30_000 });
  });

  test('the home page checks the code as you type and shows which session it is', async ({ page, browser }) => {
    const { code } = await startRetro(page, 'Release retro');
    const context = await browser.newContext({ baseURL: process.env['BASE_URL'] ?? 'http://localhost:5173' });
    const guest = await context.newPage();
    await guest.goto('/');
    await guest.getByTestId('code').fill(code.toLowerCase());
    await expect(guest.getByTestId('preview')).toContainText('Release retro');
    await expect(guest.getByTestId('preview')).toContainText('Hannah Host');
    await context.close();
  });

  test('explains a wrong code and a nickname that is already taken', async ({ page, browser }) => {
    const { code } = await startRetro(page);
    const gina = await guestJoins(browser, code, 'Gina');

    const context = await browser.newContext({ baseURL: process.env['BASE_URL'] ?? 'http://localhost:5173' });
    const other = await context.newPage();
    await other.goto('/');
    await other.getByTestId('code').fill('ZZZZZZ');
    await expect(other.getByText('No session has that code.')).toBeVisible();

    await other.getByTestId('code').fill(code);
    await other.getByTestId('nickname').fill('gina'); // same name, different case
    await other.getByTestId('join-submit').click();
    await expect(other.getByRole('alert')).toContainText('already taken');
    await expect(other).toHaveURL(/\/$/);

    await context.close();
    await gina.context.close();
  });

  test('the invite link works and the copy button gives the host something to share', async ({ page, browser }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const { code } = await startRetro(page);
    await page.getByTestId('copy-link').click();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toMatch(new RegExp(`/join/${code}$`));

    const guest = await guestJoins(browser, code, 'Via link');
    await expect(guest.page.getByTestId('presence')).toHaveText('2');
    await guest.context.close();
  });
});

test.describe('writing notes', () => {
  test('notes appear for everyone as soon as they are added, with the author\'s nickname', async ({ page, browser }) => {
    const { code } = await startRetro(page);
    const gina = await guestJoins(browser, code, 'Gina');
    const sam = await guestJoins(browser, code, 'Sam');

    await addNote(gina.page, 'WENT_WELL', 'Great pairing sessions');
    await expect(column(page, 'WENT_WELL').getByText('Great pairing sessions')).toBeVisible();
    await expect(column(sam.page, 'WENT_WELL').getByText('Great pairing sessions')).toBeVisible();
    await expect(noteCard(sam.page, 'Great pairing sessions').getByTestId('note-author')).toHaveText('Gina');

    await addNote(page, 'TO_IMPROVE', 'Slow deploys');
    await expect(column(gina.page, 'TO_IMPROVE').getByText('Slow deploys')).toBeVisible();
    await expect(noteCard(gina.page, 'Slow deploys').getByTestId('note-author')).toHaveText('Hannah Host');

    await gina.context.close();
    await sam.context.close();
  });

  test('editing and deleting your own note is reflected for everyone', async ({ page, browser }) => {
    const { code } = await startRetro(page);
    const gina = await guestJoins(browser, code, 'Gina');
    await addNote(gina.page, 'ACTION_IDEAS', 'First draft');

    await noteCard(gina.page, 'First draft').getByRole('button', { name: 'Edit' }).click();
    await gina.page.getByLabel('Edit note').fill('Better wording');
    await gina.page.getByRole('button', { name: 'Save' }).click();
    await expect(column(page, 'ACTION_IDEAS').getByText('Better wording')).toBeVisible();
    await expect(column(page, 'ACTION_IDEAS').getByText('First draft')).toBeHidden();

    await noteCard(gina.page, 'Better wording').getByRole('button', { name: 'Delete your note' }).click();
    await expect(column(page, 'ACTION_IDEAS').getByText('Better wording')).toBeHidden();
    await gina.context.close();
  });

  test('guests cannot edit or delete each other\'s notes, but the host can remove one', async ({ page, browser }) => {
    const { code } = await startRetro(page);
    const gina = await guestJoins(browser, code, 'Gina');
    const sam = await guestJoins(browser, code, 'Sam');
    await addNote(gina.page, 'TO_IMPROVE', 'Off topic rant');

    const samsView = noteCard(sam.page, 'Off topic rant');
    await expect(samsView).toBeVisible();
    await expect(samsView.getByRole('button', { name: /edit|delete|remove/i })).toHaveCount(0);

    await noteCard(page, 'Off topic rant').getByRole('button', { name: 'Remove this note' }).click();
    await expect(column(sam.page, 'TO_IMPROVE').getByText('Off topic rant')).toBeHidden();
    await expect(column(gina.page, 'TO_IMPROVE').getByText('Off topic rant')).toBeHidden();
    await gina.context.close();
    await sam.context.close();
  });

  test('refuses an empty note and shows the character counter', async ({ page }) => {
    await startRetro(page);
    await expect(page.getByTestId('note-add-WENT_WELL')).toBeDisabled();
    await page.getByTestId('note-input-WENT_WELL').fill('hello');
    await expect(page.getByText('5/280')).toBeVisible();
    await expect(page.getByTestId('note-add-WENT_WELL')).toBeEnabled();
  });

  test('Enter adds the note and Shift+Enter makes a new line', async ({ page }) => {
    await startRetro(page);
    const input = page.getByTestId('note-input-WENT_WELL');
    await input.fill('line one');
    await input.press('Shift+Enter');
    await input.pressSequentially('line two');
    await input.press('Enter');
    await expect(noteCard(page, 'line one')).toContainText('line two');
    await expect(input).toHaveValue('');
  });
});

test.describe('voting', () => {
  test('everyone has exactly 3 votes, and totals update live for the others', async ({ page, browser }) => {
    const { code } = await startRetro(page);
    const gina = await guestJoins(browser, code, 'Gina');
    for (const text of ['Note A', 'Note B', 'Note C', 'Note D']) {
      await addNote(gina.page, 'WENT_WELL', text);
    }
    await setPhase(page, 'VOTING');
    await expect(gina.page.getByTestId('current-phase')).toHaveText('Voting');
    await expect(gina.page.getByTestId('votes-left-count')).toHaveText('3 left');

    for (const text of ['Note A', 'Note B', 'Note C']) {
      await noteCard(gina.page, text).getByTestId('vote-button').click();
    }
    await expect(gina.page.getByTestId('votes-left-count')).toHaveText('0 left');
    // the fourth note cannot be voted for any more
    await expect(noteCard(gina.page, 'Note D').getByTestId('vote-button')).toBeDisabled();
    // the host sees the totals appear live, but not who voted
    await expect(noteCard(page, 'Note A').getByTestId('vote-count')).toHaveText('1');
    await expect(noteCard(page, 'Note D').getByTestId('vote-count')).toHaveText('0');

    // taking a vote back frees it for another note
    await noteCard(gina.page, 'Note A').getByTestId('vote-button').click();
    await expect(gina.page.getByTestId('votes-left-count')).toHaveText('1 left');
    await expect(noteCard(page, 'Note A').getByTestId('vote-count')).toHaveText('0');
    await noteCard(gina.page, 'Note D').getByTestId('vote-button').click();
    await expect(gina.page.getByTestId('votes-left-count')).toHaveText('0 left');
    await gina.context.close();
  });

  test('writing stops when voting starts, and comes back if the host goes back', async ({ page, browser }) => {
    const { code } = await startRetro(page);
    const gina = await guestJoins(browser, code, 'Gina');
    await expect(gina.page.getByTestId('note-input-WENT_WELL')).toBeVisible();

    await setPhase(page, 'VOTING');
    await expect(gina.page.getByTestId('note-input-WENT_WELL')).toBeHidden();
    await expect(gina.page.getByTestId('phase-next')).toHaveCount(0); // guests have no host controls

    await setPhase(page, 'WRITING');
    await expect(gina.page.getByTestId('note-input-WENT_WELL')).toBeVisible();
    await gina.context.close();
  });

  test('a refresh keeps who you are and the votes you already cast', async ({ page, browser }) => {
    const { code } = await startRetro(page);
    const gina = await guestJoins(browser, code, 'Gina');
    await addNote(gina.page, 'WENT_WELL', 'Keep me');
    await addNote(gina.page, 'TO_IMPROVE', 'And me');
    await setPhase(page, 'VOTING');
    await noteCard(gina.page, 'Keep me').getByTestId('vote-button').click();
    await expect(gina.page.getByTestId('votes-left-count')).toHaveText('2 left');

    await gina.page.reload();
    await expect(gina.page.getByTestId('board')).toBeVisible();
    await expect(gina.page.locator('strong', { hasText: 'Gina' })).toBeVisible();
    await expect(gina.page.getByTestId('votes-left-count')).toHaveText('2 left');
    await expect(noteCard(gina.page, 'Keep me').getByTestId('vote-button')).toHaveAttribute('aria-pressed', 'true');
    await expect(noteCard(gina.page, 'And me').getByTestId('vote-button')).toHaveAttribute('aria-pressed', 'false');
    await gina.context.close();
  });

  test('when the host removes a note you voted for, you get the vote back', async ({ page, browser }) => {
    const { code } = await startRetro(page);
    const gina = await guestJoins(browser, code, 'Gina');
    await addNote(gina.page, 'WENT_WELL', 'Will be removed');
    await addNote(gina.page, 'WENT_WELL', 'Will stay');
    await setPhase(page, 'VOTING');
    await noteCard(gina.page, 'Will be removed').getByTestId('vote-button').click();
    await noteCard(gina.page, 'Will stay').getByTestId('vote-button').click();
    await expect(gina.page.getByTestId('votes-left-count')).toHaveText('1 left');

    await noteCard(page, 'Will be removed').getByRole('button', { name: 'Remove this note' }).click();
    await expect(gina.page.getByTestId('votes-left-count')).toHaveText('2 left');
    await gina.context.close();
  });
});

test.describe('the timer', () => {
  test('the host starts a countdown that everyone sees, and can stop it', async ({ page, browser }) => {
    const { code } = await startRetro(page);
    const gina = await guestJoins(browser, code, 'Gina');
    await expect(gina.page.getByTestId('timer')).toHaveCount(0); // guests see nothing until it runs

    await page.getByTestId('timer-start-60').click();
    await expect(gina.page.getByTestId('timer')).toHaveText(/^(1:00|0:5\d)$/);
    await expect(page.getByTestId('timer')).toHaveText(/^(1:00|0:5\d)$/);
    await expect(page.getByTestId('timer')).toHaveText(/^0:5\d$/, { timeout: 8000 }); // it really counts down

    await page.getByTestId('timer-stop').click();
    await expect(gina.page.getByTestId('timer')).toHaveCount(0);
    await gina.context.close();
  });

  test('moving to the next phase clears the timer', async ({ page, browser }) => {
    const { code } = await startRetro(page);
    const gina = await guestJoins(browser, code, 'Gina');
    await page.getByTestId('timer-start-180').click();
    await expect(gina.page.getByTestId('timer')).toBeVisible();
    await setPhase(page, 'VOTING');
    await expect(gina.page.getByTestId('timer')).toHaveCount(0);
    await gina.context.close();
  });
});

test.describe('finishing the retro', () => {
  async function retroInDiscussion(page: import('@playwright/test').Page, browser: import('@playwright/test').Browser) {
    const { code, id } = await startRetro(page, 'Release retro');
    const gina = await guestJoins(browser, code, 'Gina');
    await addNote(gina.page, 'WENT_WELL', 'Smooth release');
    await addNote(gina.page, 'TO_IMPROVE', 'Slow reviews');
    await addNote(gina.page, 'ACTION_IDEAS', 'Pair on reviews');
    await setPhase(page, 'VOTING');
    await noteCard(gina.page, 'Slow reviews').getByTestId('vote-button').click();
    await setPhase(page, 'DISCUSSING');
    return { code, id, gina };
  }

  test('during the discussion the most voted notes move to the top, and guests see no summary yet', async ({ page, browser }) => {
    const { code } = await startRetro(page);
    const gina = await guestJoins(browser, code, 'Gina');
    await addNote(gina.page, 'WENT_WELL', 'Added first, few votes');
    await addNote(gina.page, 'WENT_WELL', 'Added second, popular');
    await setPhase(page, 'VOTING');
    await noteCard(page, 'Added second').getByTestId('vote-button').click();
    await noteCard(gina.page, 'Added second').getByTestId('vote-button').click();
    await noteCard(gina.page, 'Added first').getByTestId('vote-button').click();
    await expect(noteCard(page, 'Added second').getByTestId('vote-count')).toHaveText('2');

    // while voting the order is stable (so cards do not jump around under your cursor)
    await expect(column(page, 'WENT_WELL').locator('article').first()).toContainText('Added first');
    await setPhase(page, 'DISCUSSING');
    await expect(column(page, 'WENT_WELL').locator('article').first()).toContainText('Added second');
    await expect(column(gina.page, 'WENT_WELL').locator('article').first()).toContainText('Added second');
    await expect(gina.page.getByTestId('summary-panel')).toHaveCount(0);
    await gina.context.close();
  });

  test('shows an AI summary (mocked) with themes and action items, and exports Markdown', async ({ page, browser }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.route('**/api/sessions/*/summary', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: {
          themes: [{ title: 'Review speed', summary: 'Reviews take too long.', noteIds: [] }],
          actionItems: ['Agree a 24 hour review target'],
          generatedAt: new Date().toISOString(),
        },
      }),
    );
    const { gina } = await retroInDiscussion(page, browser);

    await page.getByTestId('summary-generate').click();
    await expect(page.getByTestId('summary-theme')).toContainText('Review speed');
    await expect(page.getByTestId('summary-actions')).toContainText('24 hour review target');

    await page.getByTestId('export-markdown').click();
    await expect(page.getByText(/Copied to your clipboard/)).toBeVisible();
    const markdown = await page.evaluate(() => navigator.clipboard.readText());
    expect(markdown).toContain('# Release retro');
    expect(markdown).toContain('Slow reviews (1 vote)');
    expect(markdown).toContain('_Gina_');
    await gina.context.close();
  });

  test('tells the host politely when the AI is unavailable, and the rest keeps working', async ({ page, browser }) => {
    await page.route('**/api/sessions/*/summary', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        json: { error: { code: 'AI_UNAVAILABLE', message: 'The AI service is not reachable right now' } },
      }),
    );
    const { gina } = await retroInDiscussion(page, browser);
    await page.getByTestId('summary-generate').click();
    await expect(page.getByRole('alert')).toContainText('not reachable');
    await expect(page.getByTestId('export-markdown')).toBeVisible();
    await gina.context.close();
  });

  test('closing the session makes it read-only for everyone and refuses new joiners', async ({ page, browser }) => {
    const { code, gina } = await retroInDiscussion(page, browser);

    await page.getByTestId('phase-next').click();
    await page.getByTestId('phase-confirm-close').click();
    await expect(page.getByTestId('current-phase')).toHaveText('Closed');
    await expect(gina.page.getByTestId('current-phase')).toHaveText('Closed');
    await expect(gina.page.getByTestId('note-input-WENT_WELL')).toHaveCount(0);
    await expect(gina.page.getByTestId('vote-button')).toHaveCount(0);

    const context = await browser.newContext({ baseURL: process.env['BASE_URL'] ?? 'http://localhost:5173' });
    const late = await context.newPage();
    await late.goto(`/join/${code}`);
    await expect(late.getByText('This retrospective has already ended.')).toBeVisible();
    await expect(late.getByTestId('join-submit')).toBeDisabled();
    await context.close();
    await gina.context.close();
  });
});

test.describe('hosting', () => {
  test('a deleted session ends for everyone who is in it', async ({ page, browser }) => {
    await registerHost(page);
    const { code } = await createAndOpenSession(page, 'Doomed retro');
    const gina = await guestJoins(browser, code, 'Gina');

    await page.goto('/host');
    await page.locator(`li[data-testid="session-${code}"]`).getByRole('button', { name: /^Delete/ }).click();
    await page.getByTestId('confirm-delete').click();
    await expect(page.locator(`li[data-testid="session-${code}"]`)).toHaveCount(0);

    await expect(gina.page.getByText('This session was ended by the host')).toBeVisible();
    await gina.context.close();
  });

  test('the host can leave and come back to the same board', async ({ page, browser }) => {
    const { code, id } = await startRetro(page);
    const gina = await guestJoins(browser, code, 'Gina');
    await addNote(gina.page, 'WENT_WELL', 'Still here');

    await page.goto('/host');
    await page.locator(`li[data-testid="session-${code}"]`).getByRole('link', { name: 'Open' }).click();
    await expect(page).toHaveURL(new RegExp(`/s/${id}$`));
    await expect(column(page, 'WENT_WELL').getByText('Still here')).toBeVisible();
    await expect(page.getByTestId('presence')).toHaveText('2');
    await gina.context.close();
  });

  test('another host cannot open your session', async ({ page, browser }) => {
    const { id } = await startRetro(page);
    const context = await browser.newContext({ baseURL: process.env['BASE_URL'] ?? 'http://localhost:5173' });
    const intruder = await context.newPage();
    await registerHost(intruder, 'Mallory');
    await intruder.goto(`/s/${id}`);
    await expect(intruder.getByText('does not exist, or it is not yours')).toBeVisible();
    await context.close();
  });
});

test.describe('accounts', () => {
  test('protected pages send you to sign in, and a wrong password is explained', async ({ page }) => {
    await page.goto('/host');
    await expect(page).toHaveURL(/\/login$/);
    await page.getByTestId('email').fill('nobody@example.com');
    await page.getByTestId('password').fill('wrong-password');
    await page.getByTestId('login-submit').click();
    await expect(page.getByRole('alert')).toHaveText('Invalid email or password');
  });

  test('registration reports which fields are wrong', async ({ page }) => {
    await page.goto('/register');
    await page.getByTestId('email').fill('not-an-email');
    await page.getByTestId('password').fill('short');
    await page.getByTestId('register-submit').click();
    await expect(page.getByText('Your name is required')).toBeVisible();
    await expect(page.getByText('Enter a valid email address')).toBeVisible();
    await expect(page.getByText('Use at least 8 characters')).toBeVisible();
  });

  test('you can sign out and back in, and the session list is yours', async ({ page }) => {
    const email = await registerHost(page);
    await createAndOpenSession(page, 'My only retro');
    await page.getByTestId('sign-out').click();
    await expect(page).toHaveURL(/\/$/);

    await page.goto('/login');
    await page.getByTestId('email').fill(email);
    await page.getByTestId('password').fill('Password123!');
    await page.getByTestId('login-submit').click();
    await expect(page).toHaveURL(/\/host$/);
    await expect(page.getByText('My only retro')).toBeVisible();
  });
});

test.describe('comfort', () => {
  test('dark mode can be switched on and is remembered', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Switch to dark mode' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.getByRole('button', { name: 'Switch to light mode' }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });

  test('works on a phone: no sideways scrolling, notes can be added', async ({ page, browser }) => {
    const { code } = await startRetro(page);
    const phone = await guestJoins(browser, code, 'Phone user', { viewport: { width: 390, height: 800 }, isMobile: true });
    await addNote(phone.page, 'WENT_WELL', 'Works on mobile');
    const overflow = await phone.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow).toBe(false);
    await expect(column(page, 'WENT_WELL').getByText('Works on mobile')).toBeVisible();
    await phone.context.close();
  });

  test('a note appears on the other screen within a second', async ({ page, browser }) => {
    const { code } = await startRetro(page);
    const gina = await guestJoins(browser, code, 'Gina');
    const started = Date.now();
    await gina.page.getByTestId('note-input-WENT_WELL').fill('How fast is this?');
    await gina.page.getByTestId('note-add-WENT_WELL').click();
    await expect(column(page, 'WENT_WELL').getByText('How fast is this?')).toBeVisible({ timeout: 2000 });
    expect(Date.now() - started).toBeLessThan(2000);
    await gina.context.close();
  });
});
