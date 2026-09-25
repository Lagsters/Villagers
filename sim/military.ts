/**
 * Wojsko: strefy i obsada budynkow, szkolenie zlotem, morale, atak, obrona, pojedynki,
 * przejmowanie budynkow, eliminacja graczy i zwyciestwo.
 *
 * Pola rycerza: home = budynek macierzysty, target = budynek-cel (atak/obrona),
 * sub = przeciwnik w pojedynku (-1 brak), hp = punkty zycia w walce, timer = zegar rundy.
 */
import { B, BUILDINGS, G, S, isMilitary } from './defs.ts';
import { destroyBuilding, applyTerritoryLoss } from './construction.ts';
import { DIR_NW, DIR_SE, hexDist, spiral } from './grid.ts';
import { clearFlagGoods } from './goods.ts';
import { findPath } from './pathfind.ts';
import { chance, randInt } from './rng.ts';
import { removeFlag, removeRoad } from './roads.ts';
import { invalidateRoutes } from './routing.ts';
import { SS, createSerf, enterInventory, killSerf, sendHome } from './serfs.ts';
import { STAGE, type Building, type GameState, type Serf } from './types.ts';
import type { Command } from './commands.ts';
import { event, isFreeWalkable, nb, recomputeTerritory } from './world.ts';

export const ATTACK_RANGE = 18;
export const TRAIN_TICKS = 600;
export const CASTLE_TRAIN_TICKS = 900;
export const ROUND_TICKS = 6;
export const ZONE_PERIOD = 50;
export const ZONE = { INTERIOR: 0, BORDER: 1, ENEMY: 2 } as const;

function dist(s: GameState, a: number, b: number): number {
  const w = s.map.w;
  return hexDist(a % w, (a / w) | 0, b % w, (b / w) | 0);
}

// ---------- Strefy i obsada ----------

/** Strefa budynku wojskowego (przechowywana w b.phase). */
export function computeZone(s: GameState, b: Building): number {
  const m = s.map;
  const own = b.owner + 1;
  let border = false;
  for (const i of spiral(m.w, m.h, b.pos % m.w, (b.pos / m.w) | 0, 12)) {
    const o = m.owner[i];
    if (o !== 0 && o !== own) return ZONE.ENEMY;
    if (o === 0 && !border && dist(s, i, b.pos) <= 6) border = true;
  }
  return border ? ZONE.BORDER : ZONE.INTERIOR;
}

export function desiredKnights(s: GameState, b: Building): number {
  const st = s.players[b.owner].settings;
  const cap = BUILDINGS[b.kind].knights;
  const want = b.phase === ZONE.ENEMY ? st.knightsEnemy : b.phase === ZONE.BORDER ? st.knightsBorder : st.knightsInterior;
  return Math.max(1, Math.min(cap, want));
}

/** Aktualizacja stref co ZONE_PERIOD tickow i odsylanie nadmiarowych rycerzy. */
function updateGarrisons(s: GameState): void {
  if (s.tick % ZONE_PERIOD !== 0) return;
  for (const b of s.buildings) {
    if (!b || !isMilitary(b.kind) || b.stage !== STAGE.DONE) continue;
    b.phase = computeZone(s, b);
    const want = desiredKnights(s, b);
    while (b.knights.length > want && b.knights.length > 1) {
      // Odsylamy najslabszego.
      let wi = 0;
      for (let i = 1; i < b.knights.length; i++) if ((s.serfs[b.knights[i]]?.level ?? 0) < (s.serfs[b.knights[wi]]?.level ?? 0)) wi = i;
      const k = s.serfs[b.knights[wi]];
      b.knights.splice(wi, 1);
      if (k) {
        // Wychodzi na flage; stan LOST z zegarem 1 wywola sendHome zaraz po kroku.
        k.path = [DIR_SE];
        k.target = -1;
        k.home = -1;
        k.sub = 0;
        k.state = SS.LOST;
        k.timer = 1;
      }
    }
  }
}

/** Rycerz doszedl do budynku wojskowego. */
export function knightArrive(s: GameState, serf: Serf, b: Building): boolean {
  if (serf.type !== S.KNIGHT || !isMilitary(b.kind) || b.stage !== STAGE.DONE) return false;
  if (b.knights.length >= BUILDINGS[b.kind].knights) return false;
  b.knights.push(serf.id);
  serf.state = SS.INSIDE;
  serf.home = b.id;
  serf.target = -1;
  serf.sub = -1;
  serf.anim = 0;
  if (b.knights.length === 1) {
    b.phase = computeZone(s, b);
    const changed = recomputeTerritory(s, b.pos, BUILDINGS[b.kind].radius);
    applyTerritoryLoss(s, changed);
    event(s, 'occupied', b.owner, b.pos, b.kind);
  }
  return true;
}

// ---------- Szkolenie i morale ----------

function goldOf(s: GameState, p: number): number {
  let g = 0;
  for (const b of s.buildings) {
    if (!b || b.owner !== p || b.stage === STAGE.BURN) continue;
    if (b.inv) g += b.inv.goods[G.GOLD];
    if (isMilitary(b.kind)) g += b.gold;
  }
  return g;
}

function training(s: GameState): void {
  for (const pl of s.players) {
    if (pl.alive && s.tick % 50 === pl.id) pl.morale = 50 + Math.min(50, 4 * goldOf(s, pl.id));
  }
  for (const b of s.buildings) {
    if (!b || b.stage !== STAGE.DONE) continue;
    if (isMilitary(b.kind)) {
      if (b.gold <= 0 || b.knights.length === 0) continue;
      if (++b.trainTimer < TRAIN_TICKS) continue;
      b.trainTimer = 0;
      let weakest: Serf | null = null;
      for (const id of b.knights) {
        const k = s.serfs[id];
        if (k && k.level < 4 && (!weakest || k.level < weakest.level)) weakest = k;
      }
      if (weakest) weakest.level++;
    } else if (b.kind === B.CASTLE && b.inv) {
      const inv = b.inv;
      if (inv.goods[G.GOLD] <= 0) continue;
      if (++b.trainTimer < CASTLE_TRAIN_TICKS) continue;
      b.trainTimer = 0;
      for (let l = 0; l < 4; l++) {
        if (inv.knights[l] > 0) {
          inv.knights[l]--;
          inv.knights[l + 1]++;
          break;
        }
      }
    }
  }
}

// ---------- Atak ----------

function castleKnightsAvailable(s: GameState, b: Building): number {
  if (!b.inv) return 0;
  const total = b.inv.knights.reduce((a, c) => a + c, 0);
  return Math.max(0, total - s.players[b.owner].settings.castleKnights);
}

/** Czy budynek moze byc celem ataku gracza p. */
export function isAttackTarget(_s: GameState, p: number, t: Building | null): t is Building {
  if (!t || t.owner === p || t.stage !== STAGE.DONE) return false;
  if (t.kind === B.CASTLE) return true;
  return isMilitary(t.kind) && t.knights.length > 0;
}

/** Budynki, z ktorych mozna wyslac rycerzy na cel, z liczba dostepnych rycerzy. */
export function attackSources(s: GameState, p: number, target: Building): [Building, number][] {
  const out: [Building, number][] = [];
  for (const b of s.buildings) {
    if (!b || b.owner !== p || b.stage !== STAGE.DONE) continue;
    if (dist(s, b.pos, target.pos) > ATTACK_RANGE) continue;
    if (isMilitary(b.kind)) {
      if (b.knights.length > 1) out.push([b, b.knights.length - 1]);
    } else if (b.kind === B.CASTLE) {
      const n = castleKnightsAvailable(s, b);
      if (n > 0) out.push([b, n]);
    }
  }
  out.sort((a, c) => dist(s, a[0].pos, target.pos) - dist(s, c[0].pos, target.pos) || a[0].id - c[0].id);
  return out;
}

/**
 * Poziomy rycerzy, ktorych wyslalaby komenda ataku o danej liczbie (w tej samej kolejnosci:
 * zrodla wg odleglosci, z kazdego najsilniejsi). Uzywane przez boty i UI.
 */
export function attackPreview(s: GameState, p: number, target: Building, count: number): number[] {
  const out: number[] = [];
  for (const [b, n] of attackSources(s, p, target)) {
    let take = Math.min(n, count - out.length);
    if (take <= 0) break;
    if (b.inv) {
      for (let l = 4; l >= 0 && take > 0; l--) {
        const k = Math.min(take, b.inv.knights[l]);
        for (let i = 0; i < k; i++) out.push(l);
        take -= k;
      }
    } else {
      const lv = b.knights.map((id) => s.serfs[id]?.level ?? 0).sort((a, c) => c - a);
      for (let i = 0; i < take; i++) out.push(lv[i]);
    }
  }
  return out;
}

/** Poziomy obroncow celu. */
export function defenderLevels(s: GameState, t: Building): number[] {
  const out: number[] = [];
  if (t.inv) {
    for (let l = 0; l < 5; l++) for (let i = 0; i < t.inv.knights[l]; i++) out.push(l);
  } else for (const id of t.knights) out.push(s.serfs[id]?.level ?? 0);
  return out;
}

export function attackersAvailable(s: GameState, p: number, target: Building): number {
  return attackSources(s, p, target).reduce((a, [, n]) => a + n, 0);
}

/** Pole przy fladze celu, na ktorym atakujacy czeka na obronce. */
function waitSpot(s: GameState, target: Building, k: number): number {
  const m = s.map;
  const fp = s.flags[target.flag]!.pos;
  const t = nb(m);
  const order = [0, 1, 2, 3, 5];
  for (let i = 0; i < order.length; i++) {
    const j = t[fp * 6 + order[(k + i) % order.length]];
    if (j >= 0 && isFreeWalkable(m, j)) return j;
  }
  return fp;
}

function launchKnight(s: GameState, k: Serf, target: Building, idx: number): boolean {
  const m = s.map;
  const spot = waitSpot(s, target, idx);
  const startFlag = m.obj[k.pos] === 20 ? nb(m)[k.pos * 6 + DIR_SE] : k.pos;
  const path = findPath(m, startFlag, spot, (i) => isFreeWalkable(m, i) || i === s.flags[target.flag]!.pos, 6000);
  if (!path) return false;
  k.path = startFlag !== k.pos ? [DIR_SE, ...path] : path;
  k.state = SS.KNIGHT_ATTACK;
  k.target = target.id;
  k.sub = -1;
  k.anim = 0;
  return true;
}

export function commandAttack(s: GameState, c: Command): void {
  if (c.type !== 'attack') return;
  const m = s.map;
  const bid = m.objId[c.pos];
  const target = bid >= 0 && (m.obj[c.pos] === 20 || m.obj[c.pos] === 21) ? s.buildings[bid] : null;
  if (!isAttackTarget(s, c.player, target)) return;
  let left = Math.max(0, Math.min(50, c.count | 0));
  let launched = 0;
  for (const [b, n] of attackSources(s, c.player, target)) {
    if (left <= 0) break;
    let take = Math.min(n, left);
    if (b.inv) {
      // Z zamku: najsilniejsi rycerze jako encje.
      while (take > 0) {
        let lvl = -1;
        for (let l = 4; l >= 0; l--) if (b.inv.knights[l] > 0) { lvl = l; break; }
        if (lvl < 0) break;
        b.inv.knights[lvl]--;
        const k = createSerf(s, c.player, S.KNIGHT, b.pos);
        k.level = lvl;
        k.home = b.id;
        if (!launchKnight(s, k, target, launched)) {
          b.inv.knights[lvl]++;
          s.serfs[k.id] = null;
          s.freeSerfs.push(k.id);
          break;
        }
        launched++;
        take--;
        left--;
      }
    } else {
      // Z budynku wojskowego: najsilniejsi, zostaje co najmniej jeden.
      const ids = b.knights.slice().sort((a, d) => (s.serfs[d]?.level ?? 0) - (s.serfs[a]?.level ?? 0) || a - d);
      for (const id of ids) {
        if (take <= 0 || b.knights.length <= 1) break;
        const k = s.serfs[id];
        if (!k) continue;
        if (!launchKnight(s, k, target, launched)) break;
        b.knights.splice(b.knights.indexOf(id), 1);
        k.home = b.id;
        launched++;
        take--;
        left--;
      }
    }
  }
  if (launched > 0) {
    s.players[target.owner].lastAttacked = s.tick;
    event(s, 'attack', target.owner, target.pos, c.player);
  }
}

// ---------- Walka ----------

function hitChance(s: GameState, a: Serf, d: Serf): number {
  const ma = s.players[a.owner].morale;
  const md = s.players[d.owner].morale;
  const v = 50 + 10 * (a.level - d.level) + Math.trunc((ma - md) / 4);
  return v < 10 ? 10 : v > 90 ? 90 : v;
}

/** Rycerz wraca do budynku macierzystego (jesli jest wolne miejsce), inaczej do magazynu. */
function returnKnight(s: GameState, k: Serf): void {
  k.sub = -1;
  k.anim = 0;
  const home = s.buildings[k.home];
  const m = s.map;
  if (home && home.owner === k.owner && home.stage === STAGE.DONE) {
    const fp = s.flags[home.flag]!.pos;
    if (isMilitary(home.kind) && home.knights.length < BUILDINGS[home.kind].knights || home.inv) {
      const p = findPath(m, k.to >= 0 ? k.to : k.pos, fp, (i) => isFreeWalkable(m, i), 6000);
      if (p) {
        k.path = [...p, DIR_NW];
        k.state = SS.KNIGHT_RETURN;
        k.target = home.id;
        return;
      }
    }
  }
  sendHome(s, k);
}

/** Wysyla obronce z budynku przeciwko czekajacemu atakujacemu. */
function sendDefender(s: GameState, b: Building, attacker: Serf): void {
  const m = s.map;
  let d: Serf;
  if (b.inv) {
    let lvl = -1;
    for (let l = 4; l >= 0; l--) if (b.inv.knights[l] > 0) { lvl = l; break; }
    if (lvl < 0) return;
    b.inv.knights[lvl]--;
    d = createSerf(s, b.owner, S.KNIGHT, b.pos);
    d.level = lvl;
  } else {
    // Najsilniejszy z obsady.
    let bi = -1;
    for (let i = 0; i < b.knights.length; i++) {
      const k = s.serfs[b.knights[i]];
      if (k && (bi < 0 || k.level > s.serfs[b.knights[bi]]!.level)) bi = i;
    }
    if (bi < 0) return;
    d = s.serfs[b.knights[bi]]!;
    b.knights.splice(bi, 1);
  }
  d.home = b.id;
  d.target = b.id;
  d.sub = attacker.id;
  d.state = SS.KNIGHT_DEFEND;
  const fp = s.flags[b.flag]!.pos;
  const p = attacker.pos === fp ? [] : findPath(m, fp, attacker.pos, (i) => isFreeWalkable(m, i) || i === fp, 200);
  d.path = [DIR_SE, ...(p ?? [])];
  attacker.sub = d.id;
}

function startDuel(s: GameState, a: Serf, d: Serf): void {
  a.state = SS.KNIGHT_FIGHT;
  d.state = SS.KNIGHT_FIGHT;
  a.sub = d.id;
  d.sub = a.id;
  a.hp = 3 + a.level;
  d.hp = 3 + d.level;
  a.timer = ROUND_TICKS;
  a.anim = 2;
  d.anim = 2;
  event(s, 'duel', d.owner, a.pos);
}

/** Pojedynek prowadzi atakujacy (tylko on losuje), zeby runda liczyla sie raz. */
function fightRound(s: GameState, a: Serf): void {
  const d = s.serfs[a.sub];
  if (!d || d.state !== SS.KNIGHT_FIGHT || d.sub !== a.id) {
    a.state = SS.KNIGHT_WAIT;
    a.sub = -1;
    a.anim = 0;
    return;
  }
  if (--a.timer > 0) return;
  a.timer = ROUND_TICKS;
  if (chance(s, hitChance(s, a, d))) d.hp--;
  if (chance(s, hitChance(s, d, a))) a.hp--;
  if (d.hp <= 0 || a.hp <= 0) {
    // Przy jednoczesnym trafieniu ginie ten z mniejsza liczba PZ; przy remisie wygrywa obronca.
    const attackerWins = d.hp <= 0 && (a.hp > 0 || a.hp > d.hp);
    const loser = attackerWins ? d : a;
    const winner = attackerWins ? a : d;
    event(s, 'death', loser.owner, loser.pos);
    killSerf(s, loser);
    winner.sub = -1;
    winner.anim = 0;
    if (attackerWins) {
      winner.state = SS.KNIGHT_WAIT;
    } else {
      winner.state = SS.KNIGHT_DEFEND;
      winner.sub = -2; // wraca do budynku
      const b = s.buildings[winner.target];
      if (b && b.owner === winner.owner && b.stage === STAGE.DONE) {
        const fp = s.flags[b.flag]!.pos;
        const p = findPath(s.map, winner.pos, fp, (i) => isFreeWalkable(s.map, i) || i === fp, 300);
        winner.path = [...(p ?? []), DIR_NW];
      } else sendHome(s, winner);
    }
  }
}

/** Przejecie budynku przez atakujacego (albo spalenie zamku). */
function capture(s: GameState, b: Building, k: Serf): void {
  const old = b.owner;
  if (b.kind === B.CASTLE) {
    event(s, 'castleLost', old, b.pos, k.owner);
    destroyBuilding(s, b.id, true);
    returnKnight(s, k);
    return;
  }
  const f = s.flags[b.flag]!;
  for (let d = 0; d < 6; d++) if (f.roads[d] >= 0) removeRoad(s, f.roads[d]);
  clearFlagGoods(s, f);
  f.owner = k.owner;
  b.owner = k.owner;
  b.knights = [k.id];
  b.goldTransit = 0;
  b.trainTimer = 0;
  k.state = SS.INSIDE;
  k.home = b.id;
  k.target = -1;
  k.sub = -1;
  k.anim = 0;
  k.pos = b.pos;
  k.path = [];
  invalidateRoutes(s, old);
  invalidateRoutes(s, k.owner);
  event(s, 'captured', k.owner, b.pos, old);
  // Pozostali atakujacy (nie walczacy) wchodza do zdobytego budynku jako zaloga, do pojemnosci.
  let room = BUILDINGS[b.kind].knights - 1;
  const fp = f.pos;
  for (const o of s.serfs) {
    if (room <= 0) break;
    if (!o || o.owner !== k.owner || o.type !== S.KNIGHT || o.target !== b.id) continue;
    if (o.state !== SS.KNIGHT_WAIT && o.state !== SS.KNIGHT_ATTACK) continue;
    const from = o.to >= 0 ? o.to : o.pos;
    const p = from === fp ? [] : findPath(s.map, from, fp, (i) => isFreeWalkable(s.map, i) || i === fp, 600);
    if (!p) continue;
    o.path = [...p, DIR_NW];
    o.state = SS.KNIGHT_RETURN;
    o.home = b.id;
    o.sub = -1;
    room--;
  }
  const changed = recomputeTerritory(s, b.pos, BUILDINGS[b.kind].radius, b);
  applyTerritoryLoss(s, changed);
  // Po przejeciu sasiednie budynki starego wlasciciela moga stracic zasieg - przelicz szerzej.
  const changed2 = recomputeTerritory(s, b.pos, BUILDINGS[b.kind].radius + 9);
  applyTerritoryLoss(s, changed2);
}

/** Indeks: budynek -> pierwszy czekajacy atakujacy bez przeciwnika. */
function waitingIndex(s: GameState): Map<number, Serf> {
  const idx = new Map<number, Serf>();
  for (const k of s.serfs) {
    if (!k || k.state !== SS.KNIGHT_WAIT || k.sub >= 0) continue;
    if (!idx.has(k.target)) idx.set(k.target, k);
  }
  return idx;
}

function defenderOut(s: GameState, bid: number): boolean {
  for (const k of s.serfs) {
    if (!k || k.target !== bid) continue;
    if (k.state === SS.KNIGHT_FIGHT && k.home === bid) return true;
    if (k.state === SS.KNIGHT_DEFEND && k.sub >= 0) return true;
  }
  return false;
}

/** Obrona: kazdy atakowany budynek wysyla po jednym obroncy. */
function defense(s: GameState): void {
  const waiting = waitingIndex(s);
  for (const [bid, attacker] of waiting) {
    const b = s.buildings[bid];
    if (!b || b.stage !== STAGE.DONE || b.owner === attacker.owner) continue;
    if (defenderOut(s, bid)) continue;
    const hasKnights = b.inv ? b.inv.knights.some((n) => n > 0) : b.knights.length > 0;
    if (hasKnights) sendDefender(s, b, attacker);
  }
}

/** Logika rycerzy (hook osadnika). */
export function updateKnight(s: GameState, k: Serf): boolean {
  switch (k.state) {
    case SS.KNIGHT_ATTACK: {
      const t = s.buildings[k.target];
      // Cel moze byc juz pusty (wtedy go zajmujemy), ale musi byc wrogim budynkiem wojskowym.
      if (!t || t.owner === k.owner || t.stage !== STAGE.DONE || !(isMilitary(t.kind) || t.kind === B.CASTLE)) {
        returnKnight(s, k);
        return true;
      }
      if (k.sub === -3) {
        // Wszedl do pustego budynku.
        if (k.pos === t!.pos) capture(s, t!, k);
        else returnKnight(s, k);
        return true;
      }
      k.state = SS.KNIGHT_WAIT;
      k.sub = -1;
      return true;
    }
    case SS.KNIGHT_WAIT: {
      const t = s.buildings[k.target];
      if (!t || t.stage !== STAGE.DONE || t.owner === k.owner || !(isMilitary(t.kind) || t.kind === B.CASTLE)) {
        returnKnight(s, k);
        return true;
      }
      if (k.sub >= 0) {
        // Obronca idzie - czekamy (chyba ze zginal albo zawrocil).
        const d = s.serfs[k.sub];
        if (!d || d.state !== SS.KNIGHT_DEFEND || d.sub !== k.id) k.sub = -1;
        return true;
      }
      const empty = t.inv ? !t.inv.knights.some((n) => n > 0) : t.knights.length === 0;
      if (empty && !defenderOut(s, t.id)) {
        const m = s.map;
        const fp = s.flags[t.flag]!.pos;
        const p = k.pos === fp ? [] : findPath(m, k.pos, fp, (i) => isFreeWalkable(m, i) || i === fp, 200);
        if (!p) { returnKnight(s, k); return true; }
        k.path = [...p, DIR_NW];
        k.state = SS.KNIGHT_ATTACK;
        k.sub = -3;
      }
      return true;
    }
    case SS.KNIGHT_DEFEND: {
      if (k.sub === -2) {
        // Powrot do budynku po wygranej.
        const b = s.buildings[k.target];
        if (b && b.owner === k.owner && b.stage === STAGE.DONE && k.pos === b.pos) {
          if (b.inv) enterInventory(s, k, b);
          else if (b.knights.length < BUILDINGS[b.kind].knights) {
            b.knights.push(k.id);
            k.state = SS.INSIDE;
            k.sub = -1;
          } else sendHome(s, k);
        } else sendHome(s, k);
        return true;
      }
      const a = s.serfs[k.sub];
      if (a && a.state === SS.KNIGHT_WAIT && a.sub === k.id) {
        startDuel(s, a, k);
        return true;
      }
      // Atakujacy zniknal: wracamy.
      k.sub = -2;
      const b = s.buildings[k.target];
      if (b && b.owner === k.owner && b.stage === STAGE.DONE) {
        const fp = s.flags[b.flag]!.pos;
        const p = findPath(s.map, k.pos, fp, (i) => isFreeWalkable(s.map, i) || i === fp, 300);
        k.path = [...(p ?? []), DIR_NW];
      } else sendHome(s, k);
      return true;
    }
    case SS.KNIGHT_FIGHT: {
      const opp = s.serfs[k.sub];
      if (!opp || opp.sub !== k.id || opp.state !== SS.KNIGHT_FIGHT) {
        // Przeciwnik zniknal - atakujacy czeka dalej, obronca wraca.
        if (k.home !== k.target) { k.state = SS.KNIGHT_WAIT; k.sub = -1; }
        else { k.state = SS.KNIGHT_DEFEND; k.sub = -1; }
        k.anim = 0;
        return true;
      }
      // Runde liczy atakujacy (ten, ktorego home nie jest celem).
      if (k.home !== k.target) fightRound(s, k);
      return true;
    }
    case SS.KNIGHT_RETURN: {
      const b = s.buildings[k.target];
      if (b && b.owner === k.owner && b.stage === STAGE.DONE && k.pos === b.pos) {
        if (b.inv) { enterInventory(s, k, b); return true; }
        if (isMilitary(b.kind) && b.knights.length < BUILDINGS[b.kind].knights) {
          b.knights.push(k.id);
          k.state = SS.INSIDE;
          k.target = -1;
          return true;
        }
      }
      sendHome(s, k);
      return true;
    }
  }
  return false;
}

// ---------- Katapulta ----------

export const CATAPULT_HIT = 40;

/**
 * Katapulta: co cykl, majac kamien, strzela w najblizszy wrogi budynek wojskowy w zasiegu
 * z co najmniej 2 rycerzami. Trafienie zabija losowego rycerza (ostatni zostaje).
 */
export function updateCatapult(s: GameState, b: Building, serf: Serf): void {
  const def = BUILDINGS[b.kind];
  if (b.timer > 0) {
    b.timer--;
    return;
  }
  if (b.stock[0] <= 0) { serf.anim = 0; return; }
  let target: Building | null = null;
  let bd = 1 << 20;
  for (const t of s.buildings) {
    if (!t || t.owner === b.owner || t.stage !== STAGE.DONE || !isMilitary(t.kind) || t.knights.length < 2) continue;
    const d = dist(s, b.pos, t.pos);
    if (d <= def.radius && (d < bd || (d === bd && target && t.id < target.id))) { bd = d; target = t; }
  }
  b.timer = def.cycle;
  if (!target) { serf.anim = 0; return; }
  b.stock[0]--;
  serf.anim = 1;
  event(s, 'catapult', b.owner, b.pos, target.pos);
  if (!chance(s, CATAPULT_HIT)) return;
  const idx = randInt(s, target.knights.length);
  const k = s.serfs[target.knights[idx]];
  target.knights.splice(idx, 1);
  if (k) {
    event(s, 'death', k.owner, target.pos);
    killSerf(s, k);
  }
  s.players[target.owner].lastAttacked = s.tick;
}

// ---------- Eliminacja i zwyciestwo ----------

export function eliminate(s: GameState, p: number): void {
  const pl = s.players[p];
  if (!pl.alive) return;
  pl.alive = false;
  event(s, 'eliminated', p, pl.start);
  for (const b of s.buildings) if (b && b.owner === p && b.stage !== STAGE.BURN) destroyBuilding(s, b.id, true);
  for (const f of s.flags) if (f && f.owner === p) removeFlag(s, f.id, (bid) => destroyBuilding(s, bid, true));
  for (const k of s.serfs) if (k && k.owner === p) killSerf(s, k);
  const m = s.map;
  for (let i = 0; i < m.owner.length; i++) if (m.owner[i] === p + 1) m.owner[i] = 0;
}

function checkVictory(s: GameState): void {
  for (const pl of s.players) {
    if (!pl.alive) continue;
    const c = s.buildings[pl.castle];
    if (!c || c.owner !== pl.id || c.kind !== B.CASTLE || c.stage !== STAGE.DONE) eliminate(s, pl.id);
  }
  if (s.winner !== -1 || s.players.length < 2) return;
  const alive = s.players.filter((p) => p.alive);
  if (alive.length === 1) {
    s.winner = alive[0].id;
    event(s, 'victory', alive[0].id, alive[0].start);
  } else if (alive.length === 0) s.winner = -2;
}

export function surrender(s: GameState, c: Command): void {
  if (c.type !== 'surrender') return;
  eliminate(s, c.player);
}

export function militaryTick(s: GameState): void {
  updateGarrisons(s);
  training(s);
  defense(s);
  checkVictory(s);
}

