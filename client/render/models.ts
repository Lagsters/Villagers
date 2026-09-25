/**
 * Rejestr geometrii modeli. Kazdy model to BufferGeometry z kolorami wierzcholkow,
 * wiec wszystkie modele dziela jeden material. Na starcie sa proceduralne zastepniki;
 * loadModels() podmienia je na modele .glb wygenerowane skryptami Blendera.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type RGB = [number, number, number];

function colored(g: THREE.BufferGeometry, c: RGB): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const n = geo.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.deleteAttribute('uv');
  return geo;
}

function at(g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0): THREE.BufferGeometry {
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false)!;
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

const C = {
  trunk: [0.42, 0.28, 0.17] as RGB,
  pine: [0.16, 0.4, 0.24] as RGB,
  leaf: [0.3, 0.55, 0.22] as RGB,
  stone: [0.62, 0.6, 0.57] as RGB,
  stoneDark: [0.5, 0.48, 0.46] as RGB,
  wheat: [0.86, 0.72, 0.3] as RGB,
  wheatGreen: [0.5, 0.68, 0.3] as RGB,
  soil: [0.45, 0.33, 0.2] as RGB,
  wood: [0.6, 0.43, 0.26] as RGB,
  roof: [0.64, 0.25, 0.18] as RGB,
  wall: [0.88, 0.82, 0.7] as RGB,
  white: [0.95, 0.95, 0.95] as RGB,
  skin: [0.93, 0.76, 0.6] as RGB,
  dark: [0.25, 0.22, 0.2] as RGB,
};

const builders: Record<string, () => THREE.BufferGeometry> = {
  tree_pine: () => merge([
    colored(at(new THREE.CylinderGeometry(0.05, 0.07, 0.4, 5), 0, 0.2, 0), C.trunk),
    colored(at(new THREE.ConeGeometry(0.34, 0.7, 6), 0, 0.65, 0), C.pine),
    colored(at(new THREE.ConeGeometry(0.25, 0.55, 6), 0, 1.0, 0), C.pine),
  ]),
  tree_leaf: () => merge([
    colored(at(new THREE.CylinderGeometry(0.05, 0.08, 0.5, 5), 0, 0.25, 0), C.trunk),
    colored(at(new THREE.IcosahedronGeometry(0.36, 0), 0, 0.78, 0), C.leaf),
  ]),
  stump: () => merge([colored(at(new THREE.CylinderGeometry(0.07, 0.09, 0.12, 6), 0, 0.06, 0), C.trunk)]),
  stone: () => merge([
    colored(at(new THREE.DodecahedronGeometry(0.28, 0), 0, 0.14, 0), C.stone),
    colored(at(new THREE.DodecahedronGeometry(0.18, 0), 0.22, 0.08, 0.1), C.stoneDark),
  ]),
  field: () => merge([
    colored(at(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 6), 0, 0.02, 0), C.soil),
    ...[-0.2, 0, 0.2].map((x) => colored(at(new THREE.BoxGeometry(0.08, 0.3, 0.6), x, 0.15, 0), C.wheatGreen)),
  ]),
  field_ripe: () => merge([
    colored(at(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 6), 0, 0.02, 0), C.soil),
    ...[-0.2, 0, 0.2].map((x) => colored(at(new THREE.BoxGeometry(0.1, 0.36, 0.62), x, 0.18, 0), C.wheat)),
  ]),
  sign: () => merge([
    colored(at(new THREE.BoxGeometry(0.03, 0.4, 0.03), 0, 0.2, 0), C.wood),
    colored(at(new THREE.BoxGeometry(0.2, 0.14, 0.02), 0, 0.36, 0), C.white),
  ]),
  ruin: () => merge([
    colored(at(new THREE.BoxGeometry(0.5, 0.12, 0.5), 0, 0.06, 0), C.dark),
  ]),
};

const registry = new Map<string, THREE.BufferGeometry>();

export function getModel(name: string): THREE.BufferGeometry {
  let g = registry.get(name);
  if (!g) {
    const b = builders[name];
    if (!b) throw new Error(`Brak modelu ${name}`);
    g = b();
    registry.set(name, g);
  }
  return g;
}

export function registerBuilder(name: string, fn: () => THREE.BufferGeometry): void {
  builders[name] = fn;
}

export function setModel(name: string, g: THREE.BufferGeometry): void {
  registry.set(name, g);
}

export const MODEL_COLORS = C;
export { colored, at, merge };
