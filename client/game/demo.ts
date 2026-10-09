/**
 * Scenariusz pokazowy (?demo=1): mala dolina, w ktorej od pierwszej chwili pracuja wszystkie zawody -
 * jezioro z rybami, skaly, las ze zwierzyna, gory ze zlozami, pola zboza, warsztaty z zapasami, plac
 * budowy z kopaczem i budowniczym, geolog, a na poludniu front z sasiadem (rycerze i katapulta).
 * Stan budowany jest bezposrednio (gra lokalna, przed pierwszym tickiem); dalej rezyser wydaje zwykle komendy.
 */
import { B, BUILDINGS, FIRST_TOOL, GOODS_COUNT, O, PLAYER_COLORS, RES, S, SIZE, T, TOOLS_COUNT, isMilitary } from '../../sim/defs.ts';
import { placeBuilding } from '../../sim/construction.ts';
import { DIR_SE, hexDist, neighborTable, spiral } from '../../sim/grid.ts';
import { isBigSize } from '../../sim/world.ts';
import { SEA_HEIGHT, createEmptyMap, type GeneratedMap } from '../../sim/mapgen.ts';
import { buildRoad, findRoadPath } from '../../sim/roads.ts';
import { SS, createSerf } from '../../sim/serfs.ts';
import { createGame } from '../../sim/state.ts';
import type { Command } from '../../sim/commands.ts';
import { STAGE, type GameState } from '../../sim/types.ts';
import { canBuild } from '../../sim/world.ts';

const W = 64;
const H = 64;
const idx = (x: number, y: number): number => y * W + x;

function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2d);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Strefy mapy pokazowej (pola offsetowe x, y). */
const LAKE = { x: 11, y: 27, rx: 5, ry: 7.5 };
const MOUNTAINS = { x0: 40, x1: 60, y0: 2, y1: 13 };
const FOREST = { x0: 45, x1: 60, y0: 20, y1: 42 };
const ROCKS = { x0: 10, x1: 24, y0: 5, y1: 11 };
const CASTLE = { x: 30, y: 25 };
const ENEMY_CASTLE = { x: 32, y: 57 };
/** Granica terytoriow: gracz 0 na polnoc od FRONT_Y0, sasiad na poludnie od FRONT_Y1 (miedzy nimi ziemia niczyja). */
const FRONT_Y0 = 45;
const FRONT_Y1 = 49;

function inLake(x: number, y: number): boolean {
  const dx = (x + (y & 1) * 0.5 - LAKE.x) / LAKE.rx, dy = (y - LAKE.y) / LAKE.ry;
  return dx * dx + dy * dy <= 1;
}

function inBox(b: { x0: number; x1: number; y0: number; y1: number }, x: number, y: number): boolean {
  return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
}

/** Mapa doliny: lagodne laki, jezioro na zachodzie, gory na polnocnym wschodzie, las na wschodzie, skaly na polnocnym zachodzie. */
function demoMap(): GeneratedMap {
  const map = createEmptyMap(W, H);
  const nbt = neighborTable(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
      if (edge < 2 || inLake(x, y)) {
        map.terrain[i] = T.WATER;
        map.height[i] = SEA_HEIGHT;
        continue;
      }
      map.terrain[i] = inBox(MOUNTAINS, x, y) ? T.MOUNTAIN : T.GRASS;
      map.height[i] = 8 + Math.round(Math.sin(x * 0.45) * 0.7 + Math.cos(y * 0.38) * 0.7);
    }
  }
  // Odleglosc (w polach) od wody i od podnoza gor - lagodne zbocza nad brzegiem i stoki gor.
  const distTo = (pred: (i: number) => boolean): Int32Array => {
    const d = new Int32Array(W * H).fill(99);
    const q: number[] = [];
    for (let i = 0; i < W * H; i++) if (pred(i)) { d[i] = 0; q.push(i); }
    for (let k = 0; k < q.length; k++) {
      const c = q[k];
      for (let dd = 0; dd < 6; dd++) {
        const j = nbt[c * 6 + dd];
        if (j >= 0 && d[j] > d[c] + 1) { d[j] = d[c] + 1; q.push(j); }
      }
    }
    return d;
  };
  const toWater = distTo((i) => map.terrain[i] === T.WATER);
  const toLand = distTo((i) => map.terrain[i] !== T.MOUNTAIN);
  for (let i = 0; i < W * H; i++) {
    const t = map.terrain[i];
    if (t === T.WATER) continue;
    if (t === T.MOUNTAIN) {
      map.height[i] = Math.min(22, 9 + toLand[i] * 2 + (hash(i, 3) < 0.3 ? 1 : 0));
      continue;
    }
    map.height[i] = Math.min(map.height[i], SEA_HEIGHT + 1 + toWater[i]);
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      const t = map.terrain[i];
      if (t === T.WATER) {
        if (edge(x, y) >= 2) { map.res[i] = RES.FISH; map.resAmt[i] = 40; }
        continue;
      }
      if (t === T.MOUNTAIN) {
        // Zloza pasami: wegiel, zelazo, zloto, granit.
        const band = x < 45 ? RES.COAL : x < 50 ? RES.IRON : x < 55 ? RES.GOLD : RES.STONE;
        map.res[i] = band;
        map.resAmt[i] = 60;
        if (hash(i, 9) < 0.05 && toLand[i] > 2) map.obj[i] = O.STONE1 + 3;
        continue;
      }
      const r = hash(i, 1);
      if (inBox(FOREST, x, y) && r < 0.55) map.obj[i] = O.TREE;
      else if (inBox(ROCKS, x, y) && r < 0.3) map.obj[i] = O.STONE1 + 3 + Math.floor(hash(i, 2) * 3);
      else if (y > FRONT_Y1 + 3 && r < 0.05) map.obj[i] = O.TREE;
    }
  }
  return { map, starts: [idx(CASTLE.x, CASTLE.y), idx(ENEMY_CASTLE.x, ENEMY_CASTLE.y)] };

  function edge(x: number, y: number): number {
    return Math.min(x, y, W - 1 - x, H - 1 - y);
  }
}

/**
 * Plan zabudowy: rodzaj budynku i miejsce docelowe (najblizsze dozwolone pole w promieniu 4).
 * Kolejnosc od zamku na zewnatrz, zeby drogi laczyly sie z juz istniejaca siecia.
 */
const PLAN: [number, number, number][] = [
  [B.SAWMILL, 35, 24], [B.WELL, 25, 21], [B.MILL, 30, 20], [B.BAKERY, 34, 19], [B.BREWERY, 23, 25],
  [B.BUTCHER, 26, 30], [B.WAREHOUSE, 33, 29], [B.PIGFARM, 20, 21], [B.FARM, 27, 15], [B.DONKEYBREEDER, 29, 34],
  [B.WOODCUTTER, 41, 24], [B.WOODCUTTER, 42, 19], [B.FORESTER, 43, 29], [B.HUNTER, 44, 34], [B.CHARBURNER, 37, 32],
  [B.STONECUTTER, 21, 14], [B.FISHER, 18, 26], [B.SHIPYARD, 19, 32],
  [B.STEELWORKS, 35, 14], [B.TOOLMAKER, 39, 15], [B.WEAPONSMITH, 38, 19], [B.MINT, 31, 11],
  [B.COALMINE, 41, 9], [B.IRONMINE, 46, 9], [B.GOLDMINE, 51, 7], [B.STONEMINE, 56, 10],
  [B.GUARDHUT, 22, 37], [B.TOWER, 41, 39], [B.GUARDHOUSE, 33, 38], [B.FORTRESS, 26, 41], [B.CATAPULT, 36, 42],
];
/** Budynki sasiada przy froncie (cel atakow i katapulty). */
const ENEMY_PLAN: [number, number, number][] = [[B.GUARDHOUSE, 30, 51], [B.TOWER, 37, 52]];
/** Miejsca placow budowy (srednie budynki na nierownym terenie - najpierw kopacz, potem budowniczy). */
const SITE_SPOTS: [number, number][] = [[30, 29], [24, 33], [38, 27]];
const SITE_KINDS = [B.BREWERY, B.BAKERY, B.WAREHOUSE];

/** Laczy flage z najblizsza flaga sieci drog gracza. */
function connect(s: GameState, p: number, flagPos: number): boolean {
  const castle = s.buildings[s.players[p].castle]!;
  const fx = flagPos % W, fy = (flagPos / W) | 0;
  const targets = s.flags
    .filter((f) => f && f.owner === p && f.pos !== flagPos && (f.id === castle.flag || f.roads.some((r) => r >= 0)))
    .map((f) => f!.pos)
    .sort((a, b) => hexDist(fx, fy, a % W, (a / W) | 0) - hexDist(fx, fy, b % W, (b / W) | 0) || a - b);
  for (const t of targets.slice(0, 10)) {
    const dirs = findRoadPath(s, p, flagPos, t);
    if (dirs && buildRoad(s, p, flagPos, dirs) >= 0) return true;
  }
  return false;
}

/**
 * Teren pod gotowym budynkiem jak po pracy kopacza: pole budynku i 6 sasiadow na sredniej wysokosci (male budynki -
 * tylko w strone sredniej, o najwyzej 1), zeby przed budynkiem nic nie zapadalo sie w stok.
 */
function level(s: GameState, pos: number, full: boolean): void {
  const m = s.map;
  const nbt = neighborTable(W, H);
  const cells = [pos];
  for (let d = 0; d < 6; d++) {
    const j = nbt[pos * 6 + d];
    if (j >= 0 && m.terrain[j] !== T.WATER) cells.push(j);
  }
  let sum = 0;
  for (const c of cells) sum += m.height[c];
  const avg = Math.round(sum / cells.length);
  for (const c of cells) {
    const h = m.height[c];
    m.height[c] = full ? avg : h + Math.sign(avg - h);
  }
}

/** Stawia gotowy budynek w poblizu (x, y), laczy droga, osadza pracownika (albo rycerzy) i daje zapasy. */
function place(s: GameState, p: number, kind: number, x: number, y: number, knightLevel = 1): number {
  const nbt = neighborTable(W, H);
  for (const pos of spiral(W, H, x, y, 4)) {
    if (!canBuild(s, p, pos, kind)) continue;
    const id = placeBuilding(s, p, pos, kind, true);
    if (id < 0) continue;
    const b = s.buildings[id]!;
    if (kind !== B.CASTLE && BUILDINGS[kind].size !== SIZE.MINE) level(s, pos, isBigSize(BUILDINGS[kind].size));
    connect(s, p, nbt[pos * 6 + DIR_SE]);
    const def = BUILDINGS[kind];
    if (def.worker >= 0) {
      const w = createSerf(s, p, def.worker, pos);
      w.state = SS.INSIDE;
      w.home = id;
      b.worker = w.id;
      b.workerInside = true;
      s.players[p].totalSerfs++;
    }
    if (isMilitary(kind)) {
      for (let k = 0; k < def.knights; k++) {
        const kn = createSerf(s, p, S.KNIGHT, pos);
        kn.level = Math.min(4, knightLevel + (k % 2));
        kn.state = SS.INSIDE;
        kn.home = id;
        b.knights.push(kn.id);
        s.players[p].totalSerfs++;
      }
    }
    for (let i = 0; i < b.stock.length; i++) b.stock[i] = 6;
    return id;
  }
  console.warn('Pokaz: brak miejsca na', BUILDINGS[kind].name, x, y);
  return -1;
}

export function createDemoGame(): GameState {
  const s = createGame({
    mapCode: 'POKAZ',
    mapSize: 64,
    players: [{ name: 'Ty', color: PLAYER_COLORS[0], ai: 0 }, { name: 'Sąsiad', color: PLAYER_COLORS[1], ai: 0 }],
    seed: 11,
  }, demoMap());
  const m = s.map;
  // Terytorium: dolina na polnoc od frontu nalezy do gracza, poludnie do sasiada (budynki stawiamy od razu gotowe).
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = idx(x, y);
      if (y < FRONT_Y0) m.owner[i] = 1;
      else if (y > FRONT_Y1) m.owner[i] = 2;
      else m.owner[i] = 0;
    }
  }
  for (const pl of s.players) {
    const inv = s.buildings[pl.castle]!.inv!;
    for (let g = 0; g < GOODS_COUNT; g++) inv.goods[g] = Math.max(inv.goods[g], 60);
    // Narzedzi malo (zapas ponizej progu kuzni narzedzi) - inaczej kuznia narzedzi nie mialaby czego robic.
    for (let t = 0; t < TOOLS_COUNT; t++) inv.goods[FIRST_TOOL + t] = 2;
    inv.serfs[S.GENERIC] = 140;
    inv.serfs[S.DONKEY] = 10;
    pl.totalSerfs += 120;
  }
  s.buildings[s.players[1].castle]!.inv!.knights = [0, 4, 10, 10, 6];
  s.buildings[s.players[0].castle]!.inv!.knights = [6, 6, 4, 2, 0];
  for (const [k, x, y] of ENEMY_PLAN) place(s, 1, k, x, y, 2);
  for (const [k, x, y] of PLAN) place(s, 0, k, x, y, 1);
  // Nierowny teren w miejscach placow budowy (kopacz wyrownuje, zanim wejdzie budowniczy).
  for (const [x, y] of SITE_SPOTS) {
    for (const c of spiral(W, H, x, y, 1)) if (m.terrain[c] === T.GRASS && m.obj[c] === O.NONE) m.height[c] = 8 + ((c * 7) % 3) - 1;
  }
  // Dojrzale zboze wokol farmy, zwierzyna przy lesie.
  for (const b of s.buildings) {
    if (!b || b.owner !== 0) continue;
    if (b.kind === B.FARM) {
      let n = 0;
      for (const c of spiral(W, H, b.pos % W, (b.pos / W) | 0, 3)) {
        if (n >= 5 || m.obj[c] !== O.NONE || m.roads[c] !== 0 || m.terrain[c] !== T.GRASS || hexDist(c % W, (c / W) | 0, b.pos % W, (b.pos / W) | 0) < 2) continue;
        if (s.map.obj[c + 1] === O.FLAG || s.map.obj[c - 1] === O.FLAG) continue;
        m.obj[c] = O.FIELD_RIPE;
        n++;
      }
    }
    if (b.kind === B.HUNTER) {
      let n = 0;
      for (const c of spiral(W, H, b.pos % W, (b.pos / W) | 0, 6)) {
        if (n >= 4 || m.obj[c] !== O.NONE || m.roads[c] !== 0 || m.terrain[c] !== T.GRASS || hash(c, 5) > 0.2) continue;
        const id = s.animals.length;
        s.animals.push({ id, pos: c, to: -1, t: 0, dur: 0, timer: 40 + n * 25, hunter: -1, dead: false });
        n++;
      }
    }
  }
  s._events = [];
  return s;
}

/** Plac budowy w jednym z miejsc pokazowych: droga od sieci do przyszlej flagi i budowa (gdy sie da). */
function siteCommands(s: GameState): Command[] {
  const nbt = neighborTable(W, H);
  for (let k = 0; k < SITE_SPOTS.length; k++) {
    const [x, y] = SITE_SPOTS[(k + Math.floor(s.tick / 1000)) % SITE_SPOTS.length];
    const kind = SITE_KINDS[(k + Math.floor(s.tick / 1000)) % SITE_KINDS.length];
    for (const pos of spiral(W, H, x, y, 1)) {
      if (!canBuild(s, 0, pos, kind)) continue;
      const flagPos = nbt[pos * 6 + DIR_SE];
      const castle = s.buildings[s.players[0].castle]!;
      const fx = flagPos % W, fy = (flagPos / W) | 0;
      const near = s.flags
        .filter((f) => f && f.owner === 0 && (f.id === castle.flag || f.roads.some((r) => r >= 0)))
        .map((f) => f!.pos)
        .sort((a, b) => hexDist(fx, fy, a % W, (a / W) | 0) - hexDist(fx, fy, b % W, (b / W) | 0));
      for (const t of near.slice(0, 6)) {
        const dirs = findRoadPath(s, 0, t, flagPos);
        if (dirs) return [{ type: 'road', player: 0, pos: t, dirs }, { type: 'build', player: 0, pos, kind }];
      }
    }
  }
  return [];
}

/**
 * Rezyser pokazu: co jakis czas atak na sasiada (pojedynki), geolog w gorach, nowy plac budowy, gdy zaden
 * nie trwa (najstarszy pokazowy budynek idzie wtedy do rozbiorki, zeby miejsca sie zwalnialy).
 */
export function demoDirector(): (s: GameState) => Command[] {
  const built: number[] = [];
  return (s) => {
    const out: Command[] = [];
    const t = s.tick;
    if (t % 1200 === 400) {
      const target = s.buildings.find((b) => b && b.owner === 1 && b.stage === STAGE.DONE && isMilitary(b.kind) && b.knights.length > 0);
      if (target) out.push({ type: 'attack', player: 0, pos: target.pos, count: 2 });
    }
    if (t % 1500 === 200) {
      const mine = s.buildings.find((b) => b && b.owner === 0 && b.kind === B.IRONMINE);
      if (mine) out.push({ type: 'geologist', player: 0, pos: s.flags[mine.flag]!.pos });
    }
    if (t % 100 === 50) {
      const busy = s.buildings.some((b) => b && b.owner === 0 && (b.stage === STAGE.BUILD || b.stage === STAGE.LEVEL));
      if (!busy) {
        for (const b of s.buildings) {
          if (b && b.owner === 0 && b.stage === STAGE.DONE && SITE_SPOTS.some(([x, y]) => hexDist(x, y, b.pos % W, (b.pos / W) | 0) <= 1) && !built.includes(b.id)) built.push(b.id);
        }
        if (built.length >= SITE_SPOTS.length) {
          const old = s.buildings[built.shift()!];
          if (old) out.push({ type: 'demolish', player: 0, pos: old.pos });
        } else out.push(...siteCommands(s));
      }
    }
    return out;
  };
}

/** Pole budynku danego rodzaju gracza 0 (do szybkiego ogladania w pokazie) albo -1. */
export function demoBuildingPos(s: GameState, kind: number, nth = 0): number {
  let k = 0;
  for (const b of s.buildings) if (b && b.owner === 0 && b.kind === kind && k++ === nth) return b.pos;
  return -1;
}

