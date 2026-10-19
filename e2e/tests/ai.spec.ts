import { expect, test } from '@playwright/test';
import { addNote, guestJoins, noteCard, setPhase, startRetro } from './helpers';

// This test calls the real Gemini API through the real backend, so it only runs when asked for:
//   LIVE_AI=1 npx playwright test tests/ai.spec.ts
test.describe('AI summary against the real Gemini API', () => {
  test.skip(!process.env['LIVE_AI'], 'set LIVE_AI=1 to run the test that calls Gemini for real');

  test('turns real notes into themes and action items that everyone sees live', async ({ page, browser }) => {
    test.setTimeout(150_000);
    const { code } = await startRetro(page, 'Platform team retro');
    const gina = await guestJoins(browser, code, 'Gina');
    const sam = await guestJoins(browser, code, 'Sam');

    await addNote(gina.page, 'WENT_WELL', 'Pair programming helped us onboard the new hire quickly');
    await addNote(sam.page, 'WENT_WELL', 'The new CI pipeline catches bugs before review');
    await addNote(gina.page, 'TO_IMPROVE', 'Deployments take over 40 minutes and block everyone');
    await addNote(sam.page, 'TO_IMPROVE', 'Code reviews wait two days for a first response');
    await addNote(page, 'ACTION_IDEAS', 'Set a 24 hour target for the first review comment');

    await setPhase(page, 'VOTING');
    await noteCard(gina.page, 'Deployments take over').getByTestId('vote-button').click();
    await noteCard(sam.page, 'Deployments take over').getByTestId('vote-button').click();
    await setPhase(page, 'DISCUSSING');

    await page.getByTestId('summary-generate').click();
    await expect(page.getByTestId('summary-theme').first()).toBeVisible({ timeout: 90_000 });
    expect(await page.getByTestId('summary-theme').count()).toBeGreaterThanOrEqual(1);
    expect(await page.getByTestId('summary-actions').locator('li').count()).toBeGreaterThanOrEqual(3);

    // the guests did not click anything: the summary reaches them through the live connection
    await expect(gina.page.getByTestId('summary-theme').first()).toBeVisible({ timeout: 10_000 });
    await expect(sam.page.getByTestId('summary-actions')).toBeVisible();
    await page.screenshot({ path: 'screenshots/ai-summary-live.png', fullPage: true });

    await gina.context.close();
    await sam.context.close();
  });
});
