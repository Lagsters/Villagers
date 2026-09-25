import { describe, expect, it } from 'vitest';
import { S } from '../../sim/defs.ts';
import { SimNet, type LinkProfile } from './simnet.ts';

/** Profile laczy: opoznienie 25-200 ms w jedna strone (RTT 50-400), jitter, utrata pakietow. */
function profiles(n: number): LinkProfile[] {
  const out: LinkProfile[] = [];
  for (let i = 0; i < n; i++) out.push({ latency: 25 + ((i * 53) % 176), jitter: 10 + (i % 4) * 10, loss: 0.02 + (i % 3) * 0.02 });
  return out;
}

function runUntil(net: SimNet, tick: number, maxMs = 1e9): void {
  net.stopAt = tick;
  while (net.minTick() < tick && net.now < maxMs) net.advance(10);
}

describe('M7: lockstep na symulowanej sieci', () => {
  it('8 peerow, 30 minut gry, opoznienia 50-400 ms, jitter i utrata - zero desynchronizacji', () => {
    const net = new SimNet(8, 128, 'NET8', profiles(8), 3);
    runUntil(net, 18000);
    expect(net.desyncs).toBe(0);
    const h = net.hashes();
    expect(new Set(h).size).toBe(1);
    // Gra sie toczyla: boty budowaly przez siec.
    const st = net.peers[3].state;
    expect(st.buildings.filter((b) => b && b.owner === 5).length).toBeGreaterThan(5);
    // Gra szla w przyblizeniu w czasie rzeczywistym (lockstep nie dlawi sie opoznieniami).
    expect(net.now).toBeLessThan(18000 * 100 * 1.25);
    console.log(`wiadomosci: ${net.messages}, czas wirtualny ${Math.round(net.now / 1000)} s, max tick ${Math.max(...net.peers.map((p) => p.maxTickMs)).toFixed(1)} ms`);
  }, 900_000);

  it('rozlaczenie gracza: osade przejmuje bot, reszta gra dalej bez desynchronizacji', () => {
    const net = new SimNet(3, 64, 'DROP', profiles(3), 5);
    runUntil(net, 3000);
    const before = net.peers[0].state.buildings.filter((b) => b && b.owner === 2).length;
    net.disconnect(2);
    runUntil(net, 9000);
    expect(net.desyncs).toBe(0);
    const h = net.hashes();
    expect(h.length).toBe(2);
    expect(h[0]).toBe(h[1]);
    // Bot hosta rozbudowuje osade rozlaczonego gracza (komendy ida przez lockstep do wszystkich).
    const after = net.peers[1].state.buildings.filter((b) => b && b.owner === 2).length;
    expect(after).toBeGreaterThan(before);
    expect(net.peers[1].state.players[2].alive).toBe(true);
    void S;
  }, 300_000);

  it('rozna symulacja jest wykrywana jako desynchronizacja', () => {
    const net = new SimNet(2, 64, 'DSY', profiles(2), 7);
    runUntil(net, 500);
    // Zaburzenie stanu u klienta (jak blad niedeterminizmu).
    net.peers[1].state.map.height[100] ^= 1;
    runUntil(net, 700);
    expect(net.desyncs).toBeGreaterThan(0);
    expect(net.peers[0].driver.desync).not.toBeNull();
    expect(net.peers[0].driver.desync!.recentTurns.length).toBeGreaterThan(0);
  }, 120_000);
});
