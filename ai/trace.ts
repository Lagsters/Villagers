/** Diagnostyka jednej partii botow: stan co 6000 tickow. node ai/trace.ts KOD ROZMIAR 2,1 */
import '../sim/index.ts';
import { B, G, PLAYER_COLORS, isMilitary } from '../sim/defs.ts';
import { createGame } from '../sim/state.ts';
import { step } from '../sim/step.ts';
import { summarize } from '../sim/stats.ts';
import { STAGE } from '../sim/types.ts';
import { Bot } from './bot.ts';

const code = process.argv[2] ?? 'BOT0';
const size = Number(process.argv[3] ?? 64);
const levels = (process.argv[4] ?? '2,1').split(',').map(Number);
const seed = Number(process.argv[5] ?? (Number(code.replace(/\D/g, '')) + 1));
const s = createGame({ mapCode: code, mapSize: size, players: levels.map((l, i) => ({ name: `B${i}`, color: PLAYER_COLORS[i], ai: l })), seed });
const bots = levels.map((l, i) => new Bot(i, l, seed * 7919 + i));
const cmdCount: Record<string, number> = {};
while (s.winner === -1 && s.tick < 72000) {
  const cmds = [];
  for (const b of bots) for (const c of b.think(s)) { cmds.push(c); const k = `${c.player}:${c.type}${c.type === 'build' ? ':' + c.kind : ''}`; cmdCount[k] = (cmdCount[k] ?? 0) + 1; }
  step(s, cmds);
  if (s.tick % 6000 === 0) {
    const row = s.players.map((p) => {
      const sm = summarize(s, p.id);
      const mil = s.buildings.filter((b) => b && b.owner === p.id && isMilitary(b.kind));
      const done = mil.filter((b) => b!.stage === STAGE.DONE && b!.knights.length > 0).length;
      const castle = s.buildings[p.castle];
      const ck = castle?.inv ? castle.inv.knights.reduce((a, c) => a + c, 0) : 0;
      const sites = s.buildings.filter((b) => b && b.owner === p.id && b.stage < 2).map((b) => b!.kind);
      return `P${p.id} ter=${sm.territory} bld=${sm.buildings} mil=${done}/${mil.length} kn=${sm.knights}(zamek ${ck}) D=${sm.goods[G.PLANK]} K=${sm.goods[G.STONE]} serfs=${sm.serfs} sites=[${sites}]`;
    });
    console.log(`t=${s.tick / 600}min  ` + row.join(' | '));
  }
}
console.log('winner', s.winner, JSON.stringify(cmdCount));
void B;
for (const p of s.players) {
  const pr = s.players[p.id].stats.produced.map((v, g) => (v ? `${g}:${v}` : '')).filter(Boolean).join(' ');
  console.log(`P${p.id} produced ${pr}`);
  const inv = s.buildings[p.castle]?.inv;
  if (inv) console.log(`  castle goods ${inv.goods.map((v, g) => (v ? `${g}:${v}` : '')).filter(Boolean).join(' ')}`);
  for (const b of s.buildings) {
    if (!b || b.owner !== p.id || b.kind === 0 || isMilitary(b.kind)) continue;
    console.log(`  k${b.kind} st${b.stage} w${b.worker}/${b.workerInside ? 'in' : 'out'} stock=${b.stock.join('/')} tr=${b.transit.join('/')} prod=${b.produced} idle=${b.idleCycles} out=${b.out.length}`);
  }
}
import { attackersAvailable, attackPreview, defenderLevels } from '../sim/military.ts';
for (const p of s.players) {
  for (const q of s.players) {
    if (p.id === q.id) continue;
    const c = s.buildings[q.castle];
    if (!c) continue;
    const av = attackersAvailable(s, p.id, c);
    const w = s.map.w;
    const nearMil = s.buildings.filter((b) => b && b.owner === p.id && isMilitary(b.kind) && Math.abs((b.pos % w) - (c.pos % w)) + Math.abs(((b.pos / w) | 0) - ((c.pos / w) | 0)) < 20).map((b) => `${b!.kind}:${b!.stage}:${b!.knights.length}`);
    console.log(`P${p.id} -> zamek P${q.id}: obroncy ${JSON.stringify(defenderLevels(s, c))}, dostepni ${av} ${JSON.stringify(attackPreview(s, p.id, c, av))}, budynki P${p.id} blisko: ${nearMil.join(' ')}`);
  }
}
for (const p of s.players) {
  const cst = s.buildings[p.castle];
  const list = s.buildings.filter((b) => b && b.owner === p.id && isMilitary(b.kind) && b.stage === STAGE.DONE).map((b) => `${b!.kind}/z${b!.phase}/${b!.knights.length}${cst && flagDist(s, p.id, b!.flag, cst.flag, true) < UNREACHABLE ? '' : '/ODCIETY'}`);
  console.log(`P${p.id} wojsko: ${list.join(' ')}`);
}
import { flagDist, UNREACHABLE } from '../sim/routing.ts';
for (const p of s.players) {
  const castle = s.buildings[p.castle];
  for (const b of s.buildings) {
    if (!b || b.owner !== p.id || b.stage > 1) continue;
    const bs = b.builder >= 0 ? s.serfs[b.builder] : null;
    const reach = castle ? flagDist(s, p.id, b.flag, castle.flag, true) < UNREACHABLE : false;
    const f = s.flags[b.flag]!;
    console.log(`P${p.id} plac k${b.kind} st${b.stage} builder=${b.builder}(${bs ? bs.state + '/' + bs.type : '-'}) digger=${b.digger} D=${b.planks}+${b.planksTransit}/${b.planksUsed} K=${b.stones}+${b.stonesTransit}/${b.stonesUsed} reach=${reach} roads=${f.roads.join(',')} goods=${f.slotGood.join(',')}`);
  }
}
for (const p of s.players) {
  const c = s.buildings[p.castle];
  if (!c) continue;
  const f = s.flags[c.flag];
  if (!f) continue;
  console.log(`P${p.id} flaga zamku: goods=${f.slotGood.join(',')} dirs=${f.slotDir.join(',')} roads=${f.roads.join(',')}`);
}
for (const p of s.players) {
  const st: Record<string, number> = {};
  for (const k of s.serfs) if (k && k.owner === p.id && k.type === 22) st[k.state] = (st[k.state] ?? 0) + 1;
  let invK = 0;
  const invs: string[] = [];
  for (const b of s.buildings) if (b && b.owner === p.id && b.inv) { const n = b.inv.knights.reduce((a, c) => a + c, 0); invK += n; invs.push(`${b.kind}:${n}`); }
  console.log(`P${p.id} rycerze wg stanu ${JSON.stringify(st)} w magazynach ${invK} [${invs.join(' ')}]`);
}
import { writeFileSync } from 'node:fs';
if (process.env.DUMP) {
  const m = s.map;
  writeFileSync(process.env.DUMP, JSON.stringify({ w: m.w, h: m.h, owner: Array.from(m.owner), terrain: Array.from(m.terrain), obj: Array.from(m.obj), roads: Array.from(m.roads).map((r) => (r ? 1 : 0)), castles: s.players.map((p) => s.buildings[p.castle]?.pos ?? -1) }));
}
for (const p of s.players) {
  for (const b of s.buildings) {
    if (!b || b.owner !== p.id || !b.inv) continue;
    const sf = b.inv.serfs.map((n, t) => (n ? `${t}:${n}` : '')).filter(Boolean).join(' ');
    const c = s.buildings[p.castle];
    const reach = c ? (b.flag === c.flag || flagDist(s, p.id, b.flag, c.flag, true) < UNREACHABLE) : false;
    console.log(`P${p.id} magazyn k${b.kind} osadnicy[${sf}] mlotki=${b.inv.goods[18]} lopaty=${b.inv.goods[17]} polaczony=${reach}`);
  }
  console.log(`P${p.id} toolWant=${s.players[p.id].toolWant.join(',')} toolPrio=${s.players[p.id].settings.toolPrio.join(',')}`);
}
import { attackPreview as ap2, attackersAvailable as aa2, defenderLevels as dl2, isAttackTarget as iat } from '../sim/military.ts';
for (const p of s.players) {
  const rows: string[] = [];
  for (const t of s.buildings) {
    if (!t || t.owner === p.id || !iat(s, p.id, t)) continue;
    const av = aa2(s, p.id, t);
    if (av <= 0) continue;
    rows.push(`k${t.kind} obr=${JSON.stringify(dl2(s, t))} atak=${JSON.stringify(ap2(s, p.id, t, av))}`);
  }
  console.log(`P${p.id} cele: ${rows.slice(0, 8).join(' | ') || 'brak w zasiegu'}`);
}
