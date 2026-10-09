/**
 * Produkcja: warsztaty (wejscia -> wyrob), kopalnie (jedzenie + zloze -> wyrob) i zbieracze
 * wychodzacy w teren (drwal, lesnik, kamieniarz, rybak, mysliwy, rolnik).
 *
 * Pola pracownika: home = budynek, target = pole celu (mysliwy: id zwierzecia),
 * road = pole wody (rybak), sub = podstan (WS), timer = czas pracy.
 */
import { animalsNear, pickUpAnimal, shootAnimal } from './animalsApi.ts';
import { B, BUILDINGS, G, NO_GOOD, O, RES, S, T, TOOLS_COUNT, FIRST_TOOL, isStone, mineResource } from './defs.ts';
import { DIR_NW, DIR_SE, hexDist, spiral } from './grid.ts';
import { addTransit, chooseDestination, freeSlot, putGood } from './goods.ts';
import { findPath } from './pathfind.ts';
import { randInt } from './rng.ts';
import { SS, createSerf, sendHome } from './serfs.ts';
import { updateCatapult } from './military.ts';
import { STAGE, type Building, type GameState, type Serf } from './types.ts';
import { event, isFreeWalkable, nb } from './world.ts';

/**
 * Podstany zbieracza. O czas etapow przy chacie (LIMBING, DRESS, HANG, PREP) krotsza jest praca w terenie
 * albo odpoczynek w chacie (workTime, restTime) - wydajnosc zawodu wyznacza BUILDINGS[].cycle, nie te etapy.
 */
export const WS = {
  TO_TARGET: 1, WORKING: 2, RETURN: 3, ENTER: 4, OUT_CARRY: 5,
  /** drwal okrzesuje sciete drzewo na pienku przed chata */
  LIMBING: 6,
  /** kamieniarz ociosuje blok na kamiennym stole przed chata */
  DRESS: 7,
  /** lesnik bierze sadzonke z grzadki przy chacie, zanim ruszy w teren */
  PREP: 8,
  /** mysliwy podchodzi do upolowanego zwierzecia i bierze je na kark */
  FETCH: 9,
  /** mysliwy wiesza zdobycz na stojaku przy chacie i bierze mieso */
  HANG: 10,
} as const;
/** Okrzesywanie scietego drzewa na pienku przed chata; o tyle krotsze jest scinanie (wydajnosc drwala bez zmian). */
export const LIMB_TICKS = 24;
/** Ociosywanie bloku na kostke przed chata kamieniarza; o tyle krotsze jest lupanie skaly. */
export const DRESS_TICKS = 24;
/** Branie sadzonki z grzadki przy chacie lesnika; o tyle krotsze jest sadzenie. */
export const PREP_TICKS = 14;
/** Wieszanie zdobyczy na stojaku przy chacie mysliwego; o tyle krotszy jest odpoczynek mysliwego w chacie. */
export const HANG_TICKS = 14;
/** Odleglosc strzalu mysliwego (pola): podchodzi na tyle do zwierzecia, strzela, potem idzie po zdobycz. */
export const SHOT_RANGE = 2;

const REST_TICKS = 20;
const TRIP_NODES = 600;
const OUT_QUEUE_MAX = 3;
const GATHERERS = new Set<number>([B.WOODCUTTER, B.FORESTER, B.STONECUTTER, B.FISHER, B.HUNTER, B.FARM]);

function flagPos(s: GameState, b: Building): number {
  return s.flags[b.flag]!.pos;
}

function cellDist(m: GameState['map'], a: number, b: number): number {
  return hexDist(a % m.w, (a / m.w) | 0, b % m.w, (b / m.w) | 0);
}

function produced(s: GameState, b: Building, g: number, n = 1): void {
  s.players[b.owner].stats.produced[g] += n;
  b.produced += n;
}

// ---------- Warsztaty i kopalnie ----------

/** Zapas narzedzi pod dostatkiem - bez zapotrzebowania narzedziownia ich nie robi. */
const TOOL_STOCK_ENOUGH = 4;

/**
 * Wybor narzedzia: waga = priorytet * (1 + czekajacy) * 16 - zapas * 4.
 * Narzedzie bez czekajacych i z zapasem >= TOOL_STOCK_ENOUGH jest pomijane. -1 = nic.
 */
function chooseTool(s: GameState, p: number): number {
  const st = s.players[p].settings;
  const want = s.players[p].toolWant;
  const stock = new Array(TOOLS_COUNT).fill(0);
  for (const b of s.buildings) if (b && b.owner === p && b.inv) for (let t = 0; t < TOOLS_COUNT; t++) stock[t] += b.inv.goods[FIRST_TOOL + t];
  let best = -1;
  let bestScore = 0;
  for (let t = 0; t < TOOLS_COUNT; t++) {
    if (st.toolPrio[t] <= 0) continue;
    const w = want[t] ?? 0;
    if (w === 0 && stock[t] >= TOOL_STOCK_ENOUGH) continue;
    const score = st.toolPrio[t] * (1 + w) * 16 - stock[t] * 4 + 1;
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
  if (b.kind === B.CATAPULT) {
    updateCatapult(s, b, serf);
    return;
  }
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
    if (b.kind === B.DONKEYBREEDER) b.phase = 3;
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
  if (phase === 3) {
    // Nowy osiol wychodzi z hodowli i idzie do magazynu.
    const d = createSerf(s, b.owner, S.DONKEY, b.pos);
    sendHome(s, d);
    b.produced++;
    return;
  }
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
    // Cele sa blisko (promien <= 9), wiec maly limit wezlow: nieudane A* nie moze byc drogie.
    const path = findPath(m, fp, dest, (i) => isFreeWalkable(m, i), TRIP_NODES);
    if (!path) continue;
    // Mysliwy zatrzymuje sie na odleglosc strzalu.
    if (b.kind === B.HUNTER) path.length = Math.max(0, path.length - SHOT_RANGE);
    serf.state = SS.WORK_OUT;
    serf.sub = WS.TO_TARGET;
    serf.target = c;
    serf.path = [DIR_SE, ...path];
    serf.anim = 0;
    if (b.kind === B.FORESTER) {
      // Najpierw sadzonka z grzadki przy chacie (sciezke w teren liczy od nowa po etapie PREP).
      serf.sub = WS.PREP;
      serf.timer = PREP_TICKS;
      serf.path = [DIR_SE];
    }
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
      // Strzal: zwierze pada i lezy, az mysliwy po nie podejdzie (etap FETCH).
      return shootAnimal(s, c, serf.id) ? G.MEAT : NO_GOOD;
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
    case B.FORESTER: return 60 - PREP_TICKS;
    case B.WOODCUTTER: return BUILDINGS[kind].cycle - LIMB_TICKS;
    case B.STONECUTTER: return BUILDINGS[kind].cycle - DRESS_TICKS;
    default: return BUILDINGS[kind].cycle;
  }
}

/** Odpoczynek w chacie po powrocie (mysliwy krocej - o czas wieszania zdobyczy). */
function restTime(kind: number): number {
  return kind === B.HUNTER ? REST_TICKS - HANG_TICKS : REST_TICKS;
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
        // Zwierze moglo odejsc o krok przed zamrozeniem - dogon je na odleglosc strzalu.
        const a = s.animals[serf.target];
        if (a && serf.timer === workTime(b.kind) && cellDist(m, a.pos, serf.pos) > SHOT_RANGE) {
          const p = findPath(m, serf.pos, a.pos, (i) => isFreeWalkable(m, i), 400);
          if (p && p.length > SHOT_RANGE) { p.length -= SHOT_RANGE; serf.path = p; return true; }
        }
      }
      if (--serf.timer > 0) return true;
      serf.anim = 0;
      const g = doWork(s, b, serf);
      if (b.kind === B.HUNTER && g !== NO_GOOD) {
        // Trafione zwierze lezy - mysliwy idzie po nie.
        const a = s.animals[serf.target]!;
        serf.sub = WS.FETCH;
        if (a.pos !== serf.pos) {
          const p = findPath(m, serf.pos, a.pos, (i) => isFreeWalkable(m, i) || i === a.pos, 400);
          if (p) serf.path = p;
          else serf.pos = a.pos;
        }
        return true;
      }
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
      const stage = serf.carry < 0 ? 0 : b.kind === B.WOODCUTTER ? WS.LIMBING : b.kind === B.STONECUTTER ? WS.DRESS : b.kind === B.HUNTER ? WS.HANG : 0;
      if (stage) {
        serf.sub = stage;
        serf.timer = stage === WS.LIMBING ? LIMB_TICKS : stage === WS.DRESS ? DRESS_TICKS : HANG_TICKS;
        serf.anim = 4;
        return true;
      }
      deliverAndEnter(s, b, serf);
      return true;
    }
    case WS.LIMBING:
    case WS.DRESS:
    case WS.HANG: {
      if (--serf.timer > 0) return true;
      serf.anim = 0;
      deliverAndEnter(s, b, serf);
      return true;
    }
    case WS.PREP: {
      // Lesnik stoi przy grzadce z sadzonka, potem rusza w teren.
      if (--serf.timer > 0) return true;
      const p = isFreeWalkable(m, serf.target) ? findPath(m, serf.pos, serf.target, (i) => isFreeWalkable(m, i), TRIP_NODES) : null;
      if (!p) {
        releaseTarget(s, serf);
        serf.sub = WS.ENTER;
        serf.path = [DIR_NW];
        return true;
      }
      serf.path = p;
      serf.sub = WS.TO_TARGET;
      return true;
    }
    case WS.FETCH: {
      // Mysliwy przy upolowanym zwierzeciu: bierze je na kark i wraca.
      if (pickUpAnimal(s, serf.target, serf.id)) {
        serf.carry = G.MEAT;
        produced(s, b, G.MEAT);
      }
      releaseTarget(s, serf);
      const back = findPath(m, serf.pos, fp, (i) => isFreeWalkable(m, i), 3000);
      serf.sub = WS.RETURN;
      if (back) serf.path = back;
      else serf.pos = fp;
      return true;
    }
    case WS.ENTER: {
      serf.state = SS.INSIDE;
      serf.sub = 0;
      serf.anim = 0;
      b.timer = restTime(b.kind);
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

/** Oddaje niesiony wyrob na flage (albo do kolejki budynku, gdy flaga pelna) i wraca do budynku. */
function deliverAndEnter(s: GameState, b: Building, serf: Serf): void {
  if (serf.carry >= 0) {
    if (!dropAtFlag(s, b, serf.carry)) b.out.push(serf.carry);
    serf.carry = -1;
  }
  serf.sub = WS.ENTER;
  serf.path = [DIR_NW];
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
  if (b.paused) { serf.anim = 0; return; }
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
    if (startTrip(s, b, serf)) {
      b.idleCycles = 0;
    } else {
      // Brak celu: ponowienie pozniej, z rozrzutem (budynki nie probuja naraz) i rosnacym odstepem.
      b.idleCycles = Math.min(b.idleCycles + 1, 8);
      b.timer = 40 + b.idleCycles * 30 + ((b.id * 37) % 41);
    }
    return;
  }
  updateWorkshop(s, b, serf);
}
