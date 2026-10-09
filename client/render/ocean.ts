/**
 * Morze wokol mapy i niebo: przy krzywiznie swiata (client/render/curve.ts) daleka woda opada za horyzont, a nad nia
 * widac niebo. Morze to duza siatka (gesta przy srodku, bo krzywizna liczy sie w wierzcholkach) podazajaca za srodkiem
 * widoku, tuz pod lustrem wody mapy - teren ja zaslania, widac ja dopiero za brzegiem mapy. Material bez oswietlenia
 * w kolorze oswietlonej glebi (DEEP_WATER), ku horyzontowi jasnieje mgielka. Przy kamerze z gory morze zakrywa caly
 * ekran, niebo pojawia sie przy mocno pochylonej.
 */
import * as THREE from 'three';
import { SEA_HEIGHT } from '../../sim/mapgen.ts';
import { H_SCALE } from './coords.ts';
import { CURVE_COMMON, CURVE_PROJECT, EARTH_R, curveUniform } from './curve.ts';

/** Promien siatki morza (swiat) - daleko za horyzontem przy najnizszej kamerze. */
const SIZE = 400;
/** Kolor oswietlonej glebi (brzeg terenu mapy zlewa sie z morzem) i mgielki na horyzoncie (liniowo). */
const DEEP = new THREE.Color().setRGB(17 / 255, 51 / 255, 95 / 255, THREE.LinearSRGBColorSpace);
const HAZE = new THREE.Color().setRGB(0.42, 0.56, 0.68, THREE.LinearSRGBColorSpace);

/** Niebo: pionowy gradient (u gory blekit, przy horyzoncie mgielka) jako tlo sceny. */
export function skyTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#5f97cf');
  grad.addColorStop(0.7, '#a9c8e2');
  grad.addColorStop(1, '#c9dcea');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class OceanRenderer {
  readonly mesh: THREE.Mesh;

  constructor() {
    // Siatka biegunowa: pierscienie coraz rzadsze ku krawedzi (krzywizna potrzebuje wierzcholkow, gesto przy srodku).
    const rings = 48, seg = 64;
    const pos: number[] = [];
    const idx: number[] = [];
    pos.push(0, 0, 0);
    for (let r = 1; r <= rings; r++) {
      const rad = SIZE * (r / rings) ** 2;
      for (let k = 0; k < seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        pos.push(Math.cos(a) * rad, 0, Math.sin(a) * rad);
      }
    }
    for (let k = 0; k < seg; k++) idx.push(0, 1 + ((k + 1) % seg), 1 + k);
    for (let r = 1; r < rings; r++) {
      const a0 = 1 + (r - 1) * seg, b0 = 1 + r * seg;
      for (let k = 0; k < seg; k++) {
        const k1 = (k + 1) % seg;
        idx.push(a0 + k, a0 + k1, b0 + k, a0 + k1, b0 + k1, b0 + k);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({ color: DEEP });
    const haze = { value: HAZE };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uCurve = curveUniform;
      sh.uniforms.uHaze = haze;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + CURVE_COMMON + 'varying float vDist;')
        .replace('#include <project_vertex>', CURVE_PROJECT + '\nvDist = length(curveD);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uHaze;\nvarying float vDist;')
        .replace('#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uHaze, smoothstep(${(EARTH_R * 0.3).toFixed(1)}, ${(EARTH_R * 1.1).toFixed(1)}, vDist));`);
    };
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
  }

  /** Siatka pod srodkiem widoku, tuz pod lustrem wody mapy. */
  update(cx: number, cz: number): void {
    this.mesh.matrix.makeTranslation(cx, SEA_HEIGHT * H_SCALE - 0.02, cz);
    this.mesh.matrixWorld.copy(this.mesh.matrix);
  }
}
