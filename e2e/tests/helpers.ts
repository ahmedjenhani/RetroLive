import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

export type ColumnId = 'WENT_WELL' | 'TO_IMPROVE' | 'ACTION_IDEAS';

let counter = 0;

export async function registerHost(page: Page, name = 'Hannah Host'): Promise<string> {
  counter += 1;
  const email = `e2e-${Date.now()}-${counter}-${Math.floor(Math.random() * 1e5)}@example.com`;
  await page.goto('/register');
  await page.getByTestId('name').fill(name);
  await page.getByTestId('email').fill(email);
  await page.getByTestId('password').fill('Password123!');
  await page.getByTestId('register-submit').click();
  await expect(page).toHaveURL(/\/host$/);
  return email;
}

/** Creates a session from the dashboard and opens its board. Returns the join code and the session id. */
export async function createAndOpenSession(page: Page, title: string): Promise<{ code: string; id: string }> {
  await page.getByTestId('session-title').fill(title);
  await page.getByTestId('create-session').click();
  const row = page.locator('li[data-testid^="session-"]').filter({ hasText: title }).first();
  await expect(row).toBeVisible();
  const code = (await row.getAttribute('data-testid'))!.replace('session-', '');
  await row.getByRole('link', { name: 'Open' }).click();
  await expect(page.getByTestId('board')).toBeVisible();
  return { code, id: page.url().split('/s/')[1]! };
}

/** A new host account with one open session. */
export async function startRetro(page: Page, title = 'Sprint 42 retro') {
  await registerHost(page);
  return createAndOpenSession(page, title);
}

export interface Guest {
  context: BrowserContext;
  page: Page;
  nickname: string;
}

/** A guest in their own browser window (their own storage, like a different person's computer). */
export async function guestJoins(
  browser: Browser,
  code: string,
  nickname: string,
  options: Parameters<Browser['newContext']>[0] = {},
): Promise<Guest> {
  const context = await browser.newContext({ baseURL: process.env['BASE_URL'] ?? 'http://localhost:5173', ...options });
  const page = await context.newPage();
  await page.goto(`/join/${code}`);
  await page.getByTestId('nickname').fill(nickname);
  await page.getByTestId('join-submit').click();
  await expect(page.getByTestId('board')).toBeVisible();
  return { context, page, nickname };
}

export const column = (page: Page, id: ColumnId) => page.getByTestId(`column-${id}`);

export async function addNote(page: Page, id: ColumnId, text: string): Promise<void> {
  await page.getByTestId(`note-input-${id}`).fill(text);
  await page.getByTestId(`note-add-${id}`).click();
  await expect(column(page, id).getByTestId('note-text').filter({ hasText: text })).toBeVisible();
}

/** The card that contains this text, inside one page. */
export const noteCard = (page: Page, text: string) => page.locator('article[data-testid^="note-"]').filter({ hasText: text });

export async function setPhase(host: Page, target: 'VOTING' | 'DISCUSSING' | 'WRITING'): Promise<void> {
  const button = target === 'WRITING' ? 'phase-back' : 'phase-next';
  await host.getByTestId(button).click();
  const label = { VOTING: 'Voting', DISCUSSING: 'Discussing', WRITING: 'Writing' }[target];
  await expect(host.getByTestId('current-phase')).toHaveText(label);
}
