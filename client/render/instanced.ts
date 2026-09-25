/** InstancedMesh z automatycznym powiekszaniem pojemnosci i szybkim zapisem macierzy. */
import * as THREE from 'three';

export class InstancedLayer {
  mesh: THREE.InstancedMesh;
  private n = 0;
  private arr: Float32Array;
  private colorArr: Float32Array | null = null;

  private parent: THREE.Object3D;
  private geometry: THREE.BufferGeometry;
  private material: THREE.Material;
  private capacity: number;
  private withColor: boolean;

  constructor(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, capacity = 256, withColor = false) {
    this.parent = parent;
    this.geometry = geometry;
    this.material = material;
    this.capacity = capacity;
    this.withColor = withColor;
    this.mesh = this.create(capacity);
    this.arr = this.mesh.instanceMatrix.array as Float32Array;
  }

  private create(cap: number): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(this.geometry, this.material, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.count = 0;
    m.matrixAutoUpdate = false;
    if (this.withColor) {
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      this.colorArr = m.instanceColor.array as Float32Array;
    }
    this.parent.add(m);
    return m;
  }

  setGeometry(g: THREE.BufferGeometry): void {
    this.geometry = g;
    this.mesh.geometry = g;
  }

  begin(): void {
    this.n = 0;
  }

  private ensure(): void {
    if (this.n < this.capacity) return;
    const old = this.mesh;
    const oldArr = this.arr;
    const oldCol = this.colorArr;
    this.capacity *= 2;
    this.parent.remove(old);
    old.dispose();
    this.mesh = this.create(this.capacity);
    this.arr = this.mesh.instanceMatrix.array as Float32Array;
    this.arr.set(oldArr);
    if (oldCol && this.colorArr) this.colorArr.set(oldCol);
  }

  push(x: number, y: number, z: number, rotY = 0, s = 1, sy = s): number {
    this.ensure();
    const c = Math.cos(rotY) * s;
    const sn = Math.sin(rotY) * s;
    const o = this.n * 16;
    const a = this.arr;
    a[o] = c; a[o + 1] = 0; a[o + 2] = -sn; a[o + 3] = 0;
    a[o + 4] = 0; a[o + 5] = sy; a[o + 6] = 0; a[o + 7] = 0;
    a[o + 8] = sn; a[o + 9] = 0; a[o + 10] = c; a[o + 11] = 0;
    a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
    return this.n++;
  }

  /** Dowolna macierz (np. obrot wokol wielu osi). */
  pushMatrix(m: THREE.Matrix4): number {
    this.ensure();
    m.toArray(this.arr, this.n * 16);
    return this.n++;
  }

  color(i: number, r: number, g: number, b: number): void {
    if (!this.colorArr) return;
    this.colorArr[i * 3] = r;
    this.colorArr[i * 3 + 1] = g;
    this.colorArr[i * 3 + 2] = b;
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  get count(): number {
    return this.n;
  }
}
