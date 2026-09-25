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

// ---------- Budynki, flagi, osadnicy, towary (zastepniki do czasu modeli z Blendera) ----------

function house(w: number, d: number, h: number, roof: RGB, wall: RGB = C.wall, roofH = 0.35): THREE.BufferGeometry[] {
  const r = new THREE.ConeGeometry(Math.max(w, d) * 0.78, roofH, 4);
  r.rotateY(Math.PI / 4);
  return [
    colored(at(new THREE.BoxGeometry(w, h, d), 0, h / 2, 0), wall),
    colored(at(r, 0, h + roofH / 2, 0), roof),
  ];
}

const ROOFS: RGB[] = [
  [0.64, 0.25, 0.18], [0.45, 0.3, 0.2], [0.3, 0.45, 0.25], [0.55, 0.5, 0.3], [0.35, 0.35, 0.5],
];

function smallBuilding(kind: number): THREE.BufferGeometry {
  const roof = ROOFS[kind % ROOFS.length];
  return merge(house(0.55, 0.5, 0.38, roof));
}

registerBuilder('building_castle', () => merge([
  colored(at(new THREE.BoxGeometry(1.3, 0.7, 1.1), -0.2, 0.35, -0.2), [0.78, 0.74, 0.68]),
  ...[[-0.8, -0.7], [0.4, -0.7], [-0.8, 0.3], [0.4, 0.3]].flatMap(([x, z]) => [
    colored(at(new THREE.CylinderGeometry(0.2, 0.22, 1.1, 6), x, 0.55, z), [0.72, 0.68, 0.62]),
    colored(at(new THREE.ConeGeometry(0.26, 0.4, 6), x, 1.3, z), [0.35, 0.35, 0.55]),
  ]),
  colored(at(new THREE.BoxGeometry(0.5, 0.9, 0.5), -0.2, 0.9, -0.2), [0.8, 0.76, 0.7]),
]));
registerBuilder('building_warehouse', () => merge([
  ...house(1.2, 0.9, 0.55, [0.45, 0.32, 0.2]).map((g) => g.translate(-0.25, 0, -0.25)),
]));
registerBuilder('building_large', () => merge(house(1.1, 0.9, 0.45, [0.64, 0.4, 0.18]).map((g) => g.translate(-0.25, 0, -0.25))));
registerBuilder('building_mine', () => merge([
  colored(at(new THREE.BoxGeometry(0.55, 0.3, 0.45), 0, 0.15, 0), [0.45, 0.38, 0.3]),
  colored(at(new THREE.BoxGeometry(0.3, 0.22, 0.05), 0, 0.11, 0.23), C.dark),
  colored(at(new THREE.BoxGeometry(0.6, 0.06, 0.5), 0, 0.33, 0), C.wood),
]));
registerBuilder('building_guardhut', () => merge([
  colored(at(new THREE.CylinderGeometry(0.25, 0.3, 0.6, 6), 0, 0.3, 0), [0.7, 0.66, 0.6]),
  colored(at(new THREE.ConeGeometry(0.34, 0.35, 6), 0, 0.78, 0), [0.4, 0.3, 0.2]),
]));
registerBuilder('building_tower', () => merge([
  colored(at(new THREE.CylinderGeometry(0.28, 0.34, 1.1, 6), 0, 0.55, 0), [0.72, 0.68, 0.62]),
  colored(at(new THREE.ConeGeometry(0.38, 0.45, 6), 0, 1.33, 0), [0.35, 0.35, 0.55]),
]));
registerBuilder('building_fortress', () => merge([
  colored(at(new THREE.BoxGeometry(1.1, 0.8, 0.9), -0.25, 0.4, -0.25), [0.72, 0.68, 0.62]),
  colored(at(new THREE.CylinderGeometry(0.3, 0.34, 1.4, 6), -0.25, 0.7, -0.25), [0.76, 0.72, 0.66]),
  colored(at(new THREE.ConeGeometry(0.4, 0.5, 6), -0.25, 1.65, -0.25), [0.35, 0.35, 0.55]),
]));
for (let k = 2; k <= 21; k++) {
  const kind = k;
  registerBuilder(`building_${kind}`, () => smallBuilding(kind));
}
registerBuilder('site', () => merge([
  colored(at(new THREE.BoxGeometry(0.6, 0.04, 0.55), 0, 0.02, 0), [0.62, 0.5, 0.35]),
  ...[[-0.25, -0.22], [0.25, -0.22], [-0.25, 0.22], [0.25, 0.22]].map(([x, z]) =>
    colored(at(new THREE.BoxGeometry(0.04, 0.45, 0.04), x, 0.22, z), C.wood)),
]));
registerBuilder('flag', () => merge([
  colored(at(new THREE.CylinderGeometry(0.015, 0.02, 0.55, 4), 0, 0.27, 0), C.wood),
]));
registerBuilder('flag_cloth', () => merge([
  colored(at(new THREE.BoxGeometry(0.2, 0.13, 0.01), 0.1, 0.46, 0), [1, 1, 1]),
]));
registerBuilder('serf_body', () => merge([
  colored(at(new THREE.CylinderGeometry(0.06, 0.08, 0.2, 5), 0, 0.2, 0), [1, 1, 1]),
  colored(at(new THREE.BoxGeometry(0.05, 0.12, 0.05), -0.035, 0.06, 0), [0.35, 0.28, 0.22]),
  colored(at(new THREE.BoxGeometry(0.05, 0.12, 0.05), 0.035, 0.06, 0), [0.35, 0.28, 0.22]),
]));
registerBuilder('serf_head', () => merge([
  colored(at(new THREE.IcosahedronGeometry(0.055, 0), 0, 0.36, 0), C.skin),
]));
registerBuilder('knight_head', () => merge([
  colored(at(new THREE.IcosahedronGeometry(0.06, 0), 0, 0.36, 0), [0.7, 0.72, 0.75]),
  colored(at(new THREE.ConeGeometry(0.06, 0.08, 5), 0, 0.43, 0), [0.7, 0.72, 0.75]),
]));
registerBuilder('good', () => merge([colored(new THREE.BoxGeometry(0.1, 0.08, 0.1), [1, 1, 1])]));
registerBuilder('fire', () => merge([
  colored(at(new THREE.ConeGeometry(0.2, 0.5, 5), 0, 0.5, 0), [1, 0.5, 0.1]),
  colored(at(new THREE.ConeGeometry(0.12, 0.35, 5), 0.1, 0.7, 0.05), [1, 0.85, 0.2]),
]));
registerBuilder('border', () => merge([
  colored(at(new THREE.CylinderGeometry(0.025, 0.035, 0.22, 4), 0, 0.11, 0), [1, 1, 1]),
]));
registerBuilder('animal', () => merge([
  colored(at(new THREE.BoxGeometry(0.1, 0.1, 0.24), 0, 0.17, 0), [0.6, 0.42, 0.25]),
  colored(at(new THREE.BoxGeometry(0.07, 0.08, 0.09), 0, 0.26, 0.13), [0.55, 0.38, 0.22]),
  ...[[-0.035, -0.08], [0.035, -0.08], [-0.035, 0.08], [0.035, 0.08]].map(([x, z]) =>
    colored(at(new THREE.BoxGeometry(0.025, 0.12, 0.025), x, 0.06, z), [0.4, 0.28, 0.18])),
]));
