/** Pomiar czasu ticku: 8 botow, mapa 128, do 30 minuty gry. node tests/perf/simbench.ts [ticki] */
import '../../sim/index.ts';
import { Bot } from '../../ai/bot.ts';
import { PLAYER_COLORS } from '../../sim/defs.ts';
import { createGame } from '../../sim/state.ts';
import { step } from '../../sim/step.ts';

const TICKS = Number(process.argv[2] ?? 18000);
const s = createGame({ mapCode: 'PERF', mapSize: 128, players: PLAYER_COLORS.map((c, i) => ({ name: `B${i}`, color: c, ai: 2 })), seed: 3 });
const bots = s.players.map((p) => new Bot(p.id, 2, 100 + p.id));
const times: number[] = [];
const botTimes: number[] = [];
while (s.tick < TICKS) {
  const b0 = performance.now();
  const cmds = [];
  for (const b of bots) for (const c of b.think(s)) cmds.push(c);
  const t0 = performance.now();
  step(s, cmds);
  const t1 = performance.now();
  if (s.tick > (process.env.ALL ? 10 : TICKS - 3000)) { times.push(t1 - t0); botTimes.push(t0 - b0); }
}
times.sort((a, b) => a - b);
const avg = times.reduce((a, b) => a + b, 0) / times.length;
const serfs = s.serfs.filter(Boolean).length;
const flags = s.flags.filter(Boolean).length;
console.log(JSON.stringify({ avg: +avg.toFixed(3), p95: +times[Math.floor(times.length * 0.95)].toFixed(3), max: +times[times.length - 1].toFixed(3), botAvg: +(botTimes.reduce((a, b) => a + b, 0) / botTimes.length).toFixed(3), serfs, flags, buildings: s.buildings.filter(Boolean).length }));
