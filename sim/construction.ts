/**
 * Place budowy: wyrownywanie terenu (kopacz), budowa (budowniczy), ukonczenie, pozar i rozbiorka.
 */
import { BUILDINGS, GOODS_COUNT, O, SERF_TYPES, SIZE, isInventory, isMilitary } from './defs.ts';
import { DIR_SE } from './grid.ts';
import { rerouteFlags } from './goods.ts';
import { placeFlag, removeFlag, removeRoad } from './roads.ts';
import { SS, killSerf, sendHome } from './serfs.ts';
import { STAGE, type Building, type GameState, type Inventory, type Serf } from './types.ts';
import { allocId, buildingCells, canBuild, event, nb, recomputeTerritory } from './world.ts';

export const BUILD_TICKS_PER_UNIT = 40;
export const LEVEL_TICKS = 20;
export const BURN_TICKS = 150;

export function newInventory(): Inventory {
  return {
    goods: new Array(GOODS_COUNT).fill(0),
    serfs: new Array(SERF_TYPES).fill(0),
    knights: [0, 0, 0, 0, 0],
    outCooldown: 0,
    exitCooldown: 0,
  };
}

function blankBuilding(id: number, p: number, kind: number, pos: number, flag: number): Building {
  const def = BUILDINGS[kind];
  const nInputs = kind >= 13 && kind <= 16 ? 1 : def.inputs.length;
  return {
    id, owner: p, kind, pos, flag,
    stage: STAGE.BUILD,
    progress: 0,
    planks: 0, stones: 0, planksUsed: 0, stonesUsed: 0, planksTransit: 0, stonesTransit: 0,
    levelHeight: -1,
    builder: -1, digger: -1, worker: -1, workerInside: false,
    stock: new Array(nInputs).fill(0),
    transit: new Array(nInputs).fill(0),
    timer: 0, phase: 0,
    out: [],
    knights: [], knightsComing: 0,
    gold: 0, goldTransit: 0,
    inv: null,
    burn: 0,
    idleCycles: 0,
    trainTimer: 0,
    served: 0,
    produced: 0,
  };
}

/** Pola wyrownywane pod duzy budynek: glowne + 6 sasiadow. */
function levelCells(s: GameState, pos: number): number[] {
  const t = nb(s.map);
  const out = [pos];
  for (let d = 0; d < 6; d++) {
    const j = t[pos * 6 + d];
    if (j >= 0) out.push(j);
  }
  return out;
}

/** Stawia plac budowy. Zwraca id budynku albo -1. */
export function placeBuilding(s: GameState, p: number, pos: number, kind: number, instant = false): number {
  if (!instant && !canBuild(s, p, pos, kind)) return -1;
  const map = s.map;
  const def = BUILDINGS[kind];
  const flagPos = nb(map)[pos * 6 + DIR_SE];
  let fid = map.obj[flagPos] === O.FLAG ? map.objId[flagPos] : placeFlag(s, p, flagPos);
  if (fid < 0 && instant) {
    // Start gry: flaga zamku stawiana bez sprawdzania terytorium.
    map.owner[flagPos] = p + 1;
    fid = placeFlag(s, p, flagPos);
  }
  if (fid < 0) return -1;
  const id = allocId(s.buildings, s.freeBuildings);
  const b = blankBuilding(id, p, kind, pos, fid);
  s.buildings[id] = b;
  s.flags[fid]!.building = id;
  const cells = buildingCells(map, pos, def.size);
  for (const c of cells) {
    map.obj[c] = c === pos ? O.BUILDING : O.BUILDING_PART;
    map.objId[c] = id;
  }
  if (instant) {
    finishBuilding(s, b);
    return id;
  }
  if (def.size === SIZE.LARGE) {
    // Srednia wysokosc pol do wyrownania.
    const lc = levelCells(s, pos);
    let sum = 0;
    for (const c of lc) sum += map.height[c];
    const target = Math.floor((sum + (lc.length >> 1)) / lc.length);
    let flat = true;
    for (const c of lc) if (map.height[c] !== target) flat = false;
    b.levelHeight = target;
    b.stage = flat ? STAGE.BUILD : STAGE.LEVEL;
  }
  event(s, 'site', p, pos, kind);
  return id;
}

/** Budynek gotowy: magazyn dostaje inwentarz, reszta zamawia pracownika/rycerzy (economy). */
export function finishBuilding(s: GameState, b: Building): void {
  b.stage = STAGE.DONE;
  b.progress = 0;
  b.planks = 0;
  b.stones = 0;
  if (isInventory(b.kind)) b.inv = newInventory();
  event(s, 'built', b.owner, b.pos, b.kind);
}

/** Aktualizacja budowniczego stojacego przy placu. */
export function updateBuilder(s: GameState, serf: Serf): void {
  const b = s.buildings[serf.target];
  if (!b || b.stage === STAGE.BURN || b.builder !== serf.id) {
    sendHome(s, serf);
    return;
  }
  if (b.stage === STAGE.LEVEL) {
    serf.anim = 0;
    return; // czeka na kopacza
  }
  if (b.stage === STAGE.DONE) {
    b.builder = -1;
    serf.anim = 0;
    sendHome(s, serf);
    return;
  }
  const def = BUILDINGS[b.kind];
  const needP = def.planks - b.planksUsed;
  const needS = def.stones - b.stonesUsed;
  if (needP === 0 && needS === 0) {
    finishBuilding(s, b);
    b.builder = -1;
    serf.anim = 0;
    sendHome(s, serf);
    return;
  }
  // Wbudowuje jednostke materialu, jesli jest na placu.
  const usePlank = needP > 0 && b.planks > 0;
  const useStone = !usePlank && needS > 0 && b.stones > 0;
  if (!usePlank && !useStone) {
    serf.anim = 0;
    return;
  }
  serf.anim = 1;
  b.progress++;
  if (b.progress >= BUILD_TICKS_PER_UNIT) {
    b.progress = 0;
    if (usePlank) { b.planks--; b.planksUsed++; }
    else { b.stones--; b.stonesUsed++; }
  }
}

/** Kopacz: co LEVEL_TICKS przesuwa wysokosc jednego pola o 1 w strone celu. */
export function updateDigger(s: GameState, serf: Serf, onHeight: (idx: number) => void): void {
  const b = s.buildings[serf.target];
  if (!b || b.stage !== STAGE.LEVEL || b.digger !== serf.id) {
    if (b && b.digger === serf.id) b.digger = -1;
    sendHome(s, serf);
    return;
  }
  serf.anim = 1;
  if (++serf.timer < LEVEL_TICKS) return;
  serf.timer = 0;
  const map = s.map;
  for (const c of levelCells(s, b.pos)) {
    const h = map.height[c];
    if (h !== b.levelHeight) {
      map.height[c] = h < b.levelHeight ? h + 1 : h - 1;
      onHeight(c);
      return;
    }
  }
  b.stage = STAGE.BUILD;
  b.digger = -1;
  serf.anim = 0;
  sendHome(s, serf);
}

/** Osadnik doszedl do budynku jako budowniczy/kopacz. */
export function constructionArrive(serf: Serf, b: Building): boolean {
  if (b.builder === serf.id) {
    serf.state = SS.BUILDER;
    serf.anim = 0;
    return true;
  }
  if (b.digger === serf.id) {
    serf.state = SS.DIGGER;
    serf.timer = 0;
    return true;
  }
  return false;
}

/**
 * Niszczy budynek: pracownicy i rycerze wychodza (albo gina, gdy spalony przez wroga),
 * budynek plonie BURN_TICKS, potem zostaje ruina.
 */
export function destroyBuilding(s: GameState, bid: number, byEnemy = false): void {
  const b = s.buildings[bid];
  if (!b || b.stage === STAGE.BURN) return;
  const wasTerritory = b.stage === STAGE.DONE && (b.kind === 0 || (isMilitary(b.kind) && b.knights.length > 0));
  // Osadnicy zwiazani z budynkiem.
  for (const serf of s.serfs) {
    if (!serf || serf.owner !== b.owner) continue;
    const linked = serf.id === b.worker || serf.id === b.builder || serf.id === b.digger || b.knights.includes(serf.id) ||
      ((serf.state === SS.TO_BUILDING || serf.state === SS.INSIDE) && serf.target === bid);
    if (!linked) continue;
    if (byEnemy && serf.pos === b.pos && serf.to < 0) {
      killSerf(s, serf);
      continue;
    }
    serf.target = -1;
    serf.state = SS.LOST;
    sendHome(s, serf);
  }
  // Magazyn: zawartosc przepada (osadnicy w srodku gina razem z nim).
  if (b.inv) {
    let lost = 0;
    for (const n of b.inv.serfs) lost += n;
    for (const n of b.inv.knights) lost += n;
    s.players[b.owner].totalSerfs -= lost;
  }
  b.stage = STAGE.BURN;
  b.burn = BURN_TICKS;
  b.inv = null;
  b.knights = [];
  b.worker = -1;
  b.builder = -1;
  b.digger = -1;
  b.out = [];
  // Towary w drodze do budynku zostana przekierowane przy nastepnym trasowaniu.
  const f = s.flags[b.flag];
  if (f) f.building = -1;
  event(s, byEnemy ? 'burned' : 'demolished', b.owner, b.pos, b.kind);
  rerouteFlags(s, b.owner);
  if (wasTerritory) {
    const changed = recomputeTerritory(s, b.pos, BUILDINGS[b.kind].radius);
    applyTerritoryLoss(s, changed);
  }
}

/** Tick budynku w pozarze; po wypaleniu zostaje ruina (znika po czasie w przegladzie mapy). */
export function updateBurning(s: GameState, b: Building): void {
  if (--b.burn > 0) return;
  const map = s.map;
  const def = BUILDINGS[b.kind];
  for (const c of buildingCells(map, b.pos, def.size)) {
    if (map.objId[c] === b.id) {
      map.obj[c] = c === b.pos ? O.RUIN : O.NONE;
      map.objId[c] = -1;
      map.objTimer[c] = c === b.pos ? 60 : 0;
    }
  }
  s.buildings[b.id] = null;
  s.freeBuildings.push(b.id);
}

/** Obiekty gracza na polach, ktore stracil: budynki plona, flagi i drogi znikaja. */
export function applyTerritoryLoss(s: GameState, changed: number[]): void {
  const map = s.map;
  for (let i = 0; i < changed.length; i += 2) {
    const v = changed[i];
    const oldOwner = changed[i + 1] - 1;
    if (oldOwner < 0) continue;
    const o = map.obj[v];
    if ((o === O.BUILDING || o === O.BUILDING_PART) && map.objId[v] >= 0) {
      const b = s.buildings[map.objId[v]];
      if (b && b.owner === oldOwner && b.stage !== STAGE.BURN) destroyBuilding(s, b.id, true);
    }
  }
  for (let i = 0; i < changed.length; i += 2) {
    const v = changed[i];
    const oldOwner = changed[i + 1] - 1;
    if (oldOwner < 0) continue;
    if (map.obj[v] === O.FLAG) {
      const f = s.flags[map.objId[v]];
      if (f && f.owner === oldOwner) removeFlag(s, f.id, (bid) => destroyBuilding(s, bid, true));
    } else if (map.roads[v] !== 0) {
      for (const r of s.roads) {
        if (r && r.owner === oldOwner && r.cells.includes(v)) {
          removeRoad(s, r.id);
          break;
        }
      }
    }
  }
}

/** Rozbiorka na zyczenie gracza. */
export function demolishBuilding(s: GameState, bid: number): void {
  const b = s.buildings[bid];
  if (!b || b.kind === 0) return; // zamku nie da sie rozebrac
  destroyBuilding(s, bid, false);
}
