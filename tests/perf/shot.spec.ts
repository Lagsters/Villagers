import { test } from '@playwright/test';
// Zrzut do README (uruchamiany recznie: npx playwright test tests/perf/shot.spec.ts --project=chromium).
test('zrzut do README', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium' || !process.env.SHOT);
  test.setTimeout(120_000);
  await page.goto('/?map=DOLINA&size=96&players=3&ai=2&allbots=1&quality=medium&seed=5');
  await page.waitForFunction(() => (window as any).__game, null, { timeout: 60_000 });
  await page.evaluate(() => {
    localStorage.setItem('osadnicy.tutorial', '-1');
    const g = (window as any).__game;
    g.fastForward(9000);
    const s = g.session.state;
    g.view.cam.zoom = 1.9;
    g.view.lookAtIdx(s.buildings[s.players[0].castle].pos);
    g.view.cam.rotate(1);
  });
  await page.waitForTimeout(2500);
  await page.evaluate(() => document.querySelectorAll('.tutorial').forEach((e) => ((e as HTMLElement).style.display = 'none')));
  await page.screenshot({ path: 'docs/screenshot.png' });
});
