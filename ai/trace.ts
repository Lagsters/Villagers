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
const s = createGame({ mapCode: code, mapSize: size, players: levels.map((l, i) => ({ name: `B${i}`, color: PLAYER_COLORS[i], ai: l })), seed: 1 });
const bots = levels.map((l, i) => new Bot(i, l, 7919 + i));
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
