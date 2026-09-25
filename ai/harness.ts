/**
 * Partie bot kontra bot bez renderingu (testy, balans). Uruchomienie z linii polecen:
 *   node ai/harness.ts [liczba_partii] [rozmiar_mapy] [poziomy np. 2,1]
 */
import '../sim/index.ts';
import { PLAYER_COLORS } from '../sim/defs.ts';
import { createGame } from '../sim/state.ts';
import { step } from '../sim/step.ts';
import { summarize } from '../sim/stats.ts';
import type { GameState } from '../sim/types.ts';
import { Bot } from './bot.ts';

export interface GameResult {
  code: string;
  winner: number;
  ticks: number;
  stalls: string[];
  ms: number;
  maxTickMs: number;
  events: Record<string, number>;
  summary: { player: number; level: number; buildings: number; knights: number; territory: number; produced: number; alive: boolean }[];
}

/** Suma wszystkich wyprodukowanych towarow gracza. */
function producedTotal(s: GameState, p: number): number {
  return s.players[p].stats.produced.reduce((a, b) => a + b, 0);
}

export function runBotGame(code: string, size: number, levels: number[], maxTicks = 60000, seed = 1): GameResult {
  const s = createGame({
    mapCode: code,
    mapSize: size,
    players: levels.map((l, i) => ({ name: `Bot ${i + 1}`, color: PLAYER_COLORS[i], ai: l })),
    seed,
  });
  const bots = levels.map((l, i) => new Bot(i, l, seed * 7919 + i));
  const stalls: string[] = [];
  const window = 6000;
  const lastProd = levels.map(() => 0);
  const t0 = performance.now();
  let maxTickMs = 0;
  const events: Record<string, number> = {};
  while (s.winner === -1 && s.tick < maxTicks) {
    const cmds = [];
    for (const b of bots) for (const c of b.think(s)) cmds.push(c);
    const a = performance.now();
    step(s, cmds);
    for (const e of s._events) if (e.type !== 'height' && e.type !== 'site' && e.type !== 'built') events[e.type] = (events[e.type] ?? 0) + 1;
    const dt = performance.now() - a;
    if (dt > maxTickMs && s.tick > 10) maxTickMs = dt;
    if (s.tick % window === 0) {
      for (let p = 0; p < levels.length; p++) {
        if (!s.players[p].alive) continue;
        const prod = producedTotal(s, p);
        if (prod === lastProd[p]) stalls.push(`gracz ${p} bez produkcji w oknie do ticku ${s.tick}`);
        lastProd[p] = prod;
      }
    }
  }
  return {
    code,
    winner: s.winner,
    ticks: s.tick,
    stalls,
    ms: Math.round(performance.now() - t0),
    maxTickMs: Math.round(maxTickMs * 100) / 100,
    events,
    summary: levels.map((l, p) => {
      const sm = summarize(s, p);
      return { player: p, level: l, buildings: sm.buildings, knights: sm.knights, territory: sm.territory, produced: producedTotal(s, p), alive: s.players[p].alive };
    }),
  };
}

// Uruchomienie z CLI.
if (process.argv[1]?.endsWith('harness.ts')) {
  const n = Number(process.argv[2] ?? 1);
  const size = Number(process.argv[3] ?? 64);
  const levels = (process.argv[4] ?? '2,1').split(',').map(Number);
  for (let i = 0; i < n; i++) {
    const r = runBotGame(`BOT${i}`, size, levels, 72000, i + 1);
    console.log(JSON.stringify(r));
  }
}
