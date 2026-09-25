/**
 * Pokoj gry sieciowej: lobby i przejscie do lockstepu. Host trzyma stan lobby i rozsyla go;
 * klienci wysylaja tylko swoje zmiany (gotowosc, kolor). Dolaczanie wylacznie w lobby.
 */
import { MAX_PLAYERS, PLAYER_COLORS } from '../sim/defs.ts';
import type { GameConfig } from '../sim/types.ts';
import { LockstepClient, LockstepHost } from './lockstep.ts';
import { NET_VERSION, type LobbyState, type NetMsg } from './protocol.ts';
import { PeerLink } from './rtc.ts';
import { SignalClient } from './signaling.ts';

export interface RoomEvents {
  onLobby?(state: LobbyState): void;
  onStart?(config: GameConfig, player: number, driver: LockstepHost | LockstepClient): void;
  onHostLost?(): void;
  onError?(text: string): void;
  onPeerLeft?(name: string): void;
}

function freeColor(state: LobbyState): number {
  for (let c = 0; c < PLAYER_COLORS.length; c++) {
    if (!state.players.some((p) => p.color === PLAYER_COLORS[c])) return PLAYER_COLORS[c];
  }
  return PLAYER_COLORS[0];
}

// ---------------- Host ----------------

export class NetHost {
  readonly signal: SignalClient;
  state: LobbyState;
  events: RoomEvents = {};
  private links = new Map<string, PeerLink>();
  private lockstep: LockstepHost | null = null;
  private started = false;
  private now: () => number;

  constructor(signal: SignalClient, room: string, name: string, now: () => number = () => performance.now()) {
    this.signal = signal;
    this.now = now;
    this.state = {
      room,
      mapCode: 'DOLINA',
      mapSize: 96,
      players: [{ peerId: signal.peerId, name, color: PLAYER_COLORS[0], ready: true, ai: 0 }],
    };
    signal.events = {
      onPeer: (peer) => this.onPeer(peer),
      onSignal: (from, data) => void this.links.get(from)?.signal(data),
      onLeft: (peer) => this.onLeft(peer),
      onClose: () => { if (!this.started) this.events.onError?.('Utracono połączenie z serwerem sygnalizacyjnym.'); },
    };
  }

  private onPeer(peer: string): void {
    if (this.started) return;
    const link = new PeerLink(peer, this.signal.iceServers, (d) => this.signal.signal(peer, d), true);
    this.links.set(peer, link);
    link.onMessage = (m) => this.onMessage(peer, m);
    link.onClose = () => this.onLeft(peer);
  }

  private onLeft(peer: string): void {
    const link = this.links.get(peer);
    if (!link) return;
    this.links.delete(peer);
    const pl = this.state.players.find((p) => p.peerId === peer);
    if (this.started) {
      if (pl) this.events.onPeerLeft?.(pl.name);
      this.lockstep?.removePeer(peer, (this.now() | 0) + 17);
      return;
    }
    if (pl) {
      this.state.players = this.state.players.filter((p) => p !== pl);
      this.broadcastLobby();
    }
  }

  private onMessage(peer: string, m: NetMsg): void {
    if (this.started) {
      this.lockstep?.onMessage(peer, m);
      return;
    }
    const link = this.links.get(peer);
    if (!link) return;
    switch (m.t) {
      case 'hello': {
        if (m.ver !== NET_VERSION) {
          link.send({ t: 'kick', reason: 'Inna wersja gry - odśwież stronę.' });
          return;
        }
        if (this.state.players.length >= MAX_PLAYERS) {
          link.send({ t: 'kick', reason: 'Pokój jest pełny.' });
          return;
        }
        this.state.players.push({ peerId: peer, name: String(m.name).slice(0, 20) || 'Gracz', color: freeColor(this.state), ready: false, ai: 0 });
        this.broadcastLobby();
        return;
      }
      case 'ready': {
        const p = this.state.players.find((x) => x.peerId === peer);
        if (p) p.ready = !!m.v;
        this.broadcastLobby();
        return;
      }
      case 'color': {
        const p = this.state.players.find((x) => x.peerId === peer);
        if (p && PLAYER_COLORS.includes(m.c) && !this.state.players.some((x) => x !== p && x.color === m.c)) p.color = m.c;
        this.broadcastLobby();
        return;
      }
    }
  }

  broadcastLobby(): void {
    const msg: NetMsg = { t: 'lobby', state: this.state };
    for (const l of this.links.values()) l.send(msg);
    this.events.onLobby?.(this.state);
  }

  setMap(code: string, size: number): void {
    this.state.mapCode = code;
    this.state.mapSize = size;
    for (const p of this.state.players) if (p.ai === 0 && p.peerId !== this.signal.peerId) p.ready = false;
    this.broadcastLobby();
  }

  setColor(c: number): void {
    const me = this.state.players[0];
    if (!this.state.players.some((x) => x !== me && x.color === c)) me.color = c;
    this.broadcastLobby();
  }

  addBot(level: number): void {
    if (this.state.players.length >= MAX_PLAYERS) return;
    const n = this.state.players.filter((p) => p.ai > 0).length + 1;
    this.state.players.push({ peerId: '', name: `${level >= 2 ? 'Trudny' : 'Łatwy'} bot ${n}`, color: freeColor(this.state), ready: true, ai: level });
    this.broadcastLobby();
  }

  removePlayer(index: number): void {
    const p = this.state.players[index];
    if (!p || index === 0) return;
    if (p.ai === 0) {
      this.links.get(p.peerId)?.send({ t: 'kick', reason: 'Gospodarz usunął cię z pokoju.' });
      this.links.get(p.peerId)?.close();
      this.links.delete(p.peerId);
    }
    this.state.players.splice(index, 1);
    this.broadcastLobby();
  }

  canStart(): boolean {
    return this.state.players.length >= 2 && this.state.players.every((p) => p.ready) &&
      this.state.players.every((p) => p.ai > 0 || p.peerId === this.signal.peerId || this.links.get(p.peerId)?.open);
  }

  start(): void {
    if (!this.canStart() || this.started) return;
    this.started = true;
    this.signal.lock();
    const seed = (Math.floor(this.now() * 1000) ^ 0x5bd1e995) >>> 0;
    const config: GameConfig = {
      mapCode: this.state.mapCode,
      mapSize: this.state.mapSize,
      players: this.state.players.map((p) => ({ name: p.name, color: p.color, ai: p.ai })),
      seed,
    };
    const host = new LockstepHost(0, this.now);
    this.lockstep = host;
    this.state.players.forEach((p, i) => {
      if (i === 0) return;
      if (p.ai > 0) host.addBot(i, p.ai, seed * 7919 + i);
      else {
        const link = this.links.get(p.peerId);
        if (!link) return;
        host.addPeer(p.peerId, i, (m) => link.send(m));
        link.send({ t: 'start', config, player: i });
      }
    });
    this.events.onStart?.(config, 0, host);
  }

  close(): void {
    for (const l of this.links.values()) l.close();
    this.signal.close();
  }
}

// ---------------- Klient ----------------

export class NetClient {
  readonly signal: SignalClient;
  events: RoomEvents = {};
  state: LobbyState | null = null;
  private link: PeerLink | null = null;
  private lockstep: LockstepClient | null = null;
  private name: string;
  private ended = false;

  constructor(signal: SignalClient, hostId: string, name: string) {
    this.signal = signal;
    this.name = name;
    const link = new PeerLink(hostId, signal.iceServers, (d) => signal.signal(hostId, d), false);
    this.link = link;
    link.onOpen = () => link.send({ t: 'hello', name: this.name, ver: NET_VERSION });
    link.onMessage = (m) => this.onMessage(m);
    link.onClose = () => this.hostLost();
    signal.events = {
      onSignal: (_from, data) => void link.signal(data),
      onHostLeft: () => this.hostLost(),
    };
  }

  private hostLost(): void {
    if (this.ended) return;
    this.ended = true;
    this.events.onHostLost?.();
  }

  private onMessage(m: NetMsg): void {
    if (this.lockstep) {
      this.lockstep.onMessage(m);
      return;
    }
    switch (m.t) {
      case 'lobby':
        this.state = m.state;
        this.events.onLobby?.(m.state);
        return;
      case 'kick':
        this.ended = true;
        this.events.onError?.(m.reason);
        this.close();
        return;
      case 'start': {
        const link = this.link!;
        this.lockstep = new LockstepClient(m.player, (msg) => link.send(msg));
        this.events.onStart?.(m.config, m.player, this.lockstep);
        return;
      }
    }
  }

  setReady(v: boolean): void {
    this.link?.send({ t: 'ready', v });
  }

  setColor(c: number): void {
    this.link?.send({ t: 'color', c });
  }

  close(): void {
    this.ended = true;
    this.link?.close();
    this.signal.close();
  }
}
