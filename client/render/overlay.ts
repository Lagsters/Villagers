/**
 * Nakladki: podglad drogi (zielony/czerwony) i znaczniki miejsc budowy (flaga / maly / duzy / kopalnia).
 */
import * as THREE from 'three';
import { B } from '../../sim/defs.ts';
import type { GameState } from '../../sim/types.ts';
import { canBuild, canPlaceFlag } from '../../sim/world.ts';
import { H_SCALE, vx, vz } from './coords.ts';
import { InstancedLayer } from './instanced.ts';

export class OverlayRenderer {
  readonly group = new THREE.Group();
  private preview: THREE.Mesh;
  private markers: InstancedLayer;
  private markerMat: THREE.MeshBasicMaterial;
  enabledSites = false;
  private sitesTick = -1;

  constructor() {
    this.preview = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0x66ff66, transparent: true, opacity: 0.75, depthTest: false, side: THREE.DoubleSide }));
    this.preview.renderOrder = 5;
    this.preview.frustumCulled = false;
    this.group.add(this.preview);
    const g = new THREE.CylinderGeometry(0.1, 0.1, 0.02, 6);
    this.markerMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: true });
    this.markers = new InstancedLayer(this.group, g, this.markerMat, 256, true);
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
  updateSites(s: GameState, me: number, center: number, radius: number): void {
    if (!this.enabledSites) {
      if (this.markers.count > 0) { this.markers.begin(); this.markers.end(); }
      return;
    }
    if (s.tick === this.sitesTick) return;
    this.sitesTick = s.tick;
    const m = s.map;
    const cx = center % m.w, cy = (center / m.w) | 0;
    this.markers.begin();
    for (let y = Math.max(1, cy - radius); y < Math.min(m.h - 1, cy + radius); y++) {
      for (let x = Math.max(1, cx - radius); x < Math.min(m.w - 1, cx + radius); x++) {
        const i = y * m.w + x;
        if (m.owner[i] !== me + 1) continue;
        // Reprezentatywne rodzaje: duzy (farma), maly (drwal), kopalnia (wegiel).
        const size = canBuild(s, me, i, B.FARM) ? 2 : canBuild(s, me, i, B.WOODCUTTER) ? 1 : canBuild(s, me, i, B.COALMINE) ? 3 : 0;
        const flag = size === 0 && canPlaceFlag(s, me, i);
        if (!size && !flag) continue;
        const px = vx(x, y), pz = vz(y), py = m.height[i] * H_SCALE + 0.03;
        const sc = size === 2 ? 1.6 : size === 1 ? 1.15 : size === 3 ? 1.15 : 0.6;
        const k = this.markers.push(px, py, pz, 0, sc, 1);
        if (size === 2) this.markers.color(k, 0.25, 0.55, 1);
        else if (size === 1) this.markers.color(k, 0.35, 0.9, 0.35);
        else if (size === 3) this.markers.color(k, 0.75, 0.6, 0.45);
        else this.markers.color(k, 1, 0.9, 0.3);
      }
    }
    this.markers.end();
  }
}
