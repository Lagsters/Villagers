/**
 * Sesja gry: stan symulacji + zrodlo komend (lokalne albo lockstep sieciowy) + stale tempo 10 tickow/s.
 * Renderer dostaje alpha (0..1) do interpolacji miedzy tickami.
 */
import type { Command } from '../../sim/commands.ts';
import { step } from '../../sim/step.ts';
import type { GameEvent, GameState } from '../../sim/types.ts';

export const TICK_MS = 100;

export interface TickDriver {
  /** Komendy dla ticku albo null, jesli jeszcze niedostepne (czekamy na siec). */
  commandsFor(tick: number, state: GameState): Command[] | null;
  submit(cmd: Command): void;
  /** Wywolywane co klatke (np. obsluga sieci). */
  poll?(): void;
  /** Po kazdym ticku (np. hash stanu w sieci). */
  afterTick?(state: GameState): void;
  /** Liczba tur w buforze - sesja przyspiesza, gdy peer zostaje w tyle. */
  backlog?(): number;
  dispose?(): void;
}

/** Gra lokalna: komendy gracza i botow trafiaja do najblizszego ticku. */
export class LocalDriver implements TickDriver {
  private pending: Command[] = [];
  /** Dodatkowe zrodla komend (boty) wywolywane przed kazdym tickiem. */
  producers: ((s: GameState) => Command[])[] = [];

  submit(cmd: Command): void {
    this.pending.push(cmd);
  }

  commandsFor(_tick: number, state: GameState): Command[] {
    const out = this.pending;
    this.pending = [];
    for (const p of this.producers) for (const c of p(state)) out.push(c);
    return out;
  }
}

export class GameSession {
  state: GameState;
  driver: TickDriver;
  localPlayer: number;
  speed = 1;
  paused = false;
  private acc = 0;
  /** Zdarzenia od ostatniego odczytu (UI, dzwieki). */
  events: GameEvent[] = [];
  lastTickMs = 0;
  onTick: ((s: GameState) => void)[] = [];

  constructor(state: GameState, driver: TickDriver, localPlayer: number) {
    this.state = state;
    this.driver = driver;
    this.localPlayer = localPlayer;
  }

  submit(cmd: Command): void {
    this.driver.submit(cmd);
  }

  get alpha(): number {
    return Math.min(1, this.acc / TICK_MS);
  }

  update(dtMs: number): void {
    this.driver.poll?.();
    if (this.paused) return;
    // W sieci: gdy w buforze czeka kilka tur, gramy szybciej, zeby dogonic hosta.
    const backlog = this.driver.backlog?.() ?? 0;
    const catchUp = backlog > 2 ? 1 + (backlog - 2) * 0.5 : 1;
    this.acc += Math.min(dtMs, 250) * this.speed * catchUp;
    let steps = 0;
    const maxSteps = Math.max(4, this.speed * catchUp * 3);
    while (this.acc >= TICK_MS && steps < maxSteps) {
      const cmds = this.driver.commandsFor(this.state.tick, this.state);
      if (!cmds) {
        this.acc = Math.min(this.acc, TICK_MS);
        break;
      }
      const t0 = performance.now();
      step(this.state, cmds);
      this.driver.afterTick?.(this.state);
      this.lastTickMs = performance.now() - t0;
      for (const e of this.state._events) this.events.push(e);
      for (const f of this.onTick) f(this.state);
      this.acc -= TICK_MS;
      steps++;
    }
    if (steps >= maxSteps) this.acc = Math.min(this.acc, TICK_MS);
  }

  takeEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}
