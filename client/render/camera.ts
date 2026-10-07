/**
 * Kamera ortograficzna nad mapa: przesuwanie, zoom, swobodny obrot wokol pionu i pochylenie
 * (z plynnym dochodzeniem do celu).
 */
import * as THREE from 'three';

const PITCH_DEFAULT = THREE.MathUtils.degToRad(38);
const PITCH_MIN = THREE.MathUtils.degToRad(22);
const PITCH_MAX = THREE.MathUtils.degToRad(80);
const DIST = 80;

export class CameraController {
  readonly camera: THREE.OrthographicCamera;
  target = new THREE.Vector3();
  /** Docelowe i biezace (animowane) katy: obrot wokol pionu i pochylenie nad horyzontem. */
  private yawGoal = 0;
  private yaw = 0;
  private pitchGoal = PITCH_DEFAULT;
  private pitch = PITCH_DEFAULT;
  zoom = 1;
  private aspect = 1;
  bounds = { minX: 0, maxX: 100, minZ: 0, maxZ: 100 };
  moved = true;
  /** Polowa wysokosci widoku w jednostkach swiata przy zoom = 1. */
  viewHalf = 12;

  constructor() {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);
  }

  resize(w: number, h: number): void {
    this.aspect = w / Math.max(1, h);
    this.moved = true;
  }

  /** Obrot o wielokrotnosc 60 stopni (klawisze), z animacja. */
  rotate(steps: number): void {
    this.yawGoal += steps * (Math.PI / 3);
    this.moved = true;
  }

  /** Natychmiastowy obrot o kat w radianach (przeciaganie, gest dwoma palcami). */
  rotateBy(rad: number): void {
    this.yawGoal += rad;
    this.yaw = this.yawGoal;
    this.moved = true;
  }

  /** Pochylenie o kat w radianach; animate = plynnie (klawisze), inaczej natychmiast (mysz). */
  tiltBy(rad: number, animate = false): void {
    this.pitchGoal = THREE.MathUtils.clamp(this.pitchGoal + rad, PITCH_MIN, PITCH_MAX);
    if (!animate) this.pitch = this.pitchGoal;
    this.moved = true;
  }

  /** Domyslny kat widoku (obrot do najblizszej polnocy, pochylenie startowe). */
  resetView(): void {
    this.yawGoal = Math.round(this.yawGoal / (Math.PI * 2)) * Math.PI * 2;
    this.pitchGoal = PITCH_DEFAULT;
    this.moved = true;
  }

  zoomBy(factor: number): void {
    this.zoom = THREE.MathUtils.clamp(this.zoom * factor, 0.35, 3.2);
    this.moved = true;
  }

  /** Przesuniecie w pikselach ekranu (przeciaganie). */
  panPixels(dx: number, dy: number, viewportH: number): void {
    const worldPerPx = (2 * this.viewHalf) / this.zoom / viewportH;
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    // Pionowy ruch myszy na ekranie odpowiada ruchowi po skosie terenu.
    this.target.addScaledVector(right, -dx * worldPerPx);
    this.target.addScaledVector(fwd, (dy * worldPerPx) / Math.sin(this.pitch));
    this.clampTarget();
    this.moved = true;
  }

  panWorld(dx: number, dz: number): void {
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.target.addScaledVector(right, dx / this.zoom);
    this.target.addScaledVector(fwd, dz / this.zoom);
    this.clampTarget();
    this.moved = true;
  }

  lookAt(x: number, z: number): void {
    this.target.set(x, this.target.y, z);
    this.clampTarget();
    this.moved = true;
  }

  private clampTarget(): void {
    const b = this.bounds;
    this.target.x = THREE.MathUtils.clamp(this.target.x, b.minX, b.maxX);
    this.target.z = THREE.MathUtils.clamp(this.target.z, b.minZ, b.maxZ);
  }

  /** Zwraca true, jesli kamera sie zmienila w tej klatce. */
  update(dt: number): boolean {
    const k = Math.min(1, dt * 10);
    if (Math.abs(this.yawGoal - this.yaw) > 1e-4) {
      this.yaw += (this.yawGoal - this.yaw) * k;
      if (Math.abs(this.yawGoal - this.yaw) < 1e-3) this.yaw = this.yawGoal;
      this.moved = true;
    }
    if (Math.abs(this.pitchGoal - this.pitch) > 1e-4) {
      this.pitch += (this.pitchGoal - this.pitch) * k;
      if (Math.abs(this.pitchGoal - this.pitch) < 1e-3) this.pitch = this.pitchGoal;
      this.moved = true;
    }
    if (!this.moved) return false;
    const half = this.viewHalf / this.zoom;
    const c = this.camera;
    c.left = -half * this.aspect;
    c.right = half * this.aspect;
    c.top = half;
    c.bottom = -half;
    const off = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    ).multiplyScalar(DIST);
    c.position.copy(this.target).add(off);
    c.up.set(0, 1, 0);
    c.lookAt(this.target);
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
    this.moved = false;
    return true;
  }
}
