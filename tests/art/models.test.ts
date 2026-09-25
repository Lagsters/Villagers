import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import type * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { BUILDINGS, BUILDING_TYPES, GOODS_COUNT, SIZE } from '../../sim/defs.ts';

const DIR = 'art/models';

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

/** Budzet trojkatow wg rodzaju modelu (zob. specyfikacja i docs/DECISIONS.md). */
function budget(name: string): number {
  if (name.startsWith('building_')) {
    const size = BUILDINGS[Number(name.slice(9))].size;
    return size === SIZE.LARGE ? 2000 : size === SIZE.MEDIUM ? 1200 : 800;
  }
  if (name.startsWith('tree_')) return 150;
  if (name.startsWith('site_')) return 800;
  return 300; // jednostki, czesci jednostek, towary, drobne obiekty
}

const REQUIRED = [
  ...Array.from({ length: BUILDING_TYPES }, (_, k) => `building_${k}`),
  ...Array.from({ length: GOODS_COUNT }, (_, g) => `good_${g}`),
  'site_small', 'site_medium', 'site_large', 'mill_sails',
  'tree_pine', 'tree_leaf', 'stump', 'stone', 'field', 'field_ripe', 'sign', 'ruin', 'fire', 'border', 'flag', 'flag_cloth', 'animal',
  'serf_torso', 'serf_head', 'serf_leg', 'serf_arm', 'knight_helmet', 'knight_shield', 'knight_sword', 'donkey',
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

  it('jednostka (rycerz ze wszystkimi czesciami) <= 300 trojkatow, modele razem < 5 MB', async () => {
    let knight = 0;
    for (const [n, count] of [['serf_torso', 1], ['serf_head', 1], ['serf_leg', 2], ['serf_arm', 2], ['knight_helmet', 1], ['knight_shield', 1], ['knight_sword', 1]] as const) {
      knight += (await load(n)).tris * count;
    }
    expect(knight).toBeLessThanOrEqual(300);
    const total = readdirSync(DIR).reduce((a, f) => a + statSync(`${DIR}/${f}`).size, 0);
    expect(total).toBeLessThan(5 * 1024 * 1024);
  });
});
