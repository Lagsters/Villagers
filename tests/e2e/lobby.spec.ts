import { expect, test } from '@playwright/test';

test('lobby: dwie karty lacza sie przez serwer sygnalizacyjny i graja razem', async ({ browser }, info) => {
  // Playwright-Firefox nie zbiera kandydatow ICE na stronie http://localhost (sprawdzone recznie:
  // dziala na about:blank, nie dziala na stronie gry) - zob. docs/DECISIONS.md. WebRTC testujemy w Chromium.
  test.skip(info.project.name === 'firefox', 'WebRTC w Playwright-Firefox na http://localhost nie zbiera kandydatow ICE');
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const errors: string[] = [];
  for (const p of [a, b]) p.on('pageerror', (e) => errors.push(String(e)));

  await a.goto('/');
  await a.getByRole('button', { name: 'Gra wieloosobowa' }).click();
  await a.locator('.menu-field input[type=text]').first().fill('Gospodarz');
  await a.getByRole('button', { name: 'Utwórz pokój' }).click();
  const codeEl = a.locator('[data-testid=room-code]');
  await expect(codeEl).toHaveText(/^[A-Z2-9]{6}$/, { timeout: 15_000 });
  const code = (await codeEl.textContent())!;

  await b.goto('/');
  await b.getByRole('button', { name: 'Gra wieloosobowa' }).click();
  await b.locator('.menu-field input[type=text]').first().fill('Gosc');
  await b.locator('.room-code-input').fill(code);
  await b.getByRole('button', { name: 'Dołącz' }).click();
  // Klient widzi lobby z dwoma graczami (polaczenie WebRTC ustanowione).
  await expect(b.locator('.lobby-player')).toHaveCount(2, { timeout: 20_000 });
  await expect(a.locator('.lobby-player')).toHaveCount(2);
  await b.getByRole('button', { name: 'Jestem gotowy' }).click();
  const start = a.getByRole('button', { name: 'Rozpocznij grę' });
  await expect(start).toBeEnabled({ timeout: 10_000 });
  await a.screenshot({ path: `test-results/m7-lobby-${info.project.name}.png` });
  await start.click();

  await expect(a.locator('#app')).toHaveAttribute('data-net', 'game', { timeout: 15_000 });
  await expect(b.locator('#app')).toHaveAttribute('data-net', 'game', { timeout: 15_000 });
  // Gosc stawia flage; po chwili widzi ja tez gospodarz (komenda przeszla przez lockstep).
  const pos = await b.evaluate(() => {
    const g = (window as any).__game;
    const s = g.session.state;
    const me = g.session.localPlayer;
    const castle = s.buildings[s.players[me].castle];
    const w = s.map.w;
    for (const i of g.sim.spiral(w, s.map.h, castle.pos % w, (castle.pos / w) | 0, 6)) {
      if (g.sim.canPlaceFlag(s, me, i)) {
        g.session.submit({ type: 'flag', player: me, pos: i });
        return i;
      }
    }
    return -1;
  });
  expect(pos).toBeGreaterThan(0);
  await a.waitForFunction((p) => (window as any).__game.session.state.map.obj[p] === 19, pos, { timeout: 15_000 });
  // Oba peery tykaja i nie ma desynchronizacji.
  await a.waitForFunction(() => (window as any).__game.session.state.tick > 120, null, { timeout: 30_000 });
  await b.waitForFunction(() => (window as any).__game.session.state.tick > 120, null, { timeout: 30_000 });
  const desync = await Promise.all([a, b].map((p) => p.evaluate(() => !!(window as any).__game.session.driver.desync)));
  expect(desync).toEqual([false, false]);
  await b.screenshot({ path: `test-results/m7-game-${info.project.name}.png` });
  expect(errors).toEqual([]);
  await ctxA.close();
  await ctxB.close();
});
