/**
 * Deterministyczny lockstep w topologii gwiazdy. Host zbiera komendy od wszystkich, co ture
 * (TURN_TICKS tickow) zamyka liste i rozsyla ja wszystkim, lacznie z soba. Kazdy peer wykonuje
 * ture dopiero, gdy ja dostal. Host nie wyprzedza najwolniejszego klienta o wiecej niz MAX_AHEAD tur.
 *
 * Kod nie zna WebRTC ani zegara: transport to funkcje send, czas to wstrzykniete now(),
 * dzieki czemu da sie go testowac w Node na symulowanej sieci.
 */
import { Bot } from '../ai/bot.ts';
import type { Command } from '../sim/commands.ts';
import { hashAny, serialize } from '../sim/hash.ts';
import type { GameState } from '../sim/types.ts';
import { HASH_EVERY, TURN_TICKS, type NetMsg } from './protocol.ts';

export const TURN_MS = 100 * TURN_TICKS;
export const MAX_AHEAD = 12;
/** Ile ostatnich tur trzymamy do diagnostyki desynchronizacji. */
const HISTORY = 60;

export interface DesyncInfo {
  tick: number;
  player: number;
  local: number;
  remote: number;
  recentTurns: [number, Command[]][];
  state: string;
}

/** Wspolna czesc: bufor tur, wykonywanie, hash, historia. */
abstract class LockstepBase {
  protected turns = new Map<number, Command[]>();
  protected history: [number, Command[]][] = [];
  readonly localPlayer: number;
  desync: DesyncInfo | null = null;
  onDesync: ((d: DesyncInfo) => void) | null = null;
  onTakeover: ((player: number) => void) | null = null;
  lastExecutedTurn = -1;
  protected state: GameState | null = null;

  constructor(localPlayer: number) {
    this.localPlayer = localPlayer;
  }

  /** TickDriver: komendy dla ticku albo null, gdy tura jeszcze nie dotarla. */
  commandsFor(tick: number, state: GameState): Command[] | null {
    this.state = state;
    if (tick % TURN_TICKS !== 0) return [];
    const n = tick / TURN_TICKS;
    const cmds = this.turns.get(n);
    if (!cmds) return null;
    this.turns.delete(n);
    this.history.push([n, cmds]);
    if (this.history.length > HISTORY) this.history.shift();
    this.lastExecutedTurn = n;
    this.onTurnExecuted(n);
    return cmds;
  }

  /** Liczba tur czekajacych w buforze (do przyspieszania, gdy peer zostaje w tyle). */
  backlog(): number {
    return this.turns.size;
  }

  /** Po wykonaniu ticku: hash co HASH_EVERY. */
  afterTick(state: GameState): void {
    if (state.tick % HASH_EVERY === 0) this.onHash(state.tick, hashAny(state));
  }

  protected makeDesync(tick: number, player: number, local: number, remote: number): DesyncInfo {
    return {
      tick,
      player,
      local,
      remote,
      recentTurns: this.history.slice(),
      state: this.state ? serialize(this.state) : '',
    };
  }

  protected reportDesync(d: DesyncInfo): void {
    if (this.desync) return;
    this.desync = d;
    this.onDesync?.(d);
  }

  protected abstract onTurnExecuted(n: number): void;
  protected abstract onHash(tick: number, h: number): void;
  abstract submit(cmd: Command): void;
  poll?(): void;
}

// ---------------- Klient ----------------

export class LockstepClient extends LockstepBase {
  private sendToHost: (m: NetMsg) => void;
  private outbox: Command[] = [];

  constructor(localPlayer: number, sendToHost: (m: NetMsg) => void) {
    super(localPlayer);
    this.sendToHost = sendToHost;
  }

  submit(cmd: Command): void {
    this.outbox.push({ ...cmd, player: this.localPlayer } as Command);
  }

  /** Wysyla zebrane komendy (raz na klatke - mniej wiadomosci). */
  override poll(): void {
    if (this.outbox.length === 0) return;
    this.sendToHost({ t: 'cmd', cmds: this.outbox });
    this.outbox = [];
  }

  onMessage(m: NetMsg): void {
    switch (m.t) {
      case 'turn':
        if (m.n > this.lastExecutedTurn) this.turns.set(m.n, m.cmds);
        return;
      case 'desync':
        this.reportDesync(this.makeDesync(m.tick, m.player, 0, 0));
        return;
      case 'takeover':
        this.onTakeover?.(m.player);
        return;
    }
  }

  protected onTurnExecuted(n: number): void {
    this.sendToHost({ t: 'ack', n });
  }

  protected onHash(tick: number, h: number): void {
    this.sendToHost({ t: 'hash', tick, h });
  }
}

// ---------------- Host ----------------

interface RemotePeer {
  id: string;
  player: number;
  send: (m: NetMsg) => void;
  acked: number;
  alive: boolean;
}

export class LockstepHost extends LockstepBase {
  private peers = new Map<string, RemotePeer>();
  private pending: Command[] = [];
  private nextTurn = 0;
  private startMs = -1;
  private now: () => number;
  private ownHashes = new Map<number, number>();
  private peerHashes = new Map<number, [number, number][]>();
  private bots: Bot[] = [];
  /** Gracze-boty (sloty AI i przejete po rozlaczeniu). */
  readonly botPlayers: number[] = [];

  constructor(localPlayer: number, now: () => number) {
    super(localPlayer);
    this.now = now;
  }

  addPeer(id: string, player: number, send: (m: NetMsg) => void): void {
    this.peers.set(id, { id, player, send, acked: -1, alive: true });
  }

  /** Bot dla gracza (slot AI albo przejecie po rozlaczeniu). */
  addBot(player: number, level: number, seed: number): void {
    if (this.botPlayers.includes(player)) return;
    this.bots.push(new Bot(player, level, seed));
    this.botPlayers.push(player);
  }

  /** Peer sie rozlaczyl: jego osade przejmuje bot, pozostali dostaja informacje. */
  removePeer(id: string, seed: number): number {
    const p = this.peers.get(id);
    if (!p || !p.alive) return -1;
    p.alive = false;
    this.addBot(p.player, 2, seed);
    this.broadcast({ t: 'takeover', player: p.player });
    this.onTakeover?.(p.player);
    return p.player;
  }

  submit(cmd: Command): void {
    this.pending.push({ ...cmd, player: this.localPlayer } as Command);
  }

  onMessage(id: string, m: NetMsg): void {
    const p = this.peers.get(id);
    if (!p || !p.alive) return;
    switch (m.t) {
      case 'cmd':
        // Host nadpisuje gracza - peer moze wydawac komendy tylko za siebie.
        for (const c of m.cmds) if (c && typeof c === 'object') this.pending.push({ ...c, player: p.player } as Command);
        return;
      case 'ack':
        if (m.n > p.acked) p.acked = m.n;
        return;
      case 'hash': {
        const own = this.ownHashes.get(m.tick);
        if (own !== undefined) this.compare(m.tick, p.player, own, m.h);
        else {
          const list = this.peerHashes.get(m.tick) ?? [];
          list.push([p.player, m.h]);
          this.peerHashes.set(m.tick, list);
        }
        return;
      }
    }
  }

  private compare(tick: number, player: number, own: number, remote: number): void {
    if (own === remote) return;
    const d = this.makeDesync(tick, player, own, remote);
    this.broadcast({ t: 'desync', tick, player });
    this.reportDesync(d);
  }

  private broadcast(m: NetMsg): void {
    for (const p of this.peers.values()) if (p.alive) p.send(m);
  }

  /** Najstarsza tura potwierdzona przez wszystkich zywych klientow. */
  private minAck(): number {
    let min = this.lastExecutedTurn;
    for (const p of this.peers.values()) if (p.alive && p.acked < min) min = p.acked;
    return min;
  }

  /** Zamyka kolejne tury wg zegara, o ile klienci nadazaja. */
  override poll(): void {
    const now = this.now();
    if (this.startMs < 0) this.startMs = now;
    // Boty mysla na stanie hosta; ich komendy trafiaja do najblizszej tury.
    if (this.state) for (const b of this.bots) for (const c of b.think(this.state)) this.pending.push(c);
    const target = Math.floor((now - this.startMs) / TURN_MS) + 1;
    while (this.nextTurn < target && this.nextTurn - this.minAck() <= MAX_AHEAD) {
      const n = this.nextTurn++;
      const cmds = this.pending;
      this.pending = [];
      this.turns.set(n, cmds);
      this.broadcast({ t: 'turn', n, cmds });
    }
  }

  protected onTurnExecuted(_n: number): void {}

  protected onHash(tick: number, h: number): void {
    this.ownHashes.set(tick, h);
    const waiting = this.peerHashes.get(tick);
    if (waiting) {
      for (const [player, rh] of waiting) this.compare(tick, player, h, rh);
      this.peerHashes.delete(tick);
    }
    // Stare hashe nie sa juz potrzebne.
    for (const t of this.ownHashes.keys()) if (t < tick - HASH_EVERY * 40) this.ownHashes.delete(t);
  }

  get alivePeers(): number {
    let n = 0;
    for (const p of this.peers.values()) if (p.alive) n++;
    return n;
  }
}
