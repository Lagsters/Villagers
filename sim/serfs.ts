/**
 * Osadnicy jako encje na mapie: tworzenie przy magazynie, ruch po polach, marsz po drogach,
 * powrot do magazynu. Logika zawodow jest w transport.ts, construction.ts, production.ts, military.ts.
 */
import { G, O, S, SERF_TOOLS, T } from './defs.ts';
import { DIR_NW, DIR_SE, hexDist } from './grid.ts';
import { findPath } from './pathfind.ts';
import { walkRoute } from './routing.ts';
import { STAGE, type Building, type GameState, type Inventory, type Serf } from './types.ts';
import { allocId, isFreeWalkable, neighbor, walkCost } from './world.ts';
import { cancelTransit } from './goods.ts';

export const SS = {
  TO_ROAD: 1,
  TO_BUILDING: 2,
  TO_INVENTORY: 3,
  LOST: 4,
  CARRIER: 10,
  INSIDE: 20,
  BUILDER: 21,
  DIGGER: 22,
  WORK_OUT: 23,
  GEOLOGIST: 24,
  KNIGHT_ATTACK: 30,
  KNIGHT_DEFEND: 31,
  KNIGHT_FIGHT: 32,
  KNIGHT_RETURN: 33,
  KNIGHT_WAIT: 34,
} as const;

export function createSerf(s: GameState, owner: number, type: number, pos: number): Serf {
  const id = allocId(s.serfs, s.freeSerfs);
  const serf: Serf = {
    id, owner, type, level: 0, hp: 0, state: SS.LOST, pos, to: -1, t: 0, dur: 0, path: [],
    carry: -1, carryDest: -1, home: -1, target: -1, road: -1, timer: 0, sub: 0, anim: 0,
  };
  s.serfs[id] = serf;
  return serf;
}

export function removeSerf(s: GameState, serf: Serf): void {
  if (serf.carry >= 0) cancelTransit(s, serf.carryDest, serf.carry);
  s.serfs[serf.id] = null;
  s.freeSerfs.push(serf.id);
}

/** Osadnik ginie (walka, utrata terytorium bez drogi do domu). */
export function killSerf(s: GameState, serf: Serf): void {
  s.players[serf.owner].totalSerfs--;
  removeSerf(s, serf);
}

// ---------- Magazyn ----------

/** Czy magazyn moze wydac osadnika danego zawodu (sam albo wolny + narzedzia). */
/** Zawody, ktorych bezczynnych przedstawicieli mozna przekwalifikowac (oddaja narzedzia). */
function retrainable(t: number): boolean {
  return t !== S.GENERIC && t !== S.TRANSPORTER && t !== S.KNIGHT && t !== S.DONKEY && t !== S.SAILOR;
}

/** Czy narzedzie jest w magazynie albo u bezczynnego specjalisty, ktory moze je oddac. */
function toolAvailable(inv: Inventory, g: number, except: number): boolean {
  if (inv.goods[g] > 0) return true;
  for (let t = 0; t < inv.serfs.length; t++) {
    if (t !== except && inv.serfs[t] > 0 && retrainable(t) && SERF_TOOLS[t].includes(g)) return true;
  }
  return false;
}

/**
 * Przekwalifikowuje bezczynnego specjaliste w wolnego osadnika (narzedzia wracaja do puli).
 * Najpierw zawody z nadmiarem (ostatni przedstawiciel zawodu zostaje, jesli sie da).
 */
function retrainOne(inv: Inventory, pred: (t: number) => boolean): boolean {
  for (const minCount of [2, 1]) {
    for (let t = 0; t < inv.serfs.length; t++) {
      if (inv.serfs[t] >= minCount && retrainable(t) && pred(t)) {
        inv.serfs[t]--;
        inv.serfs[S.GENERIC]++;
        for (const g of SERF_TOOLS[t]) inv.goods[g]++;
        return true;
      }
    }
  }
  return false;
}

function anyRetrainable(inv: Inventory, except: number): boolean {
  for (let t = 0; t < inv.serfs.length; t++) if (t !== except && inv.serfs[t] > 0 && retrainable(t)) return true;
  return false;
}

/** Czy magazyn moze wydac osadnika danego zawodu (sam, wolny + narzedzia, albo po przekwalifikowaniu). */
export function canProvideSerf(inv: Inventory, type: number): boolean {
  if (type === S.KNIGHT) return inv.knights.some((k) => k > 0);
  if (inv.serfs[type] > 0) return true;
  if (type === S.DONKEY) return false;
  if (inv.serfs[S.GENERIC] <= 0 && !anyRetrainable(inv, type)) return false;
  for (const g of SERF_TOOLS[type]) if (!toolAvailable(inv, g, type)) return false;
  return true;
}

/**
 * Wydaje osadnika z magazynu jako encje przy drzwiach. Dla rycerzy `level` = -1 wybiera
 * najsilniejszego dostepnego (albo najslabszego gdy weakest).
 */
export function takeSerfFromInventory(s: GameState, b: Building, type: number, weakest = false): Serf | null {
  const inv = b.inv!;
  let level = 0;
  if (type === S.KNIGHT) {
    level = -1;
    if (weakest) {
      for (let l = 0; l <= 4; l++) if (inv.knights[l] > 0) { level = l; break; }
    } else {
      for (let l = 4; l >= 0; l--) if (inv.knights[l] > 0) { level = l; break; }
    }
    if (level < 0) return null;
    inv.knights[level]--;
  } else if (inv.serfs[type] > 0) {
    inv.serfs[type]--;
  } else {
    if (!canProvideSerf(inv, type)) return null;
    // Brakujace narzedzia odzyskujemy od bezczynnych specjalistow.
    for (const g of SERF_TOOLS[type]) {
      if (inv.goods[g] <= 0) retrainOne(inv, (t) => t !== type && SERF_TOOLS[t].includes(g));
    }
    if (inv.serfs[S.GENERIC] <= 0) retrainOne(inv, (t) => t !== type);
    for (const g of SERF_TOOLS[type]) if (inv.goods[g] <= 0) return null;
    if (inv.serfs[S.GENERIC] <= 0) return null;
    for (const g of SERF_TOOLS[type]) inv.goods[g]--;
    inv.serfs[S.GENERIC]--;
  }
  const serf = createSerf(s, b.owner, type, b.pos);
  serf.level = level;
  serf.home = b.id;
  return serf;
}

/** Osadnik wchodzi do magazynu i znika jako encja. */
export function enterInventory(s: GameState, serf: Serf, b: Building): void {
  const inv = b.inv!;
  if (serf.type === S.KNIGHT) inv.knights[Math.max(0, Math.min(4, serf.level))]++;
  else if (serf.type === S.TRANSPORTER) inv.serfs[S.GENERIC]++;
  else if (serf.type === S.SAILOR) { inv.serfs[S.GENERIC]++; inv.goods[G.BOAT]++; }
  else inv.serfs[serf.type]++;
  if (serf.carry >= 0) {
    inv.goods[serf.carry]++;
    serf.carry = -1;
  }
  removeSerf(s, serf);
}

// ---------- Ruch ----------

export function startStep(s: GameState, serf: Serf, dir: number): boolean {
  const to = neighbor(s.map, serf.pos, dir);
  if (to < 0) return false;
  serf.to = to;
  serf.t = 0;
  serf.dur = serf.type === S.SAILOR && s.map.terrain[to] === T.WATER ? 10 : walkCost(s.map, serf.pos, to);
  if (serf.type === S.DONKEY) serf.dur += 1;
  return true;
}

/**
 * Postep ruchu o jeden tick. Zwraca true, gdy osadnik stoi (nie jest w trakcie kroku)
 * i nie ma dalszej sciezki - wtedy wolamy logike jego stanu.
 */
export function advanceMove(s: GameState, serf: Serf): boolean {
  if (serf.to >= 0) {
    serf.t++;
    if (serf.t < serf.dur) return false;
    serf.pos = serf.to;
    serf.to = -1;
    serf.t = 0;
  }
  if (serf.path.length > 0) {
    const d = serf.path.shift()!;
    if (!startStep(s, serf, d)) serf.path.length = 0;
    return false;
  }
  return true;
}

// ---------- Wysylanie ----------

/** Sciezka z pozycji osadnika (flaga albo drzwi budynku) do flagi `toFlag` po drogach. */
/** Pole, od ktorego liczymy nowa sciezke (cel biezacego kroku, jesli osadnik jest w ruchu). */
export function curPos(serf: Serf): number {
  return serf.to >= 0 ? serf.to : serf.pos;
}

function routeFromPos(s: GameState, serf: Serf, toFlag: number): number[] | null {
  const map = s.map;
  let prefix: number[] = [];
  let pos = curPos(serf);
  if (map.obj[pos] === O.BUILDING) {
    prefix = [DIR_SE];
    pos = neighbor(map, pos, DIR_SE);
  }
  if (map.obj[pos] !== O.FLAG) return null;
  const fromFlag = map.objId[pos];
  const f = s.flags[fromFlag];
  if (!f || f.owner !== serf.owner) return null;
  const r = walkRoute(s, serf.owner, fromFlag, toFlag);
  if (!r) return null;
  return prefix.concat(r);
}

/** Wysyla osadnika po drogach do budynku (wchodzi do srodka). */
export function sendToBuilding(s: GameState, serf: Serf, b: Building): boolean {
  const r = routeFromPos(s, serf, b.flag);
  if (!r) return false;
  r.push(DIR_NW);
  serf.path = r;
  serf.state = SS.TO_BUILDING;
  serf.target = b.id;
  return true;
}

/** Najblizszy (po prostej) magazyn gracza. */
function inventoriesByDistance(s: GameState, owner: number, pos: number): Building[] {
  const w = s.map.w;
  const list: Building[] = [];
  for (const b of s.buildings) if (b && b.owner === owner && b.inv && b.stage === STAGE.DONE) list.push(b);
  const px = pos % w, py = (pos / w) | 0;
  list.sort((a, c) => {
    const da = hexDist(px, py, a.pos % w, (a.pos / w) | 0);
    const dc = hexDist(px, py, c.pos % w, (c.pos / w) | 0);
    return da - dc || a.id - c.id;
  });
  return list;
}

/**
 * Wysyla osadnika do najblizszego magazynu: po drogach, jesli stoi w sieci,
 * inaczej na przelaj. Gdy nie ma drogi do zadnego magazynu - osadnik sie gubi.
 */
export function sendHome(s: GameState, serf: Serf): void {
  serf.road = -1;
  serf.target = -1;
  serf.path = [];
  const invs = inventoriesByDistance(s, serf.owner, curPos(serf));
  for (const b of invs) {
    const r = routeFromPos(s, serf, b.flag);
    if (r) {
      r.push(DIR_NW);
      serf.path = r;
      serf.state = SS.TO_INVENTORY;
      serf.target = b.id;
      return;
    }
  }
  for (let k = 0; k < invs.length && k < 2; k++) {
    const b = invs[k];
    const p = findPath(s.map, curPos(serf), b.pos, (i) => isFreeWalkable(s.map, i));
    if (p) {
      serf.path = p;
      serf.state = SS.TO_INVENTORY;
      serf.target = b.id;
      return;
    }
  }
  serf.state = SS.LOST;
  serf.timer = 50;
}

/** Wolna logika stanow marszu (wolana, gdy osadnik stoi i skonczyl sciezke). */
export function arriveWalking(s: GameState, serf: Serf, onBuilding: (serf: Serf, b: Building) => void): void {
  switch (serf.state) {
    case SS.TO_INVENTORY: {
      const b = s.buildings[serf.target];
      if (b && b.inv && b.owner === serf.owner && b.pos === serf.pos && b.stage === STAGE.DONE) {
        enterInventory(s, serf, b);
      } else {
        sendHome(s, serf);
      }
      return;
    }
    case SS.TO_BUILDING: {
      const b = s.buildings[serf.target];
      if (b && b.owner === serf.owner && b.pos === serf.pos && b.stage !== STAGE.BURN) {
        onBuilding(serf, b);
      } else {
        sendHome(s, serf);
      }
      return;
    }
    case SS.LOST: {
      if (--serf.timer > 0) return;
      sendHome(s, serf);
      if (serf.state === SS.LOST) {
        // Po kilku probach osadnik przepada (np. odciety na wyspie bez magazynu).
        serf.sub++;
        if (serf.sub > 6) killSerf(s, serf);
      }
      return;
    }
  }
}
