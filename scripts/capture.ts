/**
 * Klatki animacji z gry (przegladarka bez okna, niezalezna od innych): do ogladania scen pracy zawodow.
 *
 *   node scripts/capture.ts --out <katalog> [opcje]
 *
 * Opcje:
 *   --url <adres>        strona gry (domyslnie http://localhost:5173/?demo=1&notour - pokaz wszystkich zawodow bez panelu)
 *   --ff <ticki>         przewiniecie gry przed nagraniem (bez renderowania)
 *   --kind <B.*>         kamera na budynek tego rodzaju gracza 0 (pokaz: __game.look), --nth <n> - n-ty taki budynek
 *   --until "<js>"       wyrazenie JS (zmienne: g = __game, s = stan gry) zwracajace pole mapy albo -1; gra jest
 *                        przewijana po --step tickow (domyslnie 5), az zwroci pole >= 0 (najwyzej --tries razy, domyslnie 600)
 *   --follow "<js>"      jak --until, liczone przed kazda klatka - kamera podaza za polem (np. za osadnikiem)
 *   --zoom <z>           przyblizenie kamery (domyslnie 10)
 *   --lift <y>           kamera celuje tyle wyzej nad polem (np. 0.35 - srodek budynku zamiast ziemi)
 *   --rotate <n>         obrot kamery o n * 60 stopni
 *   --tilt <stopnie>     zmiana pochylenia kamery wzgledem domyslnego (+ = bardziej z gory)
 *   --frames <n>         liczba klatek (domyslnie 6), --interval <ms> odstep miedzy klatkami (domyslnie 300)
 *   --speed <x>          tempo gry podczas nagrania (domyslnie 1)
 *   --wait <ms>          czekanie przed pierwsza klatka (domyslnie 1500)
 *   --size <WxH>         rozmiar okna (domyslnie 960x600)
 *   --fixed <fps>        staly krok czasu: gra stoi, a przed kazda klatka przesuwa sie dokladnie o 1/fps s
 *                        (z tempem --speed) - plynne animacje niezaleznie od szybkosci renderowania; --interval nieuzywany
 *   --crop <WxH>         zapis tylko srodka klatki o tym rozmiarze
 *   --eval "<js>"        dowolny kod JS wykonany przed nagraniem (g, s dostepne)
 *
 * Wynik: <out>/frame_00.png ... oraz <out>/info.json (pole kamery, tick). Serwer gry musi dzialac (npx vite --port 5173).
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
function opt(name: string, def?: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
}
const out = opt('out');
if (!out) {
  console.error('Brak --out <katalog>');
  process.exit(1);
}
mkdirSync(out, { recursive: true });
// Stare klatki poprzedniego nagrania w tym katalogu mieszalyby sie z nowymi w arkuszu.
for (const f of readdirSync(out)) if (/^frame_\d+\.png$/.test(f) || f === 'sheet.png') rmSync(`${out}/${f}`);
const [vw, vh] = (opt('size', '960x600') as string).split('x').map(Number);
const url = opt('url', 'http://localhost:5173/?demo=1&notour') as string;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript(() => localStorage.setItem('osadnicy.tutorial', '-1'));
await page.goto(url);
await page.waitForFunction(() => (window as unknown as { __game?: unknown }).__game, null, { timeout: 120_000 });
await page.evaluate(() => document.querySelectorAll('.tutorial').forEach((e) => ((e as HTMLElement).style.display = 'none')));

type Ev = { ff?: number; kind?: number; nth?: number; until?: string; step: number; tries: number; zoom: number; lift: number; rotate: number; tilt?: number; speed: number; code?: string };
const ev: Ev = {
  ff: opt('ff') ? Number(opt('ff')) : undefined,
  kind: opt('kind') ? Number(opt('kind')) : undefined,
  nth: Number(opt('nth', '0')),
  until: opt('until'),
  step: Number(opt('step', '5')),
  tries: Number(opt('tries', '600')),
  zoom: Number(opt('zoom', '10')),
  lift: Number(opt('lift', '0')),
  rotate: Number(opt('rotate', '0')),
  tilt: opt('tilt') ? Number(opt('tilt')) : undefined,
  speed: Number(opt('speed', '1')),
  code: opt('eval'),
};
const info = await page.evaluate((e: Ev) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = (window as any).__game;
  const s = () => g.session.state;
  if (e.ff) g.fastForward(e.ff);
  let pos = -1;
  if (e.kind !== undefined && g.look) pos = g.look(e.kind, e.nth, e.zoom);
  if (e.until) {
    const f = new Function('g', 's', `return (${e.until});`);
    for (let k = 0; k < e.tries; k++) {
      pos = f(g, s());
      if (pos >= 0) break;
      g.fastForward(e.step);
    }
  }
  if (e.code) new Function('g', 's', e.code)(g, s());
  g.view.cam.zoom = e.zoom;
  if (pos >= 0) g.view.lookAtIdx(pos);
  if (e.lift) {
    g.view.cam.target.y += e.lift;
    g.view.cam.lookAt(g.view.cam.target.x, g.view.cam.target.z);
  }
  for (let k = 0; k < e.rotate; k++) g.view.cam.rotate(1);
  if (e.tilt !== undefined) g.view.cam.tiltBy((e.tilt * Math.PI) / 180);
  g.session.speed = e.speed;
  return { pos, tick: s().tick };
}, ev);

await page.waitForTimeout(Number(opt('wait', '1500')));
const frames = Number(opt('frames', '6'));
const interval = Number(opt('interval', '300'));
const follow = opt('follow');
const fixed = opt('fixed') ? Number(opt('fixed')) : 0;
const crop = opt('crop')?.split('x').map(Number);
const clip = crop ? { x: Math.round((vw - crop[0]) / 2), y: Math.round((vh - crop[1]) / 2), width: crop[0], height: crop[1] } : undefined;
if (fixed) {
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__game.session.paused = true;
  });
}
for (let k = 0; k < frames; k++) {
  if (fixed) {
    await page.evaluate((dt: number) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = (window as any).__game;
      const ses = g.session;
      ses.paused = false;
      ses.update(dt * 1000);
      ses.paused = true;
      g.view.syncState(ses.state, ses.takeEvents());
      g.view.render(dt, ses.state, ses.alpha, 0, ses.speed);
    }, 1 / fixed);
  }
  if (follow) {
    await page.evaluate((code: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = (window as any).__game;
      const p = new Function('g', 's', `return (${code});`)(g, g.session.state);
      if (p >= 0) g.view.lookAtIdx(p);
    }, follow);
  }
  await page.screenshot({ path: `${out}/frame_${String(k).padStart(2, '0')}.png`, clip });
  if (k + 1 < frames && !fixed) await page.waitForTimeout(interval);
}
const tick = await page.evaluate(() => (window as unknown as { __game: { session: { state: { tick: number } } } }).__game.session.state.tick);
writeFileSync(`${out}/info.json`, JSON.stringify({ ...info, endTick: tick, errors }, null, 1));
console.log(JSON.stringify({ ...info, endTick: tick, frames, errors: errors.slice(0, 5) }));
await browser.close();
