/**
 * Bot gracza. Czyta stan gry i zwraca komendy - dokladnie te same, ktore wysyla czlowiek.
 * Poziomy: 1 = latwy (mysli co 50 tickow, pozno i ostroznie atakuje), 2 = trudny (co 20 tickow,
 * szybsza rozbudowa, pelny lancuch militarny, atakuje przewaga).
 * Bot ma wlasny PRNG (nie jest czescia stanu gry): w sieci boty liczy tylko host.
 */
import { B, BUILDINGS, FIRST_TOOL, G, O, RES, S, SERF_TOOLS, SIZE, T, TOOLS_COUNT, isMilitary, isStone } from '../sim/defs.ts';
import type { Command } from '../sim/commands.ts';
import { DIR_SE, hexDist, spiral } from '../sim/grid.ts';
import { attackPreview, attackersAvailable, defenderLevels, isAttackTarget } from '../sim/military.ts';
import { findRoadPath } from '../sim/roads.ts';
import { UNREACHABLE, flagDist } from '../sim/routing.ts';
import { STAGE, type Building, type GameState } from '../sim/types.ts';
import { buildingCells, canBuild, neighbor } from '../sim/world.ts';

export const AI_EASY = 1;
export const AI_HARD = 2;

/** Przyblizona sila rycerza wg poziomu (skutecznosc w pojedynkach). */
const POWER = [1, 1.7, 2.8, 4.4, 6.5];

interface Need {
  kind: number;
  want: number;
  score: (pos: number) => number;
  /** minimalny wynik miejsca (np. liczba drzew) */
  min?: number;
}

export class Bot {
  readonly player: number;
  readonly level: number;
  private rng: number;
  private nextThink: number;
  private failed = new Map<number, number>(); // pole -> tick, do ktorego nie probujemy
  private lastAttack = -10000;
  private settingsDone = false;
  private lastExpand = -10000;
  /** Pola nalezace do gracza (odswiezane co myslenie). */
  private owned: number[] = [];

  constructor(player: number, level: number, seed: number) {
    this.player = player;
    this.level = level;
    this.rng = (seed ^ (player * 0x9e3779b1)) >>> 0 || 1;
    this.nextThink = 10 + player * 3;
  }

  private rand(n: number): number {
    let x = this.rng;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rng = x >>> 0;
    return this.rng % n;
  }

  get period(): number {
    return this.level >= AI_HARD ? 20 : 50;
  }

  /** Komendy na biezacy tick (zwykle pusta lista). */
  think(s: GameState): Command[] {
    const pl = s.players[this.player];
    if (!pl || !pl.alive || s.winner !== -1) return [];
    if (s.tick < this.nextThink) return [];
    this.nextThink = s.tick + this.period;
    const cmds: Command[] = [];
    if (!this.settingsDone) {
      this.settingsDone = true;
      this.initialSettings(cmds);
    }
    this.refreshOwned(s);
    this.fixDisconnected(s, cmds);
    this.demolishExhausted(s, cmds);
    this.demolishIdleGatherers(s, cmds);
    this.demolishStuckSites(s, cmds);
    this.demolishRedundantMilitary(s, cmds);
    this.updateFinishing(s, cmds);
    this.adjustSettings(s, cmds);
    if (this.tryAttack(s, cmds)) return cmds;
    this.build(s, cmds);
    return cmds;
  }

  private initialSettings(cmds: Command[]): void {
    const p = this.player;
    const hard = this.level >= AI_HARD;
    cmds.push({ type: 'setting', player: p, key: 'knightsInterior', value: 1 });
    cmds.push({ type: 'setting', player: p, key: 'knightsBorder', value: hard ? 2 : 2 });
    cmds.push({ type: 'setting', player: p, key: 'knightsEnemy', value: hard ? 8 : 4 });
    cmds.push({ type: 'setting', player: p, key: 'castleKnights', value: hard ? 3 : 2 });
    // Mlotki (budowniczowie, platnerze) i kilofy (gornicy) sa najwazniejsze.
    const tools = new Array(TOOLS_COUNT).fill(3);
    tools[G.HAMMER - FIRST_TOOL] = 8;
    tools[G.PICK - FIRST_TOOL] = 7;
    tools[G.AXE - FIRST_TOOL] = 5;
    tools[G.SAW - FIRST_TOOL] = 5;
    tools[G.SCYTHE - FIRST_TOOL] = 5;
    tools[G.SHOVEL - FIRST_TOOL] = 6;
    cmds.push({ type: 'setting', player: p, key: 'toolPrio', value: tools });
  }

  private refreshOwned(s: GameState): void {
    const own = this.player + 1;
    const o = s.map.owner;
    this.owned.length = 0;
    for (let i = 0; i < o.length; i++) if (o[i] === own) this.owned.push(i);
  }

  // ---------- Pomocnicze ----------

  private mine(s: GameState): Building[] {
    const out: Building[] = [];
    for (const b of s.buildings) if (b && b.owner === this.player && b.stage !== STAGE.BURN) out.push(b);
    return out;
  }

  private count(bs: Building[], kind: number): number {
    let n = 0;
    for (const b of bs) if (b.kind === kind) n++;
    return n;
  }

  private sites(bs: Building[]): number {
    let n = 0;
    for (const b of bs) if (b.stage === STAGE.LEVEL || b.stage === STAGE.BUILD) n++;
    return n;
  }

  /** Wolni osadnicy danego zawodu we wszystkich magazynach. */
  private idle(s: GameState, type: number): number {
    let n = 0;
    for (const b of s.buildings) if (b && b.owner === this.player && b.inv) n += b.inv.serfs[type];
    return n;
  }

  /**
   * Czy da sie postawic i obsadzic budynek: budowniczy (mlotek), kopacz dla duzych (lopata),
   * pracownik z narzedziami. Bez tego plac albo budynek stalby bezczynnie.
   */
  private canStaff(s: GameState, kind: number): boolean {
    const def = BUILDINGS[kind];
    const has = (type: number) => this.idle(s, type) > 0 || SERF_TOOLS[type].every((g) => this.stock(s, g) > 0);
    if (!has(S.BUILDER)) return false;
    if (def.size === SIZE.LARGE && !has(S.DIGGER)) return false;
    if (def.worker >= 0 && !has(def.worker)) return false;
    return true;
  }

  private stock(s: GameState, g: number): number {
    let n = 0;
    for (const b of s.buildings) if (b && b.owner === this.player && b.inv) n += b.inv.goods[g];
    return n;
  }

  private near(s: GameState, pos: number, r: number, pred: (i: number) => boolean): number {
    let n = 0;
    for (const i of spiral(s.map.w, s.map.h, pos % s.map.w, (pos / s.map.w) | 0, r)) if (pred(i)) n++;
    return n;
  }

  private dist(s: GameState, a: number, b: number): number {
    const w = s.map.w;
    return hexDist(a % w, (a / w) | 0, b % w, (b / w) | 0);
  }

  private castle(s: GameState): Building | null {
    const c = s.buildings[s.players[this.player].castle];
    return c && c.owner === this.player ? c : null;
  }

  private nearestInvDist(s: GameState, pos: number): number {
    let d = 1 << 20;
    for (const b of s.buildings) if (b && b.owner === this.player && b.inv) d = Math.min(d, this.dist(s, pos, b.pos));
    return d;
  }

  /** Flagi osiagalne po drogach z zamku lub magazynu, posortowane wg odleglosci od pola. */
  private networkFlags(s: GameState, pos: number): number[] {
    const w = s.map.w;
    const px = pos % w, py = (pos / w) | 0;
    const list: [number, number][] = [];
    for (const f of s.flags) {
      if (!f || f.owner !== this.player) continue;
      if (!this.reachable(s, f.id)) continue;
      list.push([hexDist(px, py, f.pos % w, (f.pos / w) | 0), f.pos]);
    }
    list.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return list.map((x) => x[1]);
  }

  /**
   * Czy flaga ma polaczenie drogowe z zamkiem. Liczymy od zamku, nie od dowolnego magazynu: magazyn
   * w odcietej czesci sieci nie ma zwykle budowniczych ani desek, wiec taka czesc trzeba dolaczyc.
   */
  private reachable(s: GameState, flagId: number): boolean {
    const c = this.castle(s);
    if (!c) return false;
    return c.flag === flagId || flagDist(s, this.player, flagId, c.flag, false) < UNREACHABLE;
  }

  /**
   * Droga z sieci do pola flagi `flagPos` omijajaca pola budynku. Zwraca komende albo null.
   */
  private roadTo(s: GameState, flagPos: number, avoid: number[], maxLen = 16, tries = 6): Command | null {
    for (const from of this.networkFlags(s, flagPos).slice(0, tries)) {
      if (from === flagPos) return null;
      const dirs = findRoadPath(s, this.player, from, flagPos);
      if (!dirs || dirs.length > maxLen) continue;
      let c = from;
      let bad = false;
      for (const d of dirs) {
        c = neighbor(s.map, c, d);
        if (avoid.includes(c)) { bad = true; break; }
      }
      if (bad) continue;
      return { type: 'road', player: this.player, pos: from, dirs };
    }
    return null;
  }

  /** Flagi posrednie co 2 pola na nowej drodze (zwieksza przepustowosc). */
  private roadFlags(s: GameState, road: Command, cmds: Command[]): void {
    if (road.type !== 'road' || road.dirs.length < 4) return;
    let c = road.pos;
    for (let i = 0; i < road.dirs.length - 1; i++) {
      c = neighbor(s.map, c, road.dirs[i]);
      if ((i + 1) % 2 === 0 && i + 1 <= road.dirs.length - 2) cmds.push({ type: 'flag', player: this.player, pos: c });
    }
  }

  /** Proba postawienia budynku w najlepszym miejscu. */
  private tryBuild(s: GameState, need: Need, cmds: Command[]): boolean {
    const cands: [number, number][] = [];
    for (const pos of this.owned) {
      const until = this.failed.get(pos);
      if (until !== undefined && until > s.tick) continue;
      if (!canBuild(s, this.player, pos, need.kind)) continue;
      const sc = need.score(pos);
      if (need.min !== undefined && sc < need.min) continue;
      cands.push([sc, pos]);
    }
    if (cands.length === 0) return false;
    cands.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    for (const [, pos] of cands.slice(0, 8)) {
      const flagPos = neighbor(s.map, pos, DIR_SE);
      const cells = buildingCells(s.map, pos, BUILDINGS[need.kind].size);
      const flagConnected = s.map.obj[flagPos] === O.FLAG && s.flags[s.map.objId[flagPos]]!.roads.some((r) => r >= 0);
      if (flagConnected) {
        cmds.push({ type: 'build', player: this.player, pos, kind: need.kind });
        return true;
      }
      const road = this.roadTo(s, flagPos, cells);
      if (!road) {
        this.failed.set(pos, s.tick + 1500);
        continue;
      }
      cmds.push(road);
      cmds.push({ type: 'build', player: this.player, pos, kind: need.kind });
      this.roadFlags(s, road, cmds);
      this.failed.set(pos, s.tick + 300);
      return true;
    }
    return false;
  }

  // ---------- Naprawy ----------

  private siteSeen = new Map<number, number>();
  private siteProgress = new Map<number, number>();

  /**
   * Budynek wojskowy w glebi kraju, ktory mozna rozebrac bez szkody: kazde pole w jego zasiegu z wlasna
   * flaga, droga albo budynkiem pokrywa inny budynek wojskowy (albo zamek). Traci sie co najwyzej pusta
   * ziemie, a rycerz wraca do zamku i moze isc na front.
   */
  private demolishRedundantMilitary(s: GameState, cmds: Command[]): void {
    if (s.tick % (this.finishing ? 200 : 600) >= this.period || s.tick < 15000) return;
    const m = s.map;
    const own = this.player + 1;
    const mil = this.mine(s).filter((b) => b.stage === STAGE.DONE && (b.kind === B.CASTLE || (isMilitary(b.kind) && b.knights.length > 0)));
    if (mil.length <= 4) return;
    for (const b of mil) {
      if (b.kind === B.CASTLE || b.phase !== 0) continue; // tylko strefa "wnetrze"
      const r = BUILDINGS[b.kind].radius;
      let ok = true;
      for (const i of spiral(m.w, m.h, b.pos % m.w, (b.pos / m.w) | 0, r)) {
        if (m.owner[i] !== own) continue;
        const o = m.obj[i];
        const used = m.roads[i] !== 0 || o === O.FLAG || o === O.BUILDING || o === O.BUILDING_PART || (m.objId[i] === b.id);
        if (!used || m.objId[i] === b.id) continue;
        let covered = false;
        for (const other of mil) {
          if (other === b) continue;
          if (this.dist(s, i, other.pos) <= BUILDINGS[other.kind].radius) { covered = true; break; }
        }
        if (!covered) { ok = false; break; }
      }
      if (ok) {
        cmds.push({ type: 'demolish', player: this.player, pos: b.pos });
        return;
      }
    }
  }

  /** Plac budowy bez postepu przez dlugi czas przy braku materialu - rozbiorka. */
  private demolishStuckSites(s: GameState, cmds: Command[]): void {
    if (s.tick % 600 >= this.period) return;
    for (const b of this.mine(s)) {
      if (b.stage === STAGE.DONE) { this.siteSeen.delete(b.id); continue; }
      const key = b.id * 100000 + b.pos;
      const first = this.siteSeen.get(key);
      if (first === undefined) { this.siteSeen.set(key, s.tick); continue; }
      const def = BUILDINGS[b.kind];
      const lacking = (def.stones > b.stonesUsed + b.stones + b.stonesTransit && this.stock(s, G.STONE) === 0) ||
        (def.planks > b.planksUsed + b.planks + b.planksTransit && this.stock(s, G.PLANK) === 0);
      // Postep = wbudowany material; zmiana postepu przesuwa licznik czasu.
      const progress = b.planksUsed + b.stonesUsed + (b.stage === STAGE.LEVEL ? 0 : 1);
      const lastProg = this.siteProgress.get(key);
      if (lastProg !== progress) {
        this.siteProgress.set(key, progress);
        this.siteSeen.set(key, s.tick);
        continue;
      }
      if ((s.tick - first > 6000 && lacking) || s.tick - first > 6000 * (b.builder < 0 ? 1 : 2)) {
        cmds.push({ type: 'demolish', player: this.player, pos: b.pos });
        this.siteSeen.delete(key);
        return;
      }
    }
  }

  /** Wyczerpane kopalnie rozbieramy (zwalniaja gornika i miejsce). */
  private demolishExhausted(s: GameState, cmds: Command[]): boolean {
    for (const b of this.mine(s)) {
      if (b.kind >= B.COALMINE && b.kind <= B.STONEMINE && b.idleCycles >= 8) {
        cmds.push({ type: 'demolish', player: this.player, pos: b.pos });
        return true;
      }
    }
    return false;
  }

  /** Budynki odciete od magazynow: podlacz albo rozbierz (place budowy). */
  private fixDisconnected(s: GameState, cmds: Command[]): void {
    let fixed = 0;
    for (const b of this.mine(s)) {
      if (b.kind === B.CASTLE || fixed >= 2) continue;
      if (this.reachable(s, b.flag)) continue;
      const f = s.flags[b.flag];
      if (!f) continue;
      // Budynki wojskowe (czesto przejete) i magazyny lacze agresywniej.
      const mil = (isMilitary(b.kind) || !!b.inv) && b.stage === STAGE.DONE;
      const road = this.roadTo(s, f.pos, buildingCells(s.map, b.pos, BUILDINGS[b.kind].size), mil ? 28 : 16, mil ? 14 : 6);
      if (road) {
        cmds.push(road);
        this.roadFlags(s, road, cmds);
        fixed++;
      } else if (!mil) {
        cmds.push({ type: 'demolish', player: this.player, pos: b.pos });
        fixed++;
      }
    }
  }

  /** Zbieracze bez surowca w zasiegu (drwal bez drzew, kamieniarz bez skal) - rozbiorka. */
  private demolishIdleGatherers(s: GameState, cmds: Command[]): void {
    if (s.tick % 900 >= this.period) return;
    const m = s.map;
    for (const b of this.mine(s)) {
      if (b.stage !== STAGE.DONE) continue;
      if (b.kind === B.STONECUTTER && this.near(s, b.pos, 7, (i) => isStone(m.obj[i])) === 0) {
        cmds.push({ type: 'demolish', player: this.player, pos: b.pos });
        return;
      }
      if (b.kind === B.WOODCUTTER && this.near(s, b.pos, 6, (i) => m.obj[i] >= O.SAPLING1 && m.obj[i] <= O.TREE) === 0) {
        // Rozbieramy tylko, gdy stac nas na nowego drwala i nie jest ostatni.
        const cutters = this.mine(s).filter((x) => x.kind === B.WOODCUTTER).length;
        if (cutters > 1 || this.stock(s, G.PLANK) >= 4) {
          cmds.push({ type: 'demolish', player: this.player, pos: b.pos });
          return;
        }
      }
    }
  }

  // ---------- Ustawienia w trakcie gry ----------

  private adjustSettings(s: GameState, cmds: Command[]): void {
    // Wstrzymanie produkcji przy duzym zapasie (studnie, kamieniolomy, kopalnie granitu).
    if (s.tick % 300 < this.period) {
      const caps: [number, number, number][] = [[B.WELL, G.WATER, 30], [B.STONEMINE, G.STONE, 60], [B.CHARBURNER, G.COAL, 40]];
      for (const [kind, g, cap] of caps) {
        const st = this.stock(s, g);
        for (const b of this.mine(s)) {
          if (b.kind !== kind || b.stage !== STAGE.DONE) continue;
          const want = st > cap;
          if (b.paused !== want && (want || st < cap / 3)) cmds.push({ type: 'pause', player: this.player, pos: b.pos, on: want });
        }
      }
    }
    // Gdy brak desek - wstrzymaj dostawy desek dla stoczni.
    if (s.tick % 1000 < this.period) {
      const planks = this.stock(s, G.PLANK);
      cmds.push({ type: 'setting', player: this.player, key: 'plankShipyard', value: planks < 20 ? 0 : 2 });
    }
  }

  // ---------- Atak ----------

  private tryAttack(s: GameState, cmds: Command[]): boolean {
    const hard = this.level >= AI_HARD;
    const start = hard ? 9000 : 12000;
    if (s.tick < start || s.tick - this.lastAttack < (hard ? 200 : 600)) return false;
    const late = s.tick > 30000;
    const castle = this.castle(s);
    if (!castle) return false;
    const targets: [number, Building][] = [];
    for (const b of s.buildings) {
      if (!b || b.owner === this.player || !s.players[b.owner].alive) continue;
      if (!isAttackTarget(s, this.player, b)) continue;
      targets.push([this.dist(s, castle.pos, b.pos), b]);
    }
    // Najlepszy cel: najwiekszy stosunek mocy ataku do mocy obrony (zamek z premia).
    const factor = late ? 1.15 : hard ? 1.5 : 2.0;
    let best: Building | null = null;
    let bestScore = 0;
    let bestSend = 0;
    for (const [, t] of targets) {
      const avail = attackersAvailable(s, this.player, t);
      if (avail <= 0) continue;
      const morale = 1 + (s.players[this.player].morale - s.players[t.owner].morale) / 200;
      const defPower = defenderLevels(s, t).reduce((a, l) => a + POWER[l], 0);
      const levels = attackPreview(s, this.player, t, avail);
      // Najmniejsza liczba rycerzy dajaca przewage `factor`.
      let power = 0;
      let send = 0;
      for (const l of levels) {
        power += POWER[l] * morale;
        send++;
        if (power >= defPower * factor + 1) break;
      }
      if (power < defPower * factor + 1) continue;
      // Troche zapasu dla trudnego bota.
      if (hard) send = Math.min(avail, send + 1);
      const ec = s.buildings[s.players[t.owner].castle];
      const depth = ec ? Math.max(0, 40 - this.dist(s, t.pos, ec.pos)) / 20 : 0;
      const score = power / (defPower + 1) + depth + (t.kind === B.CASTLE ? 5 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = t;
        bestSend = send;
      }
    }
    if (!best) return false;
    cmds.push({ type: 'attack', player: this.player, pos: best.pos, count: bestSend });
    this.lastAttack = s.tick;
    return true;
  }

  // ---------- Rozbudowa ----------

  private build(s: GameState, cmds: Command[]): void {
    const hard = this.level >= AI_HARD;
    const bs = this.mine(s);
    const maxSites = hard ? 4 : 2;
    const sites = this.sites(bs);
    const planks = this.stock(s, G.PLANK);
    const stones = this.stock(s, G.STONE);
    if (sites >= maxSites) return;
    const m = s.map;
    const cnt = (k: number) => this.count(bs, k);
    const trees = (pos: number) => this.near(s, pos, 6, (i) => m.obj[i] === O.TREE);
    const stonesNear = (pos: number) => this.near(s, pos, 7, (i) => isStone(m.obj[i])) * 3;
    const fish = (pos: number) => this.near(s, pos, 6, (i) => m.terrain[i] === T.WATER && m.res[i] === RES.FISH && m.resAmt[i] > 0);
    const plantable = (pos: number, r: number) => this.near(s, pos, r, (i) => m.terrain[i] === T.GRASS && m.obj[i] === O.NONE && m.roads[i] === 0);
    const res = (r: number) => (pos: number) => {
      let n = 0;
      for (const i of spiral(m.w, m.h, pos % m.w, (pos / m.w) | 0, 2)) if (m.res[i] === r) n += m.resAmt[i];
      return n;
    };
    const central = (pos: number) => -this.nearestInvDist(s, pos);
    const minutes = Math.floor(s.tick / 600);
    const woodcutters = cnt(B.WOODCUTTER);
    const needs: Need[] = [];
    const hasCoalRes = this.owned.some((i) => m.res[i] === RES.COAL && m.terrain[i] === T.MOUNTAIN);
    const waterUsers = cnt(B.BAKERY) + cnt(B.PIGFARM) + cnt(B.BREWERY) + cnt(B.DONKEYBREEDER);
    // Kolejnosc = priorytet.
    needs.push({ kind: B.WOODCUTTER, want: 1, score: trees, min: 4 });
    needs.push({ kind: B.SAWMILL, want: 1, score: central });
    needs.push({ kind: B.STONECUTTER, want: 1, score: stonesNear, min: 6 });
    needs.push({ kind: B.WOODCUTTER, want: hard ? 3 : 2, score: trees, min: 4 });
    needs.push({ kind: B.SAWMILL, want: Math.max(1, Math.ceil(woodcutters / 2)), score: central });
    needs.push({ kind: B.FORESTER, want: Math.max(1, woodcutters - (hard ? 0 : 1)), score: (p) => plantable(p, 5) + (this.near(s, p, 6, (i) => m.obj[i] === O.BUILDING && s.buildings[m.objId[i]]?.kind === B.WOODCUTTER) > 0 ? 20 : 0), min: 8 });
    const militaryWanted = this.militaryWanted(s, bs);
    if (militaryWanted) needs.push(militaryWanted);
    if (minutes >= 3) {
      needs.push({ kind: B.FISHER, want: 1, score: fish, min: 4 });
      needs.push({ kind: B.HUNTER, want: 1, score: (p) => this.near(s, p, 8, (i) => m.obj[i] === O.TREE) + s.animals.filter((a) => a && this.dist(s, a.pos, p) <= 8).length * 5 });
    }
    if (minutes >= 4) {
      needs.push({ kind: B.TOOLMAKER, want: 1, score: central });
      needs.push({ kind: B.COALMINE, want: 1, score: res(RES.COAL), min: 8 });
      needs.push({ kind: B.IRONMINE, want: 1, score: res(RES.IRON), min: 8 });
      needs.push({ kind: B.FARM, want: 1, score: (p) => plantable(p, 3), min: 8 });
      needs.push({ kind: B.WELL, want: Math.max(1, waterUsers), score: central });
      needs.push({ kind: B.MILL, want: cnt(B.FARM) > 0 ? 1 : 0, score: central });
      needs.push({ kind: B.BAKERY, want: cnt(B.MILL) > 0 ? 1 : 0, score: central });
      needs.push({ kind: B.BREWERY, want: cnt(B.FARM) > 0 ? 1 : 0, score: central });
      needs.push({ kind: B.STEELWORKS, want: cnt(B.IRONMINE) > 0 || this.stock(s, G.IRON_ORE) > 0 ? 1 : 0, score: central });
      needs.push({ kind: B.WEAPONSMITH, want: hard || minutes >= 10 ? 1 : 0, score: central });
      needs.push({ kind: B.STONECUTTER, want: 2, score: stonesNear, min: 9 });
    }
    if (minutes >= 6 && stones < 12) {
      needs.push({ kind: B.STONEMINE, want: cnt(B.STONEMINE) + 1, score: res(RES.STONE), min: 6 });
    }
    if (minutes >= 7) {
      needs.push({ kind: B.FARM, want: hard ? 3 : 2, score: (p) => plantable(p, 3), min: 8 });
      needs.push({ kind: B.PIGFARM, want: 1, score: central });
      needs.push({ kind: B.BUTCHER, want: cnt(B.PIGFARM) > 0 ? 1 : 0, score: central });
      // Wegla potrzeba wiecej niz rudy (huta, zbrojownia, mennica): 2 kopalnie wegla na kopalnie zelaza.
      needs.push({ kind: B.COALMINE, want: Math.max(2, cnt(B.IRONMINE) * 2), score: res(RES.COAL), min: 8 });
      const coalShort = this.stock(s, G.COAL) < 4 && this.stock(s, G.IRON_ORE) > 8;
      needs.push({ kind: B.CHARBURNER, want: (!hasCoalRes || coalShort) && cnt(B.FARM) > 1 ? (coalShort ? 2 : 1) : 0, score: central });
      needs.push({ kind: B.GOLDMINE, want: hard ? 1 : 0, score: res(RES.GOLD), min: 6 });
      needs.push({ kind: B.MINT, want: cnt(B.GOLDMINE) > 0 ? 1 : 0, score: central });
      needs.push({ kind: B.FISHER, want: 2, score: fish, min: 4 });
      needs.push({ kind: B.WOODCUTTER, want: hard ? 4 : 3, score: trees, min: 4 });
    }
    if (minutes >= 12) {
      needs.push({ kind: B.WAREHOUSE, want: this.owned.length > 700 ? 1 : 0, score: (p) => this.nearestInvDist(s, p), min: 12 });
      needs.push({ kind: B.IRONMINE, want: 2, score: res(RES.IRON), min: 8 });
      needs.push({ kind: B.WEAPONSMITH, want: hard ? 2 : 1, score: central });
      needs.push({ kind: B.STEELWORKS, want: hard ? 2 : 1, score: central });
      needs.push({ kind: B.BREWERY, want: hard ? 2 : 1, score: central });
      needs.push({ kind: B.DONKEYBREEDER, want: hard && cnt(B.FARM) >= 3 ? 1 : 0, score: central });
      needs.push({ kind: B.FARM, want: hard ? 4 : 2, score: (p) => plantable(p, 3), min: 8 });
    }
    if (minutes >= 18 && hard) {
      this.refreshEnemyCells(s);
      if (this.enemyCells.length > 0) {
        needs.push({ kind: B.CATAPULT, want: 2, score: (p) => 40 - this.distToEnemy(s, p), min: 32 });
      }
    }
    // Budzet kamienia: przy malym zapasie tylko budynki kluczowe dla drewna, piwa i broni.
    const ESSENTIAL: number[] = [B.SAWMILL, B.BREWERY, B.STEELWORKS, B.WEAPONSMITH, B.STONEMINE, B.STONECUTTER];
    const WOOD_CHAIN: number[] = [B.WOODCUTTER, B.SAWMILL, B.FORESTER];
    const stoneReserve = hard ? 8 : 4;
    // Rezerwa desek: zawsze musi zostac na odbudowe lancucha drewna.
    const plankReserve = hard ? 6 : 4;
    for (const need of needs) {
      if (cnt(need.kind) >= need.want) continue;
      const def = BUILDINGS[need.kind];
      if (WOOD_CHAIN.includes(need.kind)) {
        if (planks < def.planks) continue;
      } else if (planks - def.planks < plankReserve) continue;
      if (stones < def.stones) continue;
      if (def.stones > 0 && stones - def.stones < stoneReserve && !ESSENTIAL.includes(need.kind) && !isMilitary(need.kind)) continue;
      if (this.canStaff(s, need.kind) && this.tryBuild(s, need, cmds)) return;
      // Budynek wojskowy: gdy nie ma miejsca na wybrany rodzaj, probujemy mniejszych.
      if (isMilitary(need.kind)) {
        const order: number[] = [B.FORTRESS, B.TOWER, B.GUARDHOUSE, B.GUARDHUT];
        for (const k of order.slice(order.indexOf(need.kind) + 1)) {
          if (stones < BUILDINGS[k].stones || planks < BUILDINGS[k].planks || !this.canStaff(s, k)) continue;
          if (this.tryBuild(s, { ...need, kind: k }, cmds)) return;
        }
      }
    }
  }

  /** Odleglosc (w krokach po ladzie) do najblizszego zamku wroga - omija gory i wode. */
  private castleField: Int32Array | null = null;
  private castleFieldTick = -1;

  private landDistToEnemyCastle(s: GameState, pos: number): number {
    if (!this.castleField || s.tick - this.castleFieldTick > 600) {
      this.castleFieldTick = s.tick;
      const m = s.map;
      const n = m.w * m.h;
      const field = new Int32Array(n).fill(1 << 20);
      const queue: number[] = [];
      for (const pl of s.players) {
        if (pl.id === this.player || !pl.alive) continue;
        const c = s.buildings[pl.castle];
        if (!c || c.stage !== STAGE.DONE) continue;
        field[c.pos] = 0;
        queue.push(c.pos);
      }
      for (let qi = 0; qi < queue.length; qi++) {
        const cur = queue[qi];
        for (let d = 0; d < 6; d++) {
          const j = neighbor(m, cur, d);
          if (j < 0 || field[j] <= field[cur] + 1) continue;
          const t = m.terrain[j];
          if (t === T.WATER || t === T.SNOW) continue;
          field[j] = field[cur] + 1;
          queue.push(j);
        }
      }
      this.castleField = field;
    }
    return this.castleField[pos];
  }

  /** Czy bot ma wyrazna przewage (tryb dobijania): >= 1,5x rycerzy najsilniejszego wroga, po 40 min. */
  private finishing = false;

  private updateFinishing(s: GameState, cmds: Command[]): void {
    if (s.tick % 600 >= this.period) return;
    const knights = (p: number) => {
      let n = 0;
      for (const b of s.buildings) {
        if (!b || b.owner !== p) continue;
        n += b.knights.length;
        if (b.inv) n += b.inv.knights.reduce((a, c) => a + c, 0);
      }
      return n;
    };
    const mine = knights(this.player);
    let strongest = 0;
    for (const pl of s.players) if (pl.id !== this.player && pl.alive) strongest = Math.max(strongest, knights(pl.id));
    const want = s.tick > 24000 && mine >= Math.max(6, strongest * 1.5);
    if (want !== this.finishing) {
      this.finishing = want;
      const p = this.player;
      cmds.push({ type: 'setting', player: p, key: 'knightsInterior', value: 1 });
      cmds.push({ type: 'setting', player: p, key: 'knightsBorder', value: want ? 1 : 2 });
      cmds.push({ type: 'setting', player: p, key: 'knightsEnemy', value: want ? 99 : this.level >= AI_HARD ? 8 : 4 });
    }
  }

  /** Pozycja najblizszego zywego zamku wroga albo -1. */
  private nearestEnemyCastlePos(s: GameState, from: number): number {
    let best = -1;
    let bd = 1 << 20;
    for (const pl of s.players) {
      if (pl.id === this.player || !pl.alive) continue;
      const c = s.buildings[pl.castle];
      if (!c || c.stage !== STAGE.DONE) continue;
      const d = this.dist(s, from, c.pos);
      if (d < bd) { bd = d; best = c.pos; }
    }
    return best;
  }

  /** Najblizsze pole wroga od pola `pos` (po prostej) albo -1; liczone rzadko, wynik w pamieci. */
  private enemyCells: number[] = [];
  private enemyCellsTick = -1;

  private refreshEnemyCells(s: GameState): void {
    if (s.tick - this.enemyCellsTick < 300) return;
    this.enemyCellsTick = s.tick;
    const own = this.player + 1;
    const o = s.map.owner;
    this.enemyCells = [];
    // Probkowanie co 3 pole wystarcza do kierunku ekspansji.
    for (let i = 0; i < o.length; i += 3) if (o[i] !== 0 && o[i] !== own) this.enemyCells.push(i);
  }

  private distToEnemy(s: GameState, pos: number): number {
    let d = 1 << 20;
    const w = s.map.w;
    const px = pos % w, py = (pos / w) | 0;
    for (const i of this.enemyCells) {
      const dd = hexDist(px, py, i % w, (i / w) | 0);
      if (dd < d) d = dd;
    }
    return d;
  }

  /** Budynek wojskowy do ekspansji (albo null, gdy nie teraz). */
  private militaryWanted(s: GameState, bs: Building[]): Need | null {
    const hard = this.level >= AI_HARD;
    let pending = 0;
    let total = 0;
    let front = false;
    for (const b of bs) {
      if (!isMilitary(b.kind)) continue;
      total++;
      if (b.stage !== STAGE.DONE || b.knights.length === 0) pending++;
      if (b.stage === STAGE.DONE && b.phase === 2) front = true;
    }
    const castle = this.castle(s);
    if (!castle) return null;
    const m = s.map;
    let knights = 0;
    for (const b of bs) if (b.inv) knights += b.inv.knights.reduce((a, c) => a + c, 0);
    const reserve = s.players[this.player].settings.castleKnights;
    const stoneStock = this.stock(s, G.STONE);
    const stoneSource = bs.some((b) => b.stage === STAGE.DONE && (b.kind === B.STONEMINE || (b.kind === B.STONECUTTER && this.near(s, b.pos, 7, (i) => isStone(m.obj[i])) > 0)));
    // Brak kamienia i zrodla: ekspansja po skaly moze uzyc ostatniego rycerza z zamku.
    const stoneEmergency = stoneStock < 6 && !stoneSource;
    if (knights <= (stoneEmergency ? 0 : reserve) && !this.finishing) return null;
    // Bez desek na budynek wojskowy (z zapasem na drwala) nie rozbudowujemy.
    if (this.stock(s, G.PLANK) < 2 + (hard ? 4 : 3)) return null;
    // Nadmiar rycerzy w zamku: budujemy wiecej (i wiekszych) budynkow wojskowych.
    const surplus = knights - reserve >= 6 || this.finishing;
    if (pending >= (surplus || stoneEmergency ? 3 : hard ? 2 : 1)) return null;
    if (s.tick - this.lastExpand < (surplus || stoneEmergency ? 200 : hard ? 300 : 700)) return null;
    const minutes = s.tick / 600;
    const aggressive = minutes > (hard ? 8 : 14);
    if (aggressive) this.refreshEnemyCells(s);
    // Kamien wolny = zapas minus to, czego jeszcze potrzebuja otwarte place budowy.
    let committed = 0;
    for (const b of bs) {
      if (b.stage === STAGE.DONE) continue;
      committed += Math.max(0, BUILDINGS[b.kind].stones - b.stonesUsed - b.stones - b.stonesTransit);
    }
    const planks = this.stock(s, G.PLANK);
    const stones = this.stock(s, G.STONE) - committed;
    const early = minutes < 15 && stones < 25;
    // Kamien jest cenny: bez zapasu stawiamy baraki (0 kamienia).
    let kind: number = stones >= 14 && total >= 2 ? B.GUARDHOUSE : B.GUARDHUT;
    if (!early && (front || surplus || (aggressive && this.enemyCells.length > 0))) {
      // Front: duze garnizony, zeby bylo z czego atakowac.
      if ((hard || surplus) && planks >= 8 && stones >= 16 && (surplus || this.rand(2) === 0)) kind = B.FORTRESS;
      else if (stones >= 10) kind = B.TOWER;
      else if (stones >= 6) kind = B.GUARDHOUSE;
    }
    const needStone = stones < 15 || stoneEmergency;
    const needWood = this.near(s, castle.pos, 12, (i) => m.obj[i] === O.TREE) < 15;
    this.lastExpand = s.tick;
    if (surplus) this.refreshEnemyCells(s);
    const toward = (aggressive || surplus) && this.enemyCells.length > 0;
    const enemyCastle = this.nearestEnemyCastlePos(s, castle.pos);
    return {
      kind,
      want: total + 1,
      score: (pos) => {
        const r = BUILDINGS[kind].radius;
        let sc = 0;
        for (const i of spiral(m.w, m.h, pos % m.w, (pos / m.w) | 0, r)) {
          if (m.owner[i] !== 0) continue;
          sc += m.terrain[i] === T.MOUNTAIN ? 3 : m.obj[i] === O.TREE ? 2 : m.terrain[i] === T.GRASS ? 1 : 0;
          if (needStone && isStone(m.obj[i])) sc += stoneEmergency ? 20 : 6;
          if (needStone && m.res[i] === RES.STONE) sc += 2;
          if (needWood && m.obj[i] === O.TREE) sc += 2;
        }
        if (toward) {
          // Natarcie: blizej granicy wroga i przede wszystkim blizej jego zamku.
          sc += Math.max(0, 80 - this.distToEnemy(s, pos)) * 2;
          if (enemyCastle >= 0) sc += Math.max(0, 200 - this.landDistToEnemyCastle(s, pos)) * 5;
        }
        return sc;
      },
      min: toward ? 0 : 6,
    };
  }
}
