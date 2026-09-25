/**
 * Towary: rozliczanie towarow w drodze do budynkow, wybor celu, umieszczanie na flagach
 * i wyznaczanie kierunku na kazdej fladze.
 */
import { BUILDINGS, B, G, isFood, isMilitary, isMine } from './defs.ts';
import { UNREACHABLE, routeTo } from './routing.ts';
import { DIR_INTO, FLAG_SLOTS, STAGE, type Building, type Flag, type GameState } from './types.ts';

export const INPUT_CAP = 4;
/** Maksymalna premia za oczekiwanie przy wyborze odbiorcy (mniej niz roznica 4 w wadze). */
const WAIT_BONUS_CAP = 240;

/** Indeks slotu wejscia budynku dla towaru albo -1. Kopalnie: slot 0 = dowolne jedzenie. */
export function inputSlot(b: Building, g: number): number {
  if (isMine(b.kind)) return isFood(g) ? 0 : -1;
  return BUILDINGS[b.kind].inputs.indexOf(g);
}

/** Ile sztuk towaru budynek jeszcze chce (z uwzglednieniem towarow w drodze). */
export function demand(b: Building, g: number): number {
  if (b.stage === STAGE.BURN) return 0;
  const def = BUILDINGS[b.kind];
  if (b.stage === STAGE.LEVEL || b.stage === STAGE.BUILD) {
    if (g === G.PLANK) return def.planks - b.planksUsed - b.planks - b.planksTransit;
    if (g === G.STONE) return def.stones - b.stonesUsed - b.stones - b.stonesTransit;
    return 0;
  }
  if (isMilitary(b.kind) && g === G.GOLD) return def.gold - b.gold - b.goldTransit;
  const slot = inputSlot(b, g);
  if (slot < 0) return 0;
  return INPUT_CAP - b.stock[slot] - b.transit[slot];
}

/** Zmienia licznik towarow w drodze do budynku. */
export function addTransit(b: Building, g: number, delta: number): void {
  if (b.stage === STAGE.LEVEL || b.stage === STAGE.BUILD) {
    if (g === G.PLANK) b.planksTransit = Math.max(0, b.planksTransit + delta);
    else if (g === G.STONE) b.stonesTransit = Math.max(0, b.stonesTransit + delta);
    return;
  }
  if (isMilitary(b.kind) && g === G.GOLD) {
    b.goldTransit = Math.max(0, b.goldTransit + delta);
    return;
  }
  const slot = inputSlot(b, g);
  if (slot >= 0) b.transit[slot] = Math.max(0, b.transit[slot] + delta);
}

/** Towar przestal byc w drodze (zgubiony albo przekierowany). */
export function cancelTransit(s: GameState, dest: number, g: number): void {
  if (dest < 0) return;
  const b = s.buildings[dest];
  if (!b || b.inv) return;
  addTransit(b, g, -1);
}

/** Dostarczenie towaru do budynku. */
export function deliverGood(s: GameState, b: Building, g: number): void {
  if (b.stage === STAGE.BURN) return;
  if (b.inv) {
    b.inv.goods[g]++;
    return;
  }
  addTransit(b, g, -1);
  if (b.stage === STAGE.LEVEL || b.stage === STAGE.BUILD) {
    if (g === G.PLANK) b.planks++;
    else if (g === G.STONE) b.stones++;
    return;
  }
  if (isMilitary(b.kind) && g === G.GOLD) {
    b.gold++;
    return;
  }
  const slot = inputSlot(b, g);
  if (slot >= 0) b.stock[slot]++;
  // Inne towary (np. po zmianie celu) przepadaja - nie powinno sie zdarzac.
  void s;
}

/** Waga rozdzialu towaru do budynku wg ustawien gracza (0 = nie dostarczaj). */
export function distWeight(s: GameState, b: Building, g: number): number {
  const st = s.players[b.owner].settings;
  if (b.stage === STAGE.LEVEL || b.stage === STAGE.BUILD) {
    return g === G.PLANK ? st.plankConstruction : 8;
  }
  switch (b.kind) {
    case B.COALMINE: return st.foodCoal;
    case B.IRONMINE: return st.foodIron;
    case B.GOLDMINE: return st.foodGold;
    case B.STONEMINE: return st.foodStone;
    case B.SHIPYARD: return st.plankShipyard;
    case B.TOOLMAKER: return g === G.PLANK ? st.plankToolmaker : st.steelToolmaker;
    case B.WEAPONSMITH: return g === G.STEEL ? st.steelWeaponsmith : st.coalWeapons;
    case B.STEELWORKS: return g === G.COAL ? st.coalSteel : 8;
    case B.MINT: return g === G.COAL ? st.coalGold : 8;
    case B.MILL: return st.wheatMill;
    case B.PIGFARM: return g === G.WATER ? st.waterPig : st.wheatPig;
    case B.BAKERY: return g === G.WATER ? st.waterBakery : 8;
    case B.BREWERY: return g === G.WATER ? st.waterBrewery : st.wheatBrewery;
    case B.DONKEYBREEDER: return g === G.WATER ? st.waterDonkey : st.wheatDonkey;
    case B.CHARBURNER: return g === G.WHEAT ? st.wheatCharburner : 8;
    default: return 8;
  }
}

/** Czy budynek moze przyjmowac towary (stoi i jest podlaczony flaga). */
export function acceptsGoods(b: Building): boolean {
  return b.stage !== STAGE.BURN;
}

/**
 * Najlepszy cel dla towaru lezacego na fladze `flagId`: budynek z popytem
 * (waga*64 - odleglosc), inaczej najblizszy magazyn. -1 gdy nic osiagalnego.
 */
export function chooseDestination(s: GameState, p: number, flagId: number, g: number, allowConsumers = true): number {
  let best = -1;
  let bestScore = -UNREACHABLE;
  if (allowConsumers) {
    for (const b of s.buildings) {
      if (!b || b.owner !== p) continue;
      if (b.inv || !acceptsGoods(b) || b.paused) continue;
      if (demand(b, g) <= 0) continue;
      const w = distWeight(s, b, g);
      if (w <= 0) continue;
      const d = routeTo(s, p, b.flag, false).dist[flagId];
      if (d >= UNREACHABLE) continue;
      // Premia za czas od ostatniej dostawy: przy rownych wagach odbiorcy dostaja na zmiane.
      const wait = Math.min(WAIT_BONUS_CAP, (s.tick - b.served) >> 1);
      const score = w * 64 - d + wait;
      if (score > bestScore) {
        bestScore = score;
        best = b.id;
      }
    }
    if (best >= 0) {
      s.buildings[best]!.served = s.tick;
      return best;
    }
  }
  return nearestInventory(s, p, flagId, false);
}

export function nearestInventory(s: GameState, p: number, flagId: number, walkers: boolean): number {
  let best = -1;
  let bestD = UNREACHABLE;
  for (const b of s.buildings) {
    if (!b || b.owner !== p || !b.inv || b.stage !== STAGE.DONE) continue;
    const d = b.flag === flagId ? 0 : routeTo(s, p, b.flag, walkers).dist[flagId];
    if (d < bestD) {
      bestD = d;
      best = b.id;
    }
  }
  return best;
}

export function freeSlot(f: Flag): number {
  for (let i = 0; i < FLAG_SLOTS; i++) if (f.slotGood[i] < 0) return i;
  return -1;
}

export function flagGoodsCount(f: Flag): number {
  let n = 0;
  for (let i = 0; i < FLAG_SLOTS; i++) if (f.slotGood[i] >= 0) n++;
  return n;
}

/** Kierunek wyjscia z flagi dla towaru o celu `dest` (DIR_INTO gdy cel stoi przy tej fladze). */
export function goodDir(s: GameState, f: Flag, dest: number): number {
  if (dest < 0) return -1;
  const b = s.buildings[dest];
  if (!b || b.stage === STAGE.BURN || b.owner !== f.owner) return -1;
  if (b.flag === f.id) return DIR_INTO;
  const t = routeTo(s, f.owner, b.flag, false);
  return t.dist[f.id] >= UNREACHABLE ? -1 : t.dir[f.id];
}

/**
 * Kladzie towar na fladze. Zwraca false, gdy flaga jest pelna.
 * Towar dla budynku przy tej fladze trafia do niego od razu.
 */
export function putGood(s: GameState, f: Flag, g: number, dest: number): boolean {
  if (dest >= 0) {
    const b = s.buildings[dest];
    if (b && b.flag === f.id) {
      deliverGood(s, b, g);
      return true;
    }
  }
  const slot = freeSlot(f);
  if (slot < 0) return false;
  f.slotGood[slot] = g;
  f.slotDest[slot] = dest;
  f.slotDir[slot] = goodDir(s, f, dest);
  f.slotClaim[slot] = -1;
  f.slotTime[slot] = s.tick;
  return true;
}

/** Ponownie wyznacza cele/kierunki niezajetych towarow na flagach gracza (po zmianie sieci). */
export function rerouteFlags(s: GameState, p: number): void {
  for (const f of s.flags) {
    if (!f || f.owner !== p) continue;
    for (let i = 0; i < FLAG_SLOTS; i++) {
      const g = f.slotGood[i];
      if (g < 0 || f.slotClaim[i] >= 0) continue;
      rerouteSlot(s, f, i);
    }
  }
}

export function rerouteSlot(s: GameState, f: Flag, i: number): void {
  const g = f.slotGood[i];
  let dest = f.slotDest[i];
  let dir = goodDir(s, f, dest);
  if (dir < 0) {
    // Cel nieosiagalny albo zniknal: nowy cel.
    cancelTransit(s, dest, g);
    dest = chooseDestination(s, f.owner, f.id, g);
    if (dest >= 0) {
      const b = s.buildings[dest]!;
      if (!b.inv) addTransit(b, g, 1);
    }
    dir = goodDir(s, f, dest);
  }
  if (dir === DIR_INTO && dest >= 0) {
    // Cel stoi przy tej fladze: dostarczamy od razu.
    const b = s.buildings[dest]!;
    deliverGood(s, b, g); // odejmuje tez licznik w drodze
    f.slotGood[i] = -1;
    f.slotDest[i] = -1;
    f.slotDir[i] = -1;
    return;
  }
  f.slotDest[i] = dest;
  f.slotDir[i] = dir;
}

/** Usuwa wszystkie towary z flagi (np. przy jej rozbiorce), anulujac zamowienia. */
export function clearFlagGoods(s: GameState, f: Flag): void {
  for (let i = 0; i < FLAG_SLOTS; i++) {
    if (f.slotGood[i] >= 0) cancelTransit(s, f.slotDest[i], f.slotGood[i]);
    f.slotGood[i] = -1;
    f.slotDest[i] = -1;
    f.slotDir[i] = -1;
    f.slotClaim[i] = -1;
  }
}
