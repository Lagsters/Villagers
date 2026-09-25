import { expect, test } from '@playwright/test';

/**
 * Wydajnosc: 8 graczy (boty), mapa 128, po 30 minutach gry; CPU spowolnione x4, okno 1280x720, DPR 1.
 * Kryteria: srednio >= 30 FPS, tick symulacji < 10 ms, pamiec JS < 300 MB.
 */
test('wydajnosc: 8 graczy po 30 minutach, CPU x4', async ({ page, browserName }, info) => {
  test.skip(browserName !== 'chromium', 'Spowolnienie CPU i performance.memory tylko w Chromium (CDP)');
  test.setTimeout(300_000);
  await page.goto('/?map=PERF&size=128&players=8&ai=2&allbots=1&fps=60&seed=3');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', '1', { timeout: 60_000 });
  await page.evaluate(() => (window as any).__game.fastForward(18000));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  // Rozgrzewka i pomiar 10 s.
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const p = (window as any).__game.perf;
    p.frames = 0; p.frameMs = 0; p.ticks = 0; p.tickMs = 0; p.maxTickMs = 0;
  });
  await page.waitForTimeout(10_000);
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    const p = g.perf;
    const mem = (performance as any).memory?.usedJSHeapSize ?? 0;
    const info = g.view.renderer.info.render;
    return {
      fps: p.frames / 10,
      frameMs: p.frames ? p.frameMs / p.frames : 0,
      tickAvg: p.ticks ? p.tickMs / p.ticks : 0,
      tickMax: p.maxTickMs,
      ticks: p.ticks,
      memMB: mem / 1048576,
      calls: info.calls,
      tris: info.triangles,
      serfs: g.session.state.serfs.filter(Boolean).length,
      tick: g.session.state.tick,
    };
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  console.log('WYDAJNOSC', JSON.stringify(r));
  await page.screenshot({ path: `test-results/m9-perf-${info.project.name}.png` });
  info.annotations.push({ type: 'wydajnosc', description: JSON.stringify(r) });
  // Wspoldzielony runner CI (2 vCPU, grafika programowa na tych samych rdzeniach) nie jest miarodajny
  // dla FPS i skokow czasu - tam twardo sprawdzamy tylko wielkosci niezalezne od maszyny.
  // Pelne kryteria: lokalnie `npm run test:perf` (zob. docs/DECISIONS.md).
  if (!process.env.CI) {
    expect(r.fps).toBeGreaterThanOrEqual(30);
    expect(r.tickMax).toBeLessThan(10);
  }
  expect(r.tickAvg).toBeLessThan(10);
  expect(r.memMB).toBeLessThan(300);
  expect(r.calls).toBeLessThan(150);
});
