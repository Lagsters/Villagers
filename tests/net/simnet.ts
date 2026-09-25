/**
 * Symulowana siec dla testow lockstepu: wirtualny zegar, laczne z opoznieniem, jitterem i utrata.
 * Kanal jest niezawodny i uporzadkowany (jak DataChannel WebRTC): zgubiony pakiet jest retransmitowany
 * po czasie RTO, a kolejne czekaja za nim (head-of-line blocking).
 */
import '../../sim/index.ts';
import { Bot } from '../../ai/bot.ts';
import { PLAYER_COLORS } from '../../sim/defs.ts';
import { hashAny } from '../../sim/hash.ts';
import { createGame } from '../../sim/state.ts';
import { step } from '../../sim/step.ts';
import type { GameState } from '../../sim/types.ts';
import { LockstepClient, LockstepHost } from '../../net/lockstep.ts';
import type { NetMsg } from '../../net/protocol.ts';

/** Prosty PRNG testu (niezalezny od symulacji). */
class Rand {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x >>> 0;
    return this.s / 4294967296;
  }
}

interface Packet {
  at: number;
  to: number;
  from: number;
  msg: NetMsg;
}

export interface LinkProfile {
  /** opoznienie w jedna strone [ms] */
  latency: number;
  jitter: number;
  loss: number;
}

export interface SimPeer {
  index: number;
  state: GameState;
  driver: LockstepHost | LockstepClient;
  bot: Bot | null;
  acc: number;
  connected: boolean;
  maxTickMs: number;
}

export class SimNet {
  now = 0;
  private queue: Packet[] = [];
  /** czas dostarczenia ostatniego pakietu na laczu from->to (utrzymanie kolejnosci) */
  private lastAt = new Map<string, number>();
  readonly peers: SimPeer[] = [];
  private rnd: Rand;
  profiles: LinkProfile[];
  messages = 0;
  desyncs = 0;
  /** Peery nie wykonuja tickow od tego numeru (porownanie stanow w tym samym ticku). */
  stopAt = Infinity;

  constructor(players: number, mapSize: number, code: string, profiles: LinkProfile[], seed = 1) {
    this.rnd = new Rand(seed * 7 + 3);
    this.profiles = profiles;
    const config = {
      mapCode: code,
      mapSize,
      players: Array.from({ length: players }, (_, i) => ({ name: `P${i}`, color: PLAYER_COLORS[i], ai: 0 })),
      seed,
    };
    for (let i = 0; i < players; i++) {
      const state = createGame(config);
      const driver = i === 0
        ? new LockstepHost(0, () => this.now)
        : new LockstepClient(i, (m) => this.send(i, 0, m));
      driver.onDesync = () => { this.desyncs++; };
      this.peers.push({ index: i, state, driver, bot: new Bot(i, 2, seed * 101 + i), acc: 0, connected: true, maxTickMs: 0 });
    }
    const host = this.peers[0].driver as LockstepHost;
    for (let i = 1; i < players; i++) host.addPeer(`p${i}`, i, (m) => this.send(0, i, m));
  }

  private send(from: number, to: number, msg: NetMsg): void {
    const fromPeer = this.peers[from];
    const toPeer = this.peers[to];
    if (!fromPeer.connected || !toPeer.connected) return;
    this.messages++;
    const prof = this.profiles[from === 0 ? to : from];
    let delay = prof.latency + (this.rnd.next() * 2 - 1) * prof.jitter;
    // Utrata: retransmisja po RTO (~3x opoznienie), mozliwie kilkukrotna.
    while (this.rnd.next() < prof.loss) delay += prof.latency * 3;
    const key = `${from}>${to}`;
    const at = Math.max(this.now + Math.max(1, delay), this.lastAt.get(key) ?? 0);
    this.lastAt.set(key, at);
    // Kopia gleboka, jak po serializacji na drucie.
    this.queue.push({ at, to, from, msg: JSON.parse(JSON.stringify(msg)) as NetMsg });
  }

  /** Rozlaczenie peera (klienta): host przejmuje jego osade botem. */
  disconnect(i: number): void {
    this.peers[i].connected = false;
    (this.peers[0].driver as LockstepHost).removePeer(`p${i}`, 999 + i);
  }

  /** Krok wirtualnego czasu o dt ms: dostarczenie pakietow, poll, ticki symulacji. */
  advance(dt: number): void {
    this.now += dt;
    this.queue.sort((a, b) => a.at - b.at);
    while (this.queue.length && this.queue[0].at <= this.now) {
      const p = this.queue.shift()!;
      const peer = this.peers[p.to];
      if (!peer.connected) continue;
      if (p.to === 0) (peer.driver as LockstepHost).onMessage(`p${p.from}`, p.msg);
      else (peer.driver as LockstepClient).onMessage(p.msg);
    }
    for (const peer of this.peers) {
      if (!peer.connected) continue;
      // Gracz (tu bot po stronie peera) wydaje komendy przez siec.
      if (peer.bot) for (const c of peer.bot.think(peer.state)) peer.driver.submit(c);
      peer.driver.poll?.();
      const backlog = peer.driver.backlog();
      peer.acc += dt * (backlog > 2 ? 1 + (backlog - 2) * 0.5 : 1);
      let steps = 0;
      while (peer.acc >= 100 && steps < 20 && peer.state.tick < this.stopAt) {
        const cmds = peer.driver.commandsFor(peer.state.tick, peer.state);
        if (!cmds) { peer.acc = Math.min(peer.acc, 100); break; }
        const t0 = performance.now();
        step(peer.state, cmds);
        const ms = performance.now() - t0;
        if (ms > peer.maxTickMs && peer.state.tick > 5) peer.maxTickMs = ms;
        peer.driver.afterTick(peer.state);
        peer.acc -= 100;
        steps++;
      }
    }
  }

  /** Najmniejszy tick wsrod polaczonych peerow. */
  minTick(): number {
    let t = Infinity;
    for (const p of this.peers) if (p.connected) t = Math.min(t, p.state.tick);
    return t;
  }

  hashes(): number[] {
    return this.peers.filter((p) => p.connected).map((p) => hashAny(p.state));
  }
}
