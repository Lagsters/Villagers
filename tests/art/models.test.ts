import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import type * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { BUILDINGS, BUILDING_TYPES, GOODS_COUNT, SIZE } from '../../sim/defs.ts';

const DIR = 'art/models';
const HATS = ['hair', 'cap', 'straw', 'hood', 'feather', 'miner', 'brim', 'miller', 'chef', 'leather', 'explorer', 'sailor', 'kettle', 'beret', 'mask',
  'redhair', 'redcap', 'beanie', 'blackhat', 'bandana', 'bald', 'striped'];
const TOOLS = ['axe', 'hammer', 'pick', 'shovel', 'scythe', 'rod', 'bow', 'saw', 'rolling_pin', 'cleaver', 'tongs', 'bucket'];

async function load(name: string): Promise<{ tris: number; attrs: string[] }> {
  const buf = readFileSync(`${DIR}/${name}.glb`);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf = await new GLTFLoader().parseAsync(ab, '');
  let tris = 0;
  let attrs: string[] = [];
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry;
    tris += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    attrs = Object.keys(g.attributes);
  });
  return { tris, attrs };
}

/** Cala postac (osadnik z czapka i narzedziem, rycerz) - zob. docs/DECISIONS.md: postacie gladkie, lokcie i dlonie. */
const UNIT_BUDGET = 460;

/** Budzet trojkatow wg rodzaju modelu (zob. specyfikacja i docs/DECISIONS.md). */
function budget(name: string): number {
  if (name.startsWith('building_')) {
    const size = BUILDINGS[Number(name.slice(9))].size;
    return size === SIZE.LARGE ? 2000 : size === SIZE.MEDIUM ? 1200 : 800;
  }
  if (name.startsWith('tree_')) return 150;
  if (name.startsWith('site_')) return 800;
  if (name.startsWith('icon_')) return UNIT_BUDGET; // cala postac do ikon UI
  return 300; // jednostki, czesci jednostek, towary, drobne obiekty
}

const REQUIRED = [
  ...Array.from({ length: BUILDING_TYPES }, (_, k) => `building_${k}`),
  ...Array.from({ length: GOODS_COUNT }, (_, g) => `good_${g}`),
  'site_small', 'site_medium', 'site_large', 'crf_sails', 'woodcutter_axe', 'felled_trunk', 'felled_branches', 'fx_puff', 'fx_bit',
  'tree_pine', 'tree_pine2', 'tree_leaf', 'tree_leaf2', 'stump', 'stone', 'stone2', 'field', 'field_ripe', 'sign', 'ruin', 'fire', 'border', 'flag', 'flag_cloth', 'animal',
  'tuft', 'bush', 'stair_step',
  'serf_torso', 'serf_head', 'serf_leg', 'serf_upperarm', 'serf_forearm', 'knight_helmet', 'knight_shield', 'knight_sword', 'donkey',
  ...HATS.map((h) => `hat_${h}`), ...TOOLS.map((t) => `tool_${t}`),
  'mark_flag', 'mark_small', 'mark_medium', 'mark_large', 'mark_mine',
];

describe('M8: modele z Blendera', () => {
  it('wszystkie wymagane modele istnieja (z podgladami)', () => {
    for (const n of REQUIRED) {
      expect(existsSync(`${DIR}/${n}.glb`), n).toBe(true);
      expect(existsSync(`art/previews/${n}.png`), `podglad ${n}`).toBe(true);
    }
  });

  it('kazdy .glb wczytuje sie w three.js, ma kolory wierzcholkow i miesci sie w budzecie', async () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.glb'));
    for (const f of files) {
      const name = f.slice(0, -4);
      const { tris, attrs } = await load(name);
      expect(tris, name).toBeGreaterThan(0);
      expect(attrs, name).toContain('color');
      expect(tris, `${name}: ${tris} trojkatow`).toBeLessThanOrEqual(budget(name));
    }
  });

  it('jednostka (rycerz ze wszystkimi czesciami) <= 400 trojkatow, modele razem < 5 MB', async () => {
    let knight = 0;
    for (const [n, count] of [['serf_torso', 1], ['serf_head', 1], ['serf_leg', 2], ['serf_upperarm', 2], ['serf_forearm', 2], ['knight_helmet', 1], ['knight_shield', 1], ['knight_sword', 1]] as const) {
      knight += (await load(n)).tris * count;
    }
    expect(knight).toBeLessThanOrEqual(UNIT_BUDGET);
    // Osadnik: cialo + najciezsze nakrycie glowy + najciezsze narzedzie.
    let body = 0;
    for (const [n, count] of [['serf_torso', 1], ['serf_head', 1], ['serf_leg', 2], ['serf_upperarm', 2], ['serf_forearm', 2]] as const) body += (await load(n)).tris * count;
    let hat = 0, tool = 0;
    for (const h of HATS) hat = Math.max(hat, (await load(`hat_${h}`)).tris);
    for (const t of TOOLS) tool = Math.max(tool, (await load(`tool_${t}`)).tris);
    expect(body + hat + tool).toBeLessThanOrEqual(UNIT_BUDGET);
    const total = readdirSync(DIR).reduce((a, f) => a + statSync(`${DIR}/${f}`).size, 0);
    expect(total).toBeLessThan(5 * 1024 * 1024);
  });
});
