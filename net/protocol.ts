/**
 * Wiadomosci przesylane kanalem danych miedzy peerami (gwiazda: host <-> klient).
 */
import type { Command } from '../sim/commands.ts';
import type { GameConfig } from '../sim/types.ts';

export const NET_VERSION = 1;
/** Tickow na ture lockstepu. */
export const TURN_TICKS = 2;
/** Co ile tickow peery porownuja hash stanu. */
export const HASH_EVERY = 50;

export interface LobbyPlayer {
  /** id peera (z serwera sygnalizacyjnego); '' dla bota */
  peerId: string;
  name: string;
  color: number;
  ready: boolean;
  /** 0 = czlowiek, 1/2 = bot */
  ai: number;
}

export interface LobbyState {
  room: string;
  mapCode: string;
  mapSize: number;
  players: LobbyPlayer[];
}

export type NetMsg =
  // --- lobby ---
  | { t: 'hello'; name: string; ver: number }
  | { t: 'lobby'; state: LobbyState }
  | { t: 'ready'; v: boolean }
  | { t: 'color'; c: number }
  | { t: 'start'; config: GameConfig; player: number }
  | { t: 'kick'; reason: string }
  // --- gra ---
  | { t: 'cmd'; cmds: Command[] }
  | { t: 'turn'; n: number; cmds: Command[] }
  | { t: 'ack'; n: number }
  | { t: 'hash'; tick: number; h: number }
  | { t: 'desync'; tick: number; player: number }
  | { t: 'takeover'; player: number }
  | { t: 'chat'; from: string; text: string };
