import { expect, test } from '@playwright/test';
import { addNote, createAndOpenSession, guestJoins, noteCard, registerHost, setPhase } from './helpers';

// Builds a realistic session with a host and three guests and saves screenshots used by the README.
test('screenshots of a session in progress', async ({ page, browser }) => {
  test.setTimeout(120_000);

  // home page
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Run a retro/ })).toBeVisible();
  await page.screenshot({ path: 'screenshots/home.png' });

  await registerHost(page, 'Hannah Host');
  await page.screenshot({ path: 'screenshots/dashboard-empty.png' });
  const { code } = await createAndOpenSession(page, 'Sprint 42 retrospective');

  const gina = await guestJoins(browser, code, 'Gina');
  const sam = await guestJoins(browser, code, 'Sam');
  const lee = await guestJoins(browser, code, 'Lee');

  await addNote(gina.page, 'WENT_WELL', 'Pair programming helped us onboard the new hire quickly');
  await addNote(sam.page, 'WENT_WELL', 'The new CI pipeline catches bugs before review');
  await addNote(lee.page, 'WENT_WELL', 'Demo day went smoothly and the customer was happy');
  await addNote(gina.page, 'TO_IMPROVE', 'Deployments take over 40 minutes and block everyone');
  await addNote(sam.page, 'TO_IMPROVE', 'Code reviews wait two days for a first response');
  await addNote(page, 'TO_IMPROVE', 'Too many meetings in the middle of the week');
  await addNote(lee.page, 'ACTION_IDEAS', 'Set a 24 hour target for the first review comment');
  await addNote(page, 'ACTION_IDEAS', 'Try a no-meeting Wednesday');

  await page.getByTestId('timer-start-300').click();
  await expect(page.getByTestId('timer')).toBeVisible();
  await page.screenshot({ path: 'screenshots/board-writing.png', fullPage: true });

  await setPhase(page, 'VOTING');
  await noteCard(gina.page, 'Deployments take over').getByTestId('vote-button').click();
  await noteCard(sam.page, 'Deployments take over').getByTestId('vote-button').click();
  await noteCard(lee.page, 'Deployments take over').getByTestId('vote-button').click();
  await noteCard(page, 'Code reviews wait').getByTestId('vote-button').click();
  await noteCard(gina.page, 'Code reviews wait').getByTestId('vote-button').click();
  await noteCard(sam.page, 'Pair programming').getByTestId('vote-button').click();
  await noteCard(page, 'no-meeting Wednesday').getByTestId('vote-button').click();
  await expect(noteCard(page, 'Deployments take over').getByTestId('vote-count')).toHaveText('3');
  await page.screenshot({ path: 'screenshots/board-voting.png', fullPage: true });

  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await page.waitForTimeout(600); // let the buttons finish their colour fade before taking the picture
  await page.screenshot({ path: 'screenshots/board-voting-dark.png', fullPage: true });
  await page.getByRole('button', { name: 'Switch to light mode' }).click();

  // the same session on a phone
  const phone = await guestJoins(browser, code, 'Phone user', { viewport: { width: 390, height: 844 }, isMobile: true });
  await setPhase(page, 'DISCUSSING');
  await expect(phone.page.getByText('Talk through the top-voted notes')).toBeVisible(); // step labels are hidden on small screens
  await phone.page.screenshot({ path: 'screenshots/mobile.png', fullPage: true });

  for (const guest of [gina, sam, lee, phone]) {
    await guest.context.close();
  }
});
