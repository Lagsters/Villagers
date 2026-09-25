/**
 * Produkcja: warsztaty (wejscia -> wyrob), kopalnie (jedzenie + zloze -> wyrob) i zbieracze
 * wychodzacy w teren (drwal, lesnik, kamieniarz, rybak, mysliwy, rolnik).
 *
 * Pola pracownika: home = budynek, target = pole celu (mysliwy: id zwierzecia),
 * road = pole wody (rybak), sub = podstan (WS), timer = czas pracy.
 */
import { animalsNear, removeAnimalById } from './animalsApi.ts';
import { B, BUILDINGS, G, NO_GOOD, O, RES, T, TOOLS_COUNT, FIRST_TOOL, isStone, mineResource } from './defs.ts';
import { DIR_NW, DIR_SE, spiral } from './grid.ts';
import { addTransit, chooseDestination, freeSlot, putGood } from './goods.ts';
import { findPath } from './pathfind.ts';
import { randInt } from './rng.ts';
import { SS, sendHome } from './serfs.ts';
import { STAGE, type Building, type GameState, type Serf } from './types.ts';
import { event, isFreeWalkable, nb } from './world.ts';

export const WS = { TO_TARGET: 1, WORKING: 2, RETURN: 3, ENTER: 4, OUT_CARRY: 5 } as const;

const REST_TICKS = 20;
const OUT_QUEUE_MAX = 3;
const GATHERERS = new Set<number>([B.WOODCUTTER, B.FORESTER, B.STONECUTTER, B.FISHER, B.HUNTER, B.FARM]);

function flagPos(s: GameState, b: Building): number {
  return s.flags[b.flag]!.pos;
}

function produced(s: GameState, b: Building, g: number, n = 1): void {
  s.players[b.owner].stats.produced[g] += n;
  b.produced += n;
}

// ---------- Warsztaty i kopalnie ----------

/** Wybor narzedzia wg priorytetow i brakow. -1 = nic. */
function chooseTool(s: GameState, p: number): number {
  const st = s.players[p].settings;
  const want = s.players[p].toolWant;
  let best = -1;
  let bestScore = 0;
  for (let t = 0; t < TOOLS_COUNT; t++) {
    const score = st.toolPrio[t] * (1 + want[t]);
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

/** Pole ze zlozem w promieniu kopalni albo -1. */
function mineCell(s: GameState, b: Building): number {
  const res = mineResource(b.kind);
  const m = s.map;
  for (const i of spiral(m.w, m.h, b.pos % m.w, (b.pos / m.w) | 0, BUILDINGS[b.kind].radius)) {
    if (m.res[i] === res && m.resAmt[i] > 0) return i;
  }
  return -1;
}

function isMineKind(k: number): boolean {
  return k >= B.COALMINE && k <= B.STONEMINE;
}

function updateWorkshop(s: GameState, b: Building, serf: Serf): void {
  const def = BUILDINGS[b.kind];
  if (b.phase === 0) {
    if (b.out.length >= OUT_QUEUE_MAX) { serf.anim = 0; return; }
    for (let i = 0; i < b.stock.length; i++) if (b.stock[i] <= 0) { serf.anim = 0; return; }
    let product = def.output;
    if (b.kind === B.TOOLMAKER) {
      const t = chooseTool(s, b.owner);
      if (t < 0) { serf.anim = 0; return; }
      product = FIRST_TOOL + t;
    }
    for (let i = 0; i < b.stock.length; i++) b.stock[i]--;
    if (isMineKind(b.kind)) {
      const c = mineCell(s, b);
      if (c >= 0) {
        s.map.resAmt[c]--;
        if (s.map.resAmt[c] === 0) s.map.res[c] = RES.NONE;
        b.idleCycles = 0;
      } else {
        product = NO_GOOD;
        if (++b.idleCycles === 5) event(s, 'exhausted', b.owner, b.pos, b.kind);
      }
    }
    b.phase = product === NO_GOOD ? 2 : 1;
    b.timer = def.cycle;
    // Wybrane narzedzie zapamietujemy w `phase` (>= 10) - bez dodatkowego pola.
    if (b.kind === B.TOOLMAKER && product !== NO_GOOD) b.phase = 10 + (product - FIRST_TOOL);
    serf.anim = 1;
    return;
  }
  if (--b.timer > 0) return;
  serf.anim = 0;
  const phase = b.phase;
  b.phase = 0;
  if (phase === 2) return; // pusty cykl kopalni
  if (b.kind === B.TOOLMAKER) {
    const g = FIRST_TOOL + (phase - 10);
    b.out.push(g);
    produced(s, b, g);
    return;
  }
  if (b.kind === B.WEAPONSMITH) {
    b.out.push(G.SWORD, G.SHIELD);
    produced(s, b, G.SWORD);
    produced(s, b, G.SHIELD);
    return;
  }
  if (b.kind === B.STONEMINE) {
    b.out.push(G.STONE, G.STONE);
    produced(s, b, G.STONE, 2);
    return;
  }
  b.out.push(def.output);
  produced(s, b, def.output);
}

// ---------- Zbieracze ----------

function reservedByOther(s: GameState, i: number, me: number): boolean {
  const r = s.map.objId[i];
  if (r < 0 || r === me) return false;
  const other = s.serfs[r];
  return !!other && other.target === i && other.state === SS.WORK_OUT;
}

/** Wolne miejsce pod sadzonke / pole: trawa, bez drogi i obiektu, bez sasiedztwa z budynkiem i flaga. */
function plantable(s: GameState, i: number, p: number): boolean {
  const m = s.map;
  if (m.terrain[i] !== T.GRASS || m.obj[i] !== O.NONE || m.roads[i] !== 0) return false;
  if (m.owner[i] !== 0 && m.owner[i] !== p + 1) return false;
  const t = nb(m);
  for (let d = 0; d < 6; d++) {
    const j = t[i * 6 + d];
    if (j < 0) return false;
    const o = m.obj[j];
    if (o === O.FLAG || o === O.BUILDING || o === O.BUILDING_PART) return false;
  }
  return true;
}

function shoreFishTarget(s: GameState, land: number): number {
  const m = s.map;
  const t = nb(m);
  for (let d = 0; d < 6; d++) {
    const j = t[land * 6 + d];
    if (j >= 0 && m.terrain[j] === T.WATER && m.res[j] === RES.FISH && m.resAmt[j] > 0) return j;
  }
  return -1;
}

/** Kandydaci na cel pracy; zwraca liste pol (albo id zwierzat dla mysliwego). */
function candidates(s: GameState, b: Building, serf: Serf): number[] {
  const m = s.map;
  const r = BUILDINGS[b.kind].radius;
  const out: number[] = [];
  if (b.kind === B.HUNTER) return animalsNear(s, b.pos, r);
  const cells = spiral(m.w, m.h, b.pos % m.w, (b.pos / m.w) | 0, r);
  switch (b.kind) {
    case B.WOODCUTTER:
      for (const i of cells) if (m.obj[i] === O.TREE && !reservedByOther(s, i, serf.id)) out.push(i);
      break;
    case B.STONECUTTER:
      for (const i of cells) if (isStone(m.obj[i]) && !reservedByOther(s, i, serf.id)) out.push(i);
      break;
    case B.FORESTER:
      for (const i of cells) if (i !== b.pos && plantable(s, i, b.owner)) out.push(i);
      break;
    case B.FISHER:
      for (const i of cells) if (isFreeWalkable(m, i) && m.obj[i] !== O.FLAG && shoreFishTarget(s, i) >= 0) out.push(i);
      break;
    case B.FARM: {
      for (const i of cells) if (m.obj[i] === O.FIELD_RIPE && !reservedByOther(s, i, serf.id)) out.push(i);
      if (out.length === 0) for (const i of cells) if (plantable(s, i, b.owner)) out.push(i);
      break;
    }
  }
  return out;
}

/** Wysyla zbieracza w teren. Zwraca false, gdy brak celu. */
function startTrip(s: GameState, b: Building, serf: Serf): boolean {
  const cands = candidates(s, b, serf);
  if (cands.length === 0) return false;
  const m = s.map;
  const fp = flagPos(s, b);
  // Kilka prob, bo cel moze byc nieosiagalny.
  for (let attempt = 0; attempt < 3 && cands.length > 0; attempt++) {
    const k = randInt(s, Math.min(cands.length, attempt === 0 ? 8 : cands.length));
    const c = cands[k];
    cands.splice(k, 1);
    let dest = c;
    if (b.kind === B.HUNTER) {
      const a = s.animals[c]!;
      dest = a.to >= 0 ? a.to : a.pos;
    }
    const path = findPath(m, fp, dest, (i) => isFreeWalkable(m, i), 3000);
    if (!path) continue;
    serf.state = SS.WORK_OUT;
    serf.sub = WS.TO_TARGET;
    serf.target = c;
    serf.path = [DIR_SE, ...path];
    serf.anim = 0;
    if (b.kind === B.HUNTER) s.animals[c]!.hunter = serf.id;
    else if (b.kind === B.WOODCUTTER || b.kind === B.STONECUTTER || (b.kind === B.FARM && m.obj[c] === O.FIELD_RIPE)) m.objId[c] = serf.id;
    if (b.kind === B.FISHER) serf.road = shoreFishTarget(s, c);
    return true;
  }
  return false;
}

/** Czynnosc na miejscu. Zwraca wyrob albo NO_GOOD. */
function doWork(s: GameState, b: Building, serf: Serf): number {
  const m = s.map;
  const c = serf.target;
  switch (b.kind) {
    case B.WOODCUTTER:
      if (m.obj[c] !== O.TREE) return NO_GOOD;
      m.obj[c] = O.STUMP;
      m.objTimer[c] = 0;
      m.objId[c] = -1;
      return G.LUMBER;
    case B.STONECUTTER:
      if (!isStone(m.obj[c])) return NO_GOOD;
      m.obj[c] = m.obj[c] === O.STONE1 ? O.NONE : m.obj[c] - 1;
      m.objId[c] = -1;
      return G.STONE;
    case B.FORESTER:
      if (plantable(s, c, b.owner)) {
        m.obj[c] = O.SAPLING1;
        m.objTimer[c] = 0;
        m.objId[c] = -1;
      }
      return NO_GOOD;
    case B.FISHER: {
      const w = serf.road;
      if (w >= 0 && m.res[w] === RES.FISH && m.resAmt[w] > 0) {
        m.resAmt[w]--;
        return G.FISH;
      }
      return NO_GOOD;
    }
    case B.HUNTER:
      return removeAnimalById(s, c, serf.id) ? G.MEAT : NO_GOOD;
    case B.FARM:
      if (m.obj[c] === O.FIELD_RIPE) {
        m.obj[c] = O.NONE;
        m.objTimer[c] = 0;
        m.objId[c] = -1;
        return G.WHEAT;
      }
      if (plantable(s, c, b.owner)) {
        m.obj[c] = O.FIELD1;
        m.objTimer[c] = 0;
      }
      return NO_GOOD;
  }
  return NO_GOOD;
}

function workTime(kind: number): number {
  switch (kind) {
    case B.HUNTER: return 20;
    case B.FORESTER: return 60;
    default: return BUILDINGS[kind].cycle;
  }
}

/** Oddaje wyrob na flage z wybranym celem. */
function dropAtFlag(s: GameState, b: Building, g: number): boolean {
  const f = s.flags[b.flag];
  if (!f || freeSlot(f) < 0) return false;
  const dest = chooseDestination(s, b.owner, f.id, g);
  if (dest >= 0) {
    const d = s.buildings[dest]!;
    if (!d.inv) addTransit(d, g, 1);
  }
  if (!putGood(s, f, g, dest)) {
    if (dest >= 0 && !s.buildings[dest]!.inv) addTransit(s.buildings[dest]!, g, -1);
    return false;
  }
  return true;
}

/** Logika pracownika poza budynkiem (hook osadnika). */
export function updateWorkerOut(s: GameState, serf: Serf): boolean {
  if (serf.state !== SS.WORK_OUT) return false;
  const b = s.buildings[serf.home];
  if (!b || b.stage !== STAGE.DONE || b.worker !== serf.id || b.owner !== serf.owner) {
    releaseTarget(s, serf);
    serf.carry = -1;
    serf.anim = 0;
    sendHome(s, serf);
    return true;
  }
  const m = s.map;
  const fp = flagPos(s, b);
  switch (serf.sub) {
    case WS.TO_TARGET: {
      serf.sub = WS.WORKING;
      serf.timer = workTime(b.kind);
      serf.anim = 1;
      return true;
    }
    case WS.WORKING: {
      if (b.kind === B.HUNTER) {
        // Zwierze moglo odejsc o krok przed zamrozeniem - dogon je.
        const a = s.animals[serf.target];
        if (a && a.pos !== serf.pos && serf.timer === workTime(b.kind)) {
          const p = findPath(m, serf.pos, a.pos, (i) => isFreeWalkable(m, i), 400);
          if (p && p.length > 0) { serf.path = p; return true; }
        }
      }
      if (--serf.timer > 0) return true;
      serf.anim = 0;
      const g = doWork(s, b, serf);
      if (g !== NO_GOOD) {
        serf.carry = g;
        produced(s, b, g);
      }
      releaseTarget(s, serf);
      const back = findPath(m, serf.pos, fp, (i) => isFreeWalkable(m, i), 3000);
      serf.sub = WS.RETURN;
      if (back) serf.path = back;
      else {
        // Nie ma drogi powrotnej (np. zarosla) - wraca "na skroty" do budynku.
        serf.pos = fp;
      }
      return true;
    }
    case WS.RETURN: {
      if (serf.pos !== fp) {
        const back = findPath(m, serf.pos, fp, (i) => isFreeWalkable(m, i), 3000);
        if (back && back.length) { serf.path = back; return true; }
        serf.pos = fp;
      }
      if (serf.carry >= 0) {
        if (dropAtFlag(s, b, serf.carry)) serf.carry = -1;
        else {
          b.out.push(serf.carry);
          serf.carry = -1;
        }
      }
      serf.sub = WS.ENTER;
      serf.path = [DIR_NW];
      return true;
    }
    case WS.ENTER: {
      serf.state = SS.INSIDE;
      serf.sub = 0;
      serf.anim = 0;
      b.timer = REST_TICKS;
      return true;
    }
    case WS.OUT_CARRY: {
      if (serf.carry >= 0) {
        if (!dropAtFlag(s, b, serf.carry)) return true; // czeka na miejsce
        serf.carry = -1;
      }
      serf.sub = WS.ENTER;
      serf.path = [DIR_NW];
      return true;
    }
  }
  return true;
}

function releaseTarget(s: GameState, serf: Serf): void {
  const b = s.buildings[serf.home];
  if (b && b.kind === B.HUNTER) {
    const a = s.animals[serf.target];
    if (a && a.hunter === serf.id) a.hunter = -1;
  } else if (serf.target >= 0 && serf.target < s.map.objId.length && s.map.objId[serf.target] === serf.id) {
    const o = s.map.obj[serf.target];
    if (o !== O.FLAG && o !== O.BUILDING && o !== O.BUILDING_PART) s.map.objId[serf.target] = -1;
  }
  serf.target = -1;
}

/** Hook budynku: pracownik w srodku. */
export function updateProduction(s: GameState, b: Building): void {
  if (b.stage !== STAGE.DONE || !b.workerInside || b.worker < 0) return;
  const def = BUILDINGS[b.kind];
  if (def.worker < 0) return;
  const serf = s.serfs[b.worker];
  if (!serf || serf.state !== SS.INSIDE) return;
  // Najpierw wynosimy gotowe wyroby na flage.
  if (b.out.length > 0) {
    const f = s.flags[b.flag];
    if (f && freeSlot(f) >= 0 && b.phase === 0) {
      serf.carry = b.out.shift()!;
      serf.state = SS.WORK_OUT;
      serf.sub = WS.OUT_CARRY;
      serf.path = [DIR_SE];
      serf.anim = 3;
      return;
    }
  }
  if (GATHERERS.has(b.kind)) {
    if (b.out.length >= OUT_QUEUE_MAX) return;
    if (b.timer > 0) { b.timer--; return; }
    if (!startTrip(s, b, serf)) b.timer = 40;
    return;
  }
  updateWorkshop(s, b, serf);
}
