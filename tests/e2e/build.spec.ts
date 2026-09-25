import { expect, test, type Page } from '@playwright/test';

type Pt = { x: number; y: number };

async function screenOf(page: Page, idx: number): Promise<Pt> {
  return page.evaluate((i) => (window as any).__game.view.project(i), idx);
}

test('budowa przez UI: budynek, droga do zamku, tragarz', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?map=E2E&size=64&players=2');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', '1');
  // Przybliz i znajdz miejsce na drwala blisko zamku, po lewej stronie (panel jest po prawej).
  const site = await page.evaluate(() => {
    const g = (window as any).__game;
    g.view.cam.zoom = 1.6;
    g.view.cam.moved = true;
    const s = g.session.state;
    const castle = s.buildings[s.players[0].castle];
    g.view.lookAtIdx(castle.pos);
    g.view.render(0.016, s, 0, 0);
    const w = s.map.w;
    for (const i of g.sim.spiral(w, s.map.h, castle.pos % w, (castle.pos / w) | 0, 6)) {
      const d = Math.abs((i % w) - (castle.pos % w)) + Math.abs(((i / w) | 0) - ((castle.pos / w) | 0));
      if (d >= 3 && g.sim.canBuild(s, 0, i, 2)) return { pos: i, flag: g.sim.neighbor(s.map, i, 1), castleFlag: s.flags[castle.flag].pos };
    }
    return null;
  });
  expect(site).not.toBeNull();
  await page.waitForTimeout(300);
  // 1. Klik na pole -> panel z przyciskami budynkow -> drwal.
  let p = await screenOf(page, site!.pos);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('.panel')).toBeVisible();
  await page.locator('.build-btn[data-kind="2"]').click();
  await page.waitForFunction((pos) => (window as any).__game.session.state.map.obj[pos] === 20, site!.pos);
  // 2. Klik na nowa flage -> "Buduj droge" -> klik na flage zamku.
  p = await screenOf(page, site!.flag);
  await page.mouse.click(p.x, p.y);
  await page.getByRole('button', { name: 'Buduj drogę' }).click();
  p = await screenOf(page, site!.castleFlag);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  await page.waitForFunction(() => (window as any).__game.session.state.roads.some((r: unknown) => r));
  // 3. Tragarz dochodzi na droge, budowa rusza (przyspieszamy gre).
  await page.evaluate(() => { (window as any).__game.session.speed = 4; });
  await page.waitForFunction(() => (window as any).__game.session.state.serfs.some((x: any) => x && x.type === 1 && x.state === 10), null, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `test-results/m3-build-${info.project.name}.png` });
  expect(errors).toEqual([]);
});
