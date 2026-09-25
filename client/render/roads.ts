/**
 * Drogi jako plaskie wstegi tuz nad terenem. Jedna siatka dla calej mapy, przebudowywana
 * po zmianie sieci (rzadkie zdarzenie). Drogi wodne rysujemy jasniejsza linia.
 */
import * as THREE from 'three';
import type { GameState } from '../../sim/types.ts';
import { H_SCALE, vx, vz } from './coords.ts';

const WIDTH = 0.075;
const LIFT = 0.04;

export class RoadsRenderer {
  readonly mesh: THREE.Mesh;
  private sig = '';

  constructor() {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** Przebudowa, jesli zmienil sie zestaw drog. */
  sync(s: GameState): void {
    let sig = '';
    for (const r of s.roads) if (r) sig += r.id + ':' + r.a + ':' + r.b + ',';
    if (sig === this.sig) return;
    this.sig = sig;
    this.rebuild(s);
  }

  /** Wymus przebudowe (np. po zmianie wysokosci terenu). */
  invalidate(): void {
    this.sig = '';
  }

  private rebuild(s: GameState): void {
    const map = s.map;
    const pos: number[] = [];
    const col: number[] = [];
    const p = (i: number) => {
      const x = i % map.w, y = (i / map.w) | 0;
      return [vx(x, y), map.height[i] * H_SCALE + LIFT, vz(y)] as const;
    };
    for (const r of s.roads) {
      if (!r) continue;
      const c = r.water ? [0.75, 0.85, 0.95] : [0.62, 0.47, 0.28];
      for (let i = 0; i + 1 < r.cells.length; i++) {
        const a = p(r.cells[i]);
        const b = p(r.cells[i + 1]);
        const dx = b[0] - a[0], dz = b[2] - a[2];
        const len = Math.hypot(dx, dz) || 1;
        const nx = (-dz / len) * WIDTH, nz = (dx / len) * WIDTH;
        const v = [
          [a[0] + nx, a[1], a[2] + nz], [a[0] - nx, a[1], a[2] - nz],
          [b[0] + nx, b[1], b[2] + nz], [b[0] - nx, b[1], b[2] - nz],
        ];
        // Dwa trojkaty zwrocone do gory.
        for (const k of [0, 2, 1, 1, 2, 3]) {
          pos.push(v[k][0], v[k][1], v[k][2]);
          col.push(c[0], c[1], c[2]);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    // Normalne w gore (wstega jest prawie plaska) - unika ciemnych pasow na zboczach.
    const n = g.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
  }
}
