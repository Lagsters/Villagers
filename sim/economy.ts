/**
 * Gospodarka gracza: przydzial osadnikow z magazynow (tragarze, budowniczowie, pracownicy),
 * zamowienia towarow, osly na zatloczonych drogach, narodziny osadnikow, szkolenie rycerzy.
 * Przebieg dla gracza p odbywa sie co ECON_PERIOD tickow (fazy graczy sa przesuniete).
 */
import { B, BUILDINGS, FIRST_TOOL, G, O, S, SERF_TOOLS, isMilitary } from './defs.ts';
import { ZONE, desiredKnights } from './military.ts';
import { DIR_NW, DIR_SE, hexDist, opposite } from './grid.ts';
import { findPath } from './pathfind.ts';
import { isFreeWalkable } from './world.ts';
import { addTransit, demand, distWeight, flagGoodsCount, putGood } from './goods.ts';
import { UNREACHABLE, flagDist, routeTo, walkRoute } from './routing.ts';
import { SS, canProvideSerf, takeSerfFromInventory } from './serfs.ts';
import { FLAG_SLOTS, STAGE, type Building, type GameState, type Inventory, type Road } from './types.ts';

export const ECON_PERIOD = 5;
export const SERF_BIRTH_TICKS = 250;
export const MAX_SERFS = 300;
const DONKEY_LOAD = 60;
const PER_INV_GOODS = 2;
const PER_INV_SERFS = 2;

interface PassCtx {
  invs: Building[];
  goodsOut: Map<number, number>;
  serfsOut: Map<number, number>;
}

function inventoriesOf(s: GameState, p: number): Building[] {
  const list: Building[] = [];
  for (const b of s.buildings) if (b && b.owner === p && b.inv && b.stage === STAGE.DONE) list.push(b);
  return list;
}

/** Najblizszy magazyn (po drogach dla pieszych), ktory moze wydac osadnika danego typu. */
function pickInventoryForSerf(s: GameState, ctx: PassCtx, p: number, type: number, targetFlag: number): Building | null {
  let best: Building | null = null;
  let bestD = UNREACHABLE;
  for (const b of ctx.invs) {
    if ((ctx.serfsOut.get(b.id) ?? 0) >= PER_INV_SERFS) continue;
    if (!canProvideSerf(b.inv!, type)) continue;
    if (type === S.KNIGHT && b.kind === B.CASTLE) {
      // Rezerwa rycerzy w zamku.
      const total = b.inv!.knights.reduce((a, c) => a + c, 0);
      if (total <= s.players[p].settings.castleKnights) continue;
    }
    const d = flagDist(s, p, b.flag, targetFlag, true);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

/**
 * Zapamietuje brak narzedzi, zeby narzedziownia wiedziala, co robic. Liczymy tylko magazyny,
 * z ktorych da sie dojsc do budynku - narzedzia w odcietym magazynie nic nie daja.
 */
function noteMissingTools(s: GameState, ctx: PassCtx, p: number, type: number, targetFlag: number): void {
  const tools = SERF_TOOLS[type];
  if (tools.length === 0 || type === S.KNIGHT || type === S.SAILOR) return;
  const reach = ctx.invs.filter((b) => b.flag === targetFlag || flagDist(s, p, b.flag, targetFlag, true) < UNREACHABLE);
  if (reach.length === 0) return;
  // Brak narzedzia tylko wtedy, gdy sa wolni osadnicy.
  if (!reach.some((b) => b.inv!.serfs[S.GENERIC] > 0)) return;
  const want = s.players[p].toolWant;
  for (const g of tools) {
    if (reach.every((b) => b.inv!.goods[g] <= 0)) want[g - FIRST_TOOL]++;
  }
}

function noteSerfOut(ctx: PassCtx, b: Building): void {
  ctx.serfsOut.set(b.id, (ctx.serfsOut.get(b.id) ?? 0) + 1);
}

/** Najblizszy po prostej magazyn z wolnym rycerzem (dla budynkow odcietych od drog). */
function nearestKnightInventory(s: GameState, ctx: PassCtx, p: number, pos: number): Building | null {
  let best: Building | null = null;
  let bd = 1 << 30;
  const w = s.map.w;
  for (const b of ctx.invs) {
    if ((ctx.serfsOut.get(b.id) ?? 0) >= PER_INV_SERFS || !canProvideSerf(b.inv!, S.KNIGHT)) continue;
    if (b.kind === B.CASTLE && b.inv!.knights.reduce((a, c) => a + c, 0) <= s.players[p].settings.castleKnights) continue;
    const d = hexDist(b.pos % w, (b.pos / w) | 0, pos % w, (pos / w) | 0);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

/** Wysyla osadnika z magazynu do budynku. Zwraca id osadnika albo -1. */
function dispatchSerfToBuilding(s: GameState, ctx: PassCtx, b: Building, type: number, weakest = false): number {
  let inv = pickInventoryForSerf(s, ctx, b.owner, type, b.flag);
  let route = inv ? walkRoute(s, b.owner, inv.flag, b.flag) : null;
  if (!route && type === S.KNIGHT) {
    // Rycerze ida do budynku wojskowego na przelaj, gdy nie ma drogi (np. przejety budynek).
    inv = nearestKnightInventory(s, ctx, b.owner, b.pos);
    if (inv) {
      const fp = s.flags[b.flag]!.pos;
      const ifp = s.flags[inv.flag]!.pos;
      route = findPath(s.map, ifp, fp, (i) => isFreeWalkable(s.map, i) || s.map.obj[i] === O.FLAG, 8000);
    }
  }
  if (!inv) {
    noteMissingTools(s, ctx, b.owner, type, b.flag);
    return -1;
  }
  if (!route) return -1;
  const serf = takeSerfFromInventory(s, inv, type, weakest);
  if (!serf) return -1;
  noteSerfOut(ctx, inv);
  serf.path = [DIR_SE, ...route, DIR_NW];
  serf.state = SS.TO_BUILDING;
  serf.target = b.id;
  return serf.id;
}

/** Wysyla tragarza (lub osla/przewoznika) na srodek drogi. */
function dispatchCarrier(s: GameState, ctx: PassCtx, road: Road, type: number): number {
  const p = road.owner;
  // Idziemy do blizszej flagi drogi.
  let best: Building | null = null;
  let bestD = UNREACHABLE;
  let bestEnd = 0;
  for (const b of ctx.invs) {
    if ((ctx.serfsOut.get(b.id) ?? 0) >= PER_INV_SERFS) continue;
    if (!canProvideSerf(b.inv!, type)) continue;
    for (let e = 0; e < 2; e++) {
      const d = flagDist(s, p, b.flag, e === 0 ? road.a : road.b, true);
      if (d < bestD) {
        bestD = d;
        best = b;
        bestEnd = e;
      }
    }
  }
  if (!best) return -1;
  const endFlag = bestEnd === 0 ? road.a : road.b;
  const route = walkRoute(s, p, best.flag, endFlag);
  if (!route) return -1;
  const serf = takeSerfFromInventory(s, best, type);
  if (!serf) return -1;
  noteSerfOut(ctx, best);
  const mid = road.cells.length >> 1;
  const along: number[] = [];
  if (bestEnd === 0) for (let i = 0; i < mid; i++) along.push(road.path[i]);
  else for (let i = road.path.length - 1; i >= mid; i--) along.push(opposite(road.path[i]));
  serf.path = [DIR_SE, ...route, ...along];
  serf.state = SS.TO_ROAD;
  serf.road = road.id;
  serf.target = bestEnd;
  return serf.id;
}

/** Liczba towarow czekajacych na koncach drogi w jej kierunku. */
function roadWaiting(s: GameState, road: Road): number {
  let n = 0;
  const fa = s.flags[road.a]!;
  const fb = s.flags[road.b]!;
  for (let i = 0; i < FLAG_SLOTS; i++) {
    if (fa.slotGood[i] >= 0 && fa.slotDir[i] === road.dirA) n++;
    if (fb.slotGood[i] >= 0 && fb.slotDir[i] === road.dirB) n++;
  }
  return n;
}

/** Zamowienia osadnikow do drog i budynkow. */
function serfRequests(s: GameState, ctx: PassCtx, p: number): void {
  for (const road of s.roads) {
    if (!road || road.owner !== p) continue;
    if (road.carrier < 0) {
      road.carrier = dispatchCarrier(s, ctx, road, road.water ? S.SAILOR : S.TRANSPORTER);
    }
    if (!road.water) {
      road.load = roadWaiting(s, road) >= 3 ? road.load + 1 : Math.max(0, road.load - 1);
      if (road.load >= DONKEY_LOAD && road.donkey < 0) road.donkey = dispatchCarrier(s, ctx, road, S.DONKEY);
    }
  }
  // Rycerze w drodze do budynkow (liczone raz na przebieg).
  const coming = new Map<number, number>();
  for (const sf of s.serfs) {
    if (sf && sf.owner === p && sf.type === S.KNIGHT && sf.state === SS.TO_BUILDING) coming.set(sf.target, (coming.get(sf.target) ?? 0) + 1);
  }
  // Rycerze najpierw do budynkow z najmniejsza obsada (pusty budynek nie trzyma nawet terytorium).
  const needKnights: Building[] = [];
  for (const b of s.buildings) {
    if (!b || b.owner !== p || b.stage !== STAGE.DONE || !isMilitary(b.kind)) continue;
    if (b.knights.length + (coming.get(b.id) ?? 0) < desiredKnights(s, b)) needKnights.push(b);
  }
  needKnights.sort((a, c) => a.knights.length + (coming.get(a.id) ?? 0) - (c.knights.length + (coming.get(c.id) ?? 0)) || a.id - c.id);
  for (const b of needKnights) dispatchSerfToBuilding(s, ctx, b, S.KNIGHT, b.phase !== ZONE.ENEMY);
  for (const b of s.buildings) {
    if (!b || b.owner !== p) continue;
    if (b.stage === STAGE.DONE && isMilitary(b.kind)) continue;
    if (b.stage === STAGE.LEVEL && b.digger < 0) b.digger = dispatchSerfToBuilding(s, ctx, b, S.DIGGER);
    else if ((b.stage === STAGE.BUILD || b.stage === STAGE.LEVEL) && b.builder < 0) b.builder = dispatchSerfToBuilding(s, ctx, b, S.BUILDER);
    else if (b.stage === STAGE.DONE && b.worker < 0 && BUILDINGS[b.kind].worker >= 0) {
      b.worker = dispatchSerfToBuilding(s, ctx, b, BUILDINGS[b.kind].worker);
    }
  }
}

interface Req {
  b: Building;
  g: number;
  w: number;
}

/** Zamowienia towarow z magazynow. */
function goodsRequests(s: GameState, ctx: PassCtx, p: number): void {
  const reqs: Req[] = [];
  for (const b of s.buildings) {
    if (!b || b.owner !== p || b.inv || b.stage === STAGE.BURN) continue;
    if (b.stage === STAGE.LEVEL || b.stage === STAGE.BUILD) {
      for (const g of [G.PLANK, G.STONE]) if (demand(b, g) > 0) reqs.push({ b, g, w: distWeight(s, b, g) });
      continue;
    }
    if (b.stage !== STAGE.DONE) continue;
    const def = BUILDINGS[b.kind];
    if (isMilitary(b.kind)) {
      if (b.knights.length > 0 && demand(b, G.GOLD) > 0) reqs.push({ b, g: G.GOLD, w: 8 });
      continue;
    }
    if (b.worker < 0 || b.paused) continue;
    if (b.kind >= 13 && b.kind <= 16) {
      if (demand(b, G.FISH) > 0) reqs.push({ b, g: -2, w: distWeight(s, b, G.FISH) });
      continue;
    }
    for (const g of def.inputs) if (demand(b, g) > 0) reqs.push({ b, g, w: distWeight(s, b, g) });
  }
  reqs.sort((x, y) => y.w - x.w || x.b.served - y.b.served || x.b.id - y.b.id);
  for (const r of reqs) {
    if (r.w <= 0) continue;
    const bFlagTable = routeTo(s, p, r.b.flag, false);
    let best: Building | null = null;
    let bestD = UNREACHABLE;
    let bestGood = -1;
    for (const inv of ctx.invs) {
      if ((ctx.goodsOut.get(inv.id) ?? 0) >= PER_INV_GOODS) continue;
      let g = r.g;
      if (g === -2) {
        // Dowolne jedzenie: to, ktorego magazyn ma najwiecej.
        g = -1;
        let most = 0;
        for (const fg of [G.FISH, G.BREAD, G.MEAT]) if (inv.inv!.goods[fg] > most) { most = inv.inv!.goods[fg]; g = fg; }
        if (g < 0) continue;
      } else if (inv.inv!.goods[g] <= 0) continue;
      const d = inv.flag === r.b.flag ? 0 : bFlagTable.dist[inv.flag];
      if (d < bestD) {
        bestD = d;
        best = inv;
        bestGood = g;
      }
    }
    if (!best) continue;
    const f = s.flags[best.flag]!;
    if (flagGoodsCount(f) >= FLAG_SLOTS) continue;
    best.inv!.goods[bestGood]--;
    addTransit(r.b, bestGood, 1);
    if (!putGood(s, f, bestGood, r.b.id)) {
      best.inv!.goods[bestGood]++;
      addTransit(r.b, bestGood, -1);
      continue;
    }
    r.b.served = s.tick;
    ctx.goodsOut.set(best.id, (ctx.goodsOut.get(best.id) ?? 0) + 1);
  }
}

/** Bezczynny specjalista z nadmiarem (zostaje co najmniej jeden) oddaje narzedzia i staje sie wolny. */
function retrainSpare(inv: Inventory): boolean {
  for (let t = 0; t < inv.serfs.length; t++) {
    if (t === S.GENERIC || t === S.TRANSPORTER || t === S.KNIGHT || t === S.DONKEY || t === S.SAILOR) continue;
    if (inv.serfs[t] > 1) {
      inv.serfs[t]--;
      inv.serfs[S.GENERIC]++;
      for (const g of SERF_TOOLS[t]) inv.goods[g]++;
      return true;
    }
  }
  return false;
}

/** Magazyn zamienia wolnego osadnika z mieczem, tarcza i piwem w rycerza (powyzej rezerwy). */
function trainKnights(s: GameState, p: number, invs: Building[]): void {
  const reserve = s.players[p].settings.serfReserve;
  for (const b of invs) {
    const inv = b.inv!;
    while (inv.goods[G.SWORD] > 0 && inv.goods[G.SHIELD] > 0 && inv.goods[G.BEER] > 0) {
      // Brak wolnych osadnikow: przekwalifikuj bezczynnego specjaliste (jeden z kazdego zawodu zostaje).
      if (inv.serfs[S.GENERIC] <= reserve && !retrainSpare(inv)) break;
      inv.goods[G.SWORD]--;
      inv.goods[G.SHIELD]--;
      inv.goods[G.BEER]--;
      inv.serfs[S.GENERIC]--;
      inv.knights[0]++;
    }
  }
}

export function economyPass(s: GameState, p: number): void {
  const pl = s.players[p];
  if (!pl.alive) return;
  const invs = inventoriesOf(s, p);
  if (invs.length === 0) return;
  const ctx: PassCtx = { invs, goodsOut: new Map(), serfsOut: new Map() };
  pl.toolWant.fill(0);
  serfRequests(s, ctx, p);
  goodsRequests(s, ctx, p);
  trainKnights(s, p, invs);
}

/** Narodziny osadnikow w zamku (co tick). Osly rodza sie w hodowli osłów. */
export function birthTick(s: GameState, p: number): void {
  const pl = s.players[p];
  if (!pl.alive) return;
  const castle = s.buildings[pl.castle];
  if (!castle || !castle.inv) return;
  if (--pl.serfTimer <= 0) {
    pl.serfTimer = SERF_BIRTH_TICKS;
    if (pl.totalSerfs < MAX_SERFS) {
      castle.inv.serfs[S.GENERIC]++;
      pl.totalSerfs++;
    }
  }
}

/** Zapasy towaru u gracza (magazyny). */
export function stockOf(s: GameState, p: number, g: number): number {
  let n = 0;
  for (const b of s.buildings) if (b && b.owner === p && b.inv) n += b.inv.goods[g];
  return n;
}
