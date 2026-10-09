/**
 * Pula warstw rekwizytow: warstwa instancji dla kazdego modelu tworzona przy pierwszym uzyciu.
 * Pusta warstwa nie generuje wywolania rysowania, wiec rekwizyty rzadko widoczne nic nie kosztuja.
 */
import type * as THREE from 'three';
import { InstancedLayer } from './instanced.ts';
import { getModel } from './models.ts';

export class PropPool {
  private layers = new Map<string, InstancedLayer>();
  private group: THREE.Object3D;
  private material: THREE.Material;
  private open = false;

  constructor(group: THREE.Object3D, material: THREE.Material) {
    this.group = group;
    this.material = material;
  }

  /** Warstwa modelu `name`; color = z kolorem instancji (np. kolor gracza, barwione czasteczki). */
  get(name: string, color = false): InstancedLayer {
    let l = this.layers.get(name);
    if (!l) {
      l = new InstancedLayer(this.group, getModel(name), this.material, 16, color);
      this.layers.set(name, l);
      if (this.open) l.begin();
    }
    return l;
  }

  /** Warstwa z kolorem instancji o podanej nazwie (osobna od warstwy bez koloru tego samego modelu). */
  colored(name: string): InstancedLayer {
    let l = this.layers.get(`${name}#c`);
    if (!l) {
      l = new InstancedLayer(this.group, getModel(name), this.material, 16, true);
      this.layers.set(`${name}#c`, l);
      if (this.open) l.begin();
    }
    return l;
  }

  begin(): void {
    this.open = true;
    for (const l of this.layers.values()) l.begin();
  }

  end(): void {
    this.open = false;
    for (const l of this.layers.values()) l.end();
  }
}
