import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runBotGame, type GameResult } from '../../ai/harness.ts';

/** 3 godziny gry (10 tickow/s) - gorny limit "rozsadnej" dlugosci partii 1 na 1 na mapie 64. */
const MAX_TICKS = 108000;
const GAMES = 20;

describe('M6: pelne partie bot kontra bot', () => {
  it(`${GAMES} partii (trudny vs latwy) konczy sie zwyciezca, bez wyjatkow i zakleszczen`, () => {
    const results: GameResult[] = [];
    for (let i = 0; i < GAMES; i++) results.push(runBotGame(`BOT${i}`, 64, [2, 1], MAX_TICKS, i + 1));
    mkdirSync('tests/out', { recursive: true });
    writeFileSync('tests/out/botgames.json', JSON.stringify(results, null, 1));
    const summary = results.map((r) => `${r.code}: zwyciezca ${r.winner}, ${Math.round(r.ticks / 600)} min gry, ${r.ms} ms, max tick ${r.maxTickMs} ms`);
    console.log(summary.join('\n'));
    for (const r of results) {
      expect(r.winner, `${r.code} bez zwyciezcy`).toBeGreaterThanOrEqual(0);
      expect(r.stalls, `${r.code} zakleszczenie`).toEqual([]);
      expect(r.ticks).toBeLessThanOrEqual(MAX_TICKS);
    }
    // Trudny bot powinien wygrywac czesciej niz latwy.
    const hardWins = results.filter((r) => r.winner === 0).length;
    expect(hardWins).toBeGreaterThan(GAMES / 2);
  }, 600_000);
});
