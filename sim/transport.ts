/**
 * Tragarze (i osly, i przewoznicy lodzi). Jeden tragarz na odcinek drogi, jeden towar naraz.
 * Pola osadnika uzywane przez tragarza:
 *   road   - obslugiwana droga
 *   sub    - podstan (CS)
 *   target - strona, do ktorej idzie: 0 = flaga a, 1 = flaga b
 *   home   - indeks zarezerwowanego slotu na fladze (przy FETCH)
 */
import { DIR_NW, DIR_SE, opposite } from './grid.ts';
import { addTransit, cancelTransit, chooseDestination, deliverGood, goodDir, putGood, rerouteSlot } from './goods.ts';
import { SS, sendHome } from './serfs.ts';
import { DIR_INTO, FLAG_SLOTS, STAGE, type Flag, type GameState, type Road, type Serf } from './types.ts';

export const CS = { IDLE: 0, FETCH: 1, CARRY: 2, INTO: 3, OUTOF: 4, WAIT: 5, TOMID: 6 } as const;

function endFlag(s: GameState, road: Road, side: number): Flag {
  return s.flags[side === 0 ? road.a : road.b]!;
}

/** Kierunek drogi widziany z flagi po danej stronie. */
function roadDirAt(road: Road, side: number): number {
  return side === 0 ? road.dirA : road.dirB;
}

function cellIndex(road: Road, pos: number): number {
  return road.cells.indexOf(pos);
}

/** Ustawia sciezke wzdluz drogi z biezacego pola do indeksu `to`. */
function walkAlong(serf: Serf, road: Road, to: number): void {
  const k = cellIndex(road, serf.pos);
  const path: number[] = [];
  if (k < 0) return;
  if (to > k) for (let i = k; i < to; i++) path.push(road.path[i]);
  else for (let i = k - 1; i >= to; i--) path.push(opposite(road.path[i]));
  serf.path = path;
}

function midIndex(road: Road): number {
  return road.cells.length >> 1;
}

/** Najlepszy towar na fladze czekajacy na te droge (niezarezerwowany) albo -1. */
function bestSlot(s: GameState, f: Flag, dir: number): number {
  const prio = s.players[f.owner].settings.transportPrio;
  let best = -1;
  for (let i = 0; i < FLAG_SLOTS; i++) {
    if (f.slotGood[i] < 0 || f.slotClaim[i] >= 0 || f.slotDir[i] !== dir) continue;
    if (best < 0) { best = i; continue; }
    const pa = prio[f.slotGood[i]], pb = prio[f.slotGood[best]];
    if (pa > pb || (pa === pb && f.slotTime[i] < f.slotTime[best])) best = i;
  }
  return best;
}

function takeSlot(f: Flag, i: number, serf: Serf): void {
  serf.carry = f.slotGood[i];
  serf.carryDest = f.slotDest[i];
  f.slotGood[i] = -1;
  f.slotDest[i] = -1;
  f.slotDir[i] = -1;
  f.slotClaim[i] = -1;
}

/** Zwalnia rezerwacje tragarza na obu flagach. */
export function releaseClaims(s: GameState, serf: Serf): void {
  const road = s.roads[serf.road];
  if (!road) return;
  for (const fid of [road.a, road.b]) {
    const f = s.flags[fid];
    if (!f) continue;
    for (let i = 0; i < FLAG_SLOTS; i++) if (f.slotClaim[i] === serf.id) f.slotClaim[i] = -1;
  }
}

/** Szuka pracy: towaru na ktorejs z flag. Zwraca true, jesli ruszyl. */
function findWork(s: GameState, serf: Serf, road: Road): boolean {
  const fa = endFlag(s, road, 0);
  const fb = endFlag(s, road, 1);
  const ia = bestSlot(s, fa, road.dirA);
  const ib = bestSlot(s, fb, road.dirB);
  if (ia < 0 && ib < 0) return false;
  let side: number;
  if (ia >= 0 && ib >= 0) {
    const prio = s.players[serf.owner].settings.transportPrio;
    const pa = prio[fa.slotGood[ia]], pb = prio[fb.slotGood[ib]];
    if (pa !== pb) side = pa > pb ? 0 : 1;
    else {
      const k = cellIndex(road, serf.pos);
      const da = k, db = road.cells.length - 1 - k;
      side = da < db ? 0 : da > db ? 1 : fa.slotTime[ia] <= fb.slotTime[ib] ? 0 : 1;
    }
  } else side = ia >= 0 ? 0 : 1;
  const f = side === 0 ? fa : fb;
  const slot = side === 0 ? ia : ib;
  f.slotClaim[slot] = serf.id;
  serf.home = slot;
  serf.target = side;
  serf.sub = CS.FETCH;
  walkAlong(serf, road, side === 0 ? 0 : road.cells.length - 1);
  return true;
}

/** Po odlozeniu towaru na fladze `side`: od razu zabierz towar w druga strone albo szukaj pracy. */
function afterDrop(s: GameState, serf: Serf, road: Road, side: number): void {
  const f = endFlag(s, road, side);
  const i = bestSlot(s, f, roadDirAt(road, side));
  if (i >= 0) {
    takeSlot(f, i, serf);
    startCarry(serf, road, 1 - side);
    return;
  }
  if (findWork(s, serf, road)) return;
  serf.sub = CS.TOMID;
  walkAlong(serf, road, midIndex(road));
}

function startCarry(serf: Serf, road: Road, toSide: number): void {
  serf.sub = CS.CARRY;
  serf.target = toSide;
  serf.anim = 3;
  walkAlong(serf, road, toSide === 0 ? 0 : road.cells.length - 1);
}

/** Proba oddania niesionego towaru na fladze docelowej. */
function tryDeliver(s: GameState, serf: Serf, road: Road): void {
  const side = serf.target;
  const f = endFlag(s, road, side);
  let dest = serf.carryDest;
  let b = dest >= 0 ? s.buildings[dest] : null;
  if (!b || b.stage === STAGE.BURN || b.owner !== serf.owner) {
    // Cel zniknal: nowy cel liczony od tej flagi.
    cancelTransit(s, dest, serf.carry);
    dest = chooseDestination(s, serf.owner, f.id, serf.carry);
    b = dest >= 0 ? s.buildings[dest] : null;
    if (b && !b.inv) addTransit(b, serf.carry, 1);
    serf.carryDest = dest;
  }
  if (b && b.flag === f.id) {
    // Cel stoi przy tej fladze: tragarz wnosi towar do srodka.
    serf.sub = CS.INTO;
    serf.path = [DIR_NW];
    return;
  }
  if (putGood(s, f, serf.carry, dest)) {
    serf.carry = -1;
    serf.carryDest = -1;
    serf.anim = 0;
    afterDrop(s, serf, road, side);
    return;
  }
  // Flaga pelna: zamiana z towarem czekajacym na nasza droge (zapobiega zakleszczeniom).
  const i = bestSlot(s, f, roadDirAt(road, side));
  if (i >= 0) {
    const g = serf.carry;
    const d = serf.carryDest;
    takeSlot(f, i, serf);
    f.slotGood[i] = g;
    f.slotDest[i] = d;
    f.slotDir[i] = goodDir(s, f, d);
    f.slotTime[i] = s.tick;
    if (f.slotDir[i] < 0 || f.slotDir[i] === DIR_INTO) rerouteSlot(s, f, i);
    startCarry(serf, road, 1 - side);
    return;
  }
  serf.sub = CS.WAIT;
  serf.anim = 3;
}

export function updateCarrier(s: GameState, serf: Serf): void {
  const road = s.roads[serf.road];
  if (!road || (road.carrier !== serf.id && road.donkey !== serf.id)) {
    releaseClaims(s, serf);
    if (serf.carry >= 0) {
      cancelTransit(s, serf.carryDest, serf.carry);
      serf.carry = -1;
    }
    sendHome(s, serf);
    return;
  }
  const last = road.cells.length - 1;
  switch (serf.sub) {
    case CS.IDLE: {
      if (findWork(s, serf, road)) return;
      const k = cellIndex(road, serf.pos);
      if (k !== midIndex(road)) {
        serf.sub = CS.TOMID;
        walkAlong(serf, road, midIndex(road));
      }
      return;
    }
    case CS.TOMID: {
      if (findWork(s, serf, road)) return;
      const k = cellIndex(road, serf.pos);
      if (k !== midIndex(road)) walkAlong(serf, road, midIndex(road));
      else serf.sub = CS.IDLE;
      return;
    }
    case CS.FETCH: {
      const idx = serf.target === 0 ? 0 : last;
      if (cellIndex(road, serf.pos) !== idx) { walkAlong(serf, road, idx); return; }
      const f = endFlag(s, road, serf.target);
      const slot = serf.home;
      if (slot >= 0 && slot < FLAG_SLOTS && f.slotClaim[slot] === serf.id && f.slotGood[slot] >= 0) {
        takeSlot(f, slot, serf);
        startCarry(serf, road, 1 - serf.target);
      } else {
        releaseClaims(s, serf);
        afterDrop(s, serf, road, serf.target);
      }
      return;
    }
    case CS.CARRY:
    case CS.WAIT: {
      if (serf.carry < 0) { serf.sub = CS.IDLE; serf.anim = 0; return; }
      const idx = serf.target === 0 ? 0 : last;
      if (cellIndex(road, serf.pos) !== idx) { walkAlong(serf, road, idx); return; }
      tryDeliver(s, serf, road);
      return;
    }
    case CS.INTO: {
      const b = s.buildings[serf.carryDest];
      if (b && b.pos === serf.pos && b.stage !== STAGE.BURN) deliverGood(s, b, serf.carry);
      else if (serf.carry >= 0) cancelTransit(s, serf.carryDest, serf.carry);
      serf.carry = -1;
      serf.carryDest = -1;
      serf.anim = 0;
      serf.sub = CS.OUTOF;
      serf.path = [DIR_SE];
      return;
    }
    case CS.OUTOF: {
      afterDrop(s, serf, road, serf.target);
      return;
    }
  }
}

/** Nowy tragarz doszedl do srodka swojej drogi. */
export function carrierArrived(s: GameState, serf: Serf): void {
  const road = s.roads[serf.road];
  if (!road || (road.carrier !== serf.id && road.donkey !== serf.id)) {
    sendHome(s, serf);
    return;
  }
  serf.state = SS.CARRIER;
  serf.sub = CS.IDLE;
  updateCarrier(s, serf);
}

/** Po podziale drogi tragarz przechodzi na nowy odcinek; strona (a/b) sie nie zmienia. */
export function carrierAfterSplit(s: GameState, serf: Serf, newRoad: Road): void {
  releaseClaims(s, serf);
  serf.road = newRoad.id;
  // Wchodzenie do budynku i wychodzenie dokanczamy normalnie - flaga budynku sie nie zmienia.
  if (serf.sub === CS.INTO || serf.sub === CS.OUTOF) return;
  serf.path = [];
  if (serf.sub === CS.FETCH) serf.sub = CS.IDLE;
}
