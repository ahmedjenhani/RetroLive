import { expect, test } from '@playwright/test';
import { addNote, column, guestJoins, noteCard, registerHost, setPhase } from './helpers';

const NOTE_CARDS = 'article[data-testid^="note-"]';

test.describe('the "Try a demo" button', () => {
  test('a visitor gets a ready-made board in one click, with no sign-up', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('try-demo').click();

    await expect(page.getByTestId('board')).toBeVisible();
    await expect(page.getByTestId('session-title')).toHaveText('Sprint 42 retrospective (demo)');
    await expect(page.locator(NOTE_CARDS)).toHaveCount(11);
    await expect(page.getByTestId('current-phase')).toHaveText('Voting');
    await expect(page.getByTestId('votes-left-count')).toHaveText('3 left');
    await expect(page.getByTestId('presence')).toHaveText('1');
    // notes come from the teammates, with their nicknames
    await expect(noteCard(page, 'Deployments take over').getByTestId('note-author')).toHaveText('Gina');
    await expect(noteCard(page, 'Deployments take over').getByTestId('vote-count')).toHaveText('3');
    await expect(page.getByTestId('demo-tips')).toContainText('Things to try');
  });

  test('the visitor can really use it: vote (3 at most), discuss, get a summary, hide the tips', async ({ page }) => {
    await page.route('**/api/sessions/*/summary', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: {
          themes: [{ title: 'Slow delivery', summary: 'Deploys and reviews hold the team back.', noteIds: [] }],
          actionItems: ['Speed up the pipeline'],
          generatedAt: new Date().toISOString(),
        },
      }),
    );
    await page.goto('/');
    await page.getByTestId('try-demo').click();
    await expect(page.getByTestId('board')).toBeVisible();

    for (const text of ['Daily standups', 'Flaky tests', 'Try a no-meeting']) {
      await noteCard(page, text).getByTestId('vote-button').click();
    }
    await expect(page.getByTestId('votes-left-count')).toHaveText('0 left');
    await expect(noteCard(page, 'Cache dependencies').getByTestId('vote-button')).toBeDisabled();

    await setPhase(page, 'DISCUSSING');
    await page.getByTestId('summary-generate').click();
    await expect(page.getByTestId('summary-theme')).toContainText('Slow delivery');

    await page.getByRole('button', { name: 'Hide' }).click();
    await expect(page.getByTestId('demo-tips')).toHaveCount(0);
  });

  test('other people can join the demo with its code and see the board live', async ({ page, browser }) => {
    await page.goto('/');
    await page.getByTestId('try-demo').click();
    await expect(page.getByTestId('board')).toBeVisible();
    const code = (await page.getByTestId('join-code').textContent())!.trim();

    const friend = await guestJoins(browser, code, 'Visitor friend');
    await expect(friend.page.locator(NOTE_CARDS)).toHaveCount(11);
    await expect(page.getByTestId('presence')).toHaveText('2');

    // the friend adds a note after the host goes back to writing, and the host sees it appear
    await setPhase(page, 'WRITING');
    await addNote(friend.page, 'ACTION_IDEAS', 'Shared from a friend');
    await expect(column(page, 'ACTION_IDEAS').getByText('Shared from a friend')).toBeVisible();
    await expect(page.locator(NOTE_CARDS)).toHaveCount(12);
    await friend.context.close();
  });

  test('every visitor gets their own private demo', async ({ page, browser }) => {
    await page.goto('/');
    await page.getByTestId('try-demo').click();
    await expect(page.getByTestId('board')).toBeVisible();
    const firstCode = (await page.getByTestId('join-code').textContent())!.trim();
    await setPhase(page, 'WRITING');
    await addNote(page, 'WENT_WELL', 'Only visible in the first demo');

    const context = await browser.newContext({ baseURL: process.env['BASE_URL'] ?? 'http://localhost:5173' });
    const other = await context.newPage();
    await other.goto('/');
    await other.getByTestId('try-demo').click();
    await expect(other.getByTestId('board')).toBeVisible();
    const secondCode = (await other.getByTestId('join-code').textContent())!.trim();

    expect(secondCode).not.toBe(firstCode);
    await expect(other.locator(NOTE_CARDS)).toHaveCount(11);
    await expect(other.getByText('Only visible in the first demo')).toHaveCount(0);
    await expect(page.locator(NOTE_CARDS)).toHaveCount(12);
    await context.close();
  });

  test('leaving a demo and starting another one works', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('try-demo').click();
    await expect(page.getByTestId('board')).toBeVisible();
    await page.getByTestId('sign-out').click();
    await expect(page).toHaveURL(/\/$/);

    await page.getByTestId('try-demo').click();
    await expect(page.getByTestId('board')).toBeVisible();
    await expect(page.locator(NOTE_CARDS)).toHaveCount(11);
  });

  test('is not shown to a signed-in host, whose account it would replace', async ({ page }) => {
    await registerHost(page);
    await page.goto('/');
    await expect(page.getByTestId('join-submit')).toBeVisible();
    await expect(page.getByTestId('try-demo')).toHaveCount(0);
  });

  test('looks good on a phone', async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: process.env['BASE_URL'] ?? 'http://localhost:5173',
      viewport: { width: 390, height: 844 },
      isMobile: true,
    });
    const phone = await context.newPage();
    await phone.goto('/');
    await expect(phone.getByTestId('try-demo')).toBeVisible();
    expect(await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
    await phone.getByTestId('try-demo').click();
    await expect(phone.getByTestId('board')).toBeVisible();
    expect(await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
    await context.close();
  });

  test('screenshots for the README', async ({ page }) => {
    await page.goto('/');
    await page.screenshot({ path: 'screenshots/home.png' });
    await page.getByTestId('try-demo').click();
    await expect(page.getByTestId('board')).toBeVisible();
    await expect(page.getByTestId('demo-tips')).toBeVisible();
    await page.screenshot({ path: 'screenshots/demo-board.png', fullPage: true });
  });
});
