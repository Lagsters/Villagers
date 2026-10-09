/**
 * Nakladki: podglad drogi (zielony/czerwony) i znaczniki miejsc budowy (flaga / maly / duzy / kopalnia).
 */
import * as THREE from 'three';
import { B } from '../../sim/defs.ts';
import type { GameState } from '../../sim/types.ts';
import { canBuild, canPlaceFlag } from '../../sim/world.ts';
import { H_SCALE, vx, vz } from './coords.ts';
import { InstancedLayer } from './instanced.ts';
import { getModel } from './models.ts';

export class OverlayRenderer {
  readonly group = new THREE.Group();
  private preview: THREE.Mesh;
  /** Ikony miejsc budowy (modele z Blendera): flaga, chata, dom, duzy budynek, kopalnia. */
  private markers: Record<'flag' | 'small' | 'medium' | 'large' | 'mine', InstancedLayer>;
  enabledSites = false;
  private sitesTick = -1;
  /** Zielone kropki na polach, na ktore mozna przedluzyc budowana droge. */
  private steps: InstancedLayer;

  constructor() {
    this.preview = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0x66ff66, transparent: true, opacity: 0.75, depthTest: false, side: THREE.DoubleSide }));
    this.preview.renderOrder = 5;
    this.preview.frustumCulled = false;
    this.group.add(this.preview);
    const dot = new THREE.CircleGeometry(0.07, 10);
    dot.rotateX(-Math.PI / 2);
    this.steps = new InstancedLayer(this.group, dot, new THREE.MeshBasicMaterial({ color: 0x7dff6a, depthTest: false }), 8);
    this.steps.mesh.renderOrder = 11; // nad kropkami kursora (te same wierzcholki)
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const layer = (name: string) => new InstancedLayer(this.group, getModel(name), mat, 128);
    this.markers = {
      flag: layer('mark_flag'), small: layer('mark_small'), medium: layer('mark_medium'),
      large: layer('mark_large'), mine: layer('mark_mine'),
    };
  }

  setPreview(s: GameState, cells: number[] | null, ok: boolean): void {
    const mat = this.preview.material as THREE.MeshBasicMaterial;
    mat.color.set(ok ? 0x66ff66 : 0xff5544);
    if (!cells || cells.length < 2) {
      this.preview.visible = false;
      return;
    }
    const m = s.map;
    const pos: number[] = [];
    const W = 0.09;
    for (let i = 0; i + 1 < cells.length; i++) {
      const a = cells[i], b = cells[i + 1];
      const ax = vx(a % m.w, (a / m.w) | 0), az = vz((a / m.w) | 0), ay = m.height[a] * H_SCALE + 0.07;
      const bx = vx(b % m.w, (b / m.w) | 0), bz = vz((b / m.w) | 0), by = m.height[b] * H_SCALE + 0.07;
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz) || 1;
      const nx = (-dz / len) * W, nz = (dx / len) * W;
      pos.push(ax + nx, ay, az + nz, ax - nx, ay, az - nz, bx + nx, by, bz + nz);
      pos.push(ax - nx, ay, az - nz, bx - nx, by, bz - nz, bx + nx, by, bz + nz);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.preview.geometry.dispose();
    this.preview.geometry = geo;
    this.preview.visible = true;
  }

  /** Znaczniki miejsc budowy na terytorium gracza w poblizu punktu (co kilka tickow). */
  setSteps(s: GameState, cells: number[]): void {
    const m = s.map;
    this.steps.begin();
    for (const i of cells) {
      const x = i % m.w, y = (i / m.w) | 0;
      this.steps.push(vx(x, y), m.height[i] * H_SCALE + 0.03, vz(y));
    }
    this.steps.end();
  }

  updateSites(s: GameState, me: number, center: number, radius: number): void {
    const layers = Object.values(this.markers);
    if (!this.enabledSites) {
      for (const l of layers) if (l.count > 0) { l.begin(); l.end(); }
      return;
    }
    if (s.tick === this.sitesTick) return;
    this.sitesTick = s.tick;
    const m = s.map;
    const cx = center % m.w, cy = (center / m.w) | 0;
    for (const l of layers) l.begin();
    for (let y = Math.max(1, cy - radius); y < Math.min(m.h - 1, cy + radius); y++) {
      for (let x = Math.max(1, cx - radius); x < Math.min(m.w - 1, cx + radius); x++) {
        const i = y * m.w + x;
        if (m.owner[i] !== me + 1) continue;
        // Reprezentatywne rodzaje: duzy (farma), dom (magazyn), chata (drwal), kopalnia (wegiel).
        const kind = canBuild(s, me, i, B.FARM) ? 'large' : canBuild(s, me, i, B.WAREHOUSE) ? 'medium'
          : canBuild(s, me, i, B.WOODCUTTER) ? 'small' : canBuild(s, me, i, B.COALMINE) ? 'mine'
            : canPlaceFlag(s, me, i) ? 'flag' : null;
        if (!kind) continue;
        // Ikona odwrocona jak budynki (drzwi ku fladze).
        this.markers[kind].push(vx(x, y), m.height[i] * H_SCALE + 0.01, vz(y), Math.PI / 6, kind === 'flag' ? 1.5 : 1.9);
      }
    }
    for (const l of layers) l.end();
  }
}
