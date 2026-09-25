/** Ustawienia gospodarki gracza: wartosci domyslne i walidacja zmian. */
import { G, GOODS_COUNT, TOOLS_COUNT } from './defs.ts';
import type { GameState, Settings } from './types.ts';

/** Domyslna kolejnosc transportu (od najwazniejszego). */
const DEFAULT_ORDER = [
  G.PLANK, G.STONE, G.SWORD, G.SHIELD, G.BEER, G.SHOVEL, G.HAMMER, G.AXE, G.SAW, G.PICK, G.SCYTHE, G.ROD,
  G.CLEAVER, G.PINCER, G.BOW, G.CRUCIBLE, G.ROLLING_PIN, G.COAL, G.IRON_ORE, G.STEEL, G.GOLD_ORE, G.GOLD,
  G.LUMBER, G.FISH, G.BREAD, G.MEAT, G.WHEAT, G.WATER, G.FLOUR, G.PIG, G.BOAT,
];

export function defaultSettings(): Settings {
  const transportPrio = new Array(GOODS_COUNT).fill(0);
  DEFAULT_ORDER.forEach((g, i) => { transportPrio[g] = GOODS_COUNT - i; });
  return {
    transportPrio,
    foodCoal: 7, foodIron: 8, foodGold: 5, foodStone: 4,
    plankConstruction: 8, plankShipyard: 2, plankToolmaker: 6,
    steelToolmaker: 6, steelWeaponsmith: 6,
    coalSteel: 7, coalGold: 5, coalWeapons: 6,
    wheatMill: 6, wheatPig: 4, wheatBrewery: 5, wheatDonkey: 2, wheatCharburner: 1,
    waterBakery: 6, waterPig: 4, waterBrewery: 5, waterDonkey: 2,
    toolPrio: new Array(TOOLS_COUNT).fill(4),
    knightsInterior: 1, knightsBorder: 2, knightsEnemy: 99,
    castleKnights: 2,
    serfReserve: 4,
  };
}

const SLIDERS: (keyof Settings)[] = [
  'foodCoal', 'foodIron', 'foodGold', 'foodStone', 'plankConstruction', 'plankShipyard', 'plankToolmaker',
  'steelToolmaker', 'steelWeaponsmith', 'coalSteel', 'coalGold', 'coalWeapons', 'wheatMill', 'wheatPig',
  'wheatBrewery', 'wheatDonkey', 'wheatCharburner', 'waterBakery', 'waterPig', 'waterBrewery', 'waterDonkey',
];

export function applySetting(s: GameState, p: number, key: keyof Settings, value: number | number[]): void {
  const st = s.players[p].settings;
  const int = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
  if (SLIDERS.includes(key)) {
    if (int(value, 0, 8)) (st as unknown as Record<string, number>)[key] = value as number;
    return;
  }
  switch (key) {
    case 'transportPrio':
      if (Array.isArray(value) && value.length === GOODS_COUNT && value.every((v) => int(v, 0, 99))) st.transportPrio = value.slice();
      return;
    case 'toolPrio':
      if (Array.isArray(value) && value.length === TOOLS_COUNT && value.every((v) => int(v, 0, 8))) st.toolPrio = value.slice();
      return;
    case 'knightsInterior':
    case 'knightsBorder':
    case 'knightsEnemy':
      if (int(value, 0, 99)) st[key] = value as number;
      return;
    case 'castleKnights':
    case 'serfReserve':
      if (int(value, 0, 50)) st[key] = value as number;
      return;
  }
}
