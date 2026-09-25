/**
 * Kamera izometryczna (ortograficzna): przesuwanie, zoom, obrot o 60 stopni z plynnym przejsciem.
 */
import * as THREE from 'three';

const PITCH = THREE.MathUtils.degToRad(44);
const DIST = 80;

export class CameraController {
  readonly camera: THREE.OrthographicCamera;
  target = new THREE.Vector3();
  /** Docelowy kat obrotu (wielokrotnosc 60 stopni) i biezacy (animowany). */
  yawSteps = 0;
  private yaw = 0;
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

  rotate(steps: number): void {
    this.yawSteps += steps;
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
    this.target.addScaledVector(fwd, (dy * worldPerPx) / Math.sin(PITCH));
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
    const goal = this.yawSteps * (Math.PI / 3);
    if (Math.abs(goal - this.yaw) > 1e-4) {
      this.yaw += (goal - this.yaw) * Math.min(1, dt * 10);
      if (Math.abs(goal - this.yaw) < 1e-3) this.yaw = goal;
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
      Math.sin(this.yaw) * Math.cos(PITCH),
      Math.sin(PITCH),
      Math.cos(this.yaw) * Math.cos(PITCH),
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
