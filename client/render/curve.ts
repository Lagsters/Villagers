/**
 * Wrazenie kuli ziemskiej: kazdy punkt swiata opada o d^2 / (2R), gdzie d - odleglosc w poziomie od srodka widoku,
 * R - promien "planety". Przy srodku widoku prawie nic sie nie zmienia, daleki teren lagodnie znika za horyzontem
 * (najlepiej widac przy mocno pochylonej kamerze). Tylko w shaderach (teren, modele) - symulacja i wysokosci w kodzie
 * zostaja plaskie; wybieranie pola kliknieciem uwzglednia to samo opadanie (curveDrop).
 */
import * as THREE from 'three';

/** Promien "planety" w jednostkach swiata (pole = 1). */
export const EARTH_R = 90;

/** Uniform wspolny dla materialow: x, y - srodek widoku (swiat x, z), z - 1 / (2R). */
export const curveUniform = { value: new THREE.Vector3(0, 0, 1 / (2 * EARTH_R)) };

/** Opadanie punktu (wx, wz) przy srodku widoku (cx, cz). */
export function curveDrop(wx: number, wz: number, cx: number, cz: number): number {
  const dx = wx - cx, dz = wz - cz;
  return (dx * dx + dz * dz) / (2 * EARTH_R);
}

/** Deklaracja uniformu (do sekcji common shadera wierzcholkow). */
export const CURVE_COMMON = /* glsl */ `
uniform vec3 uCurve;
`;

/** Zamiast project_vertex z three.js: polozenie w swiecie, opadanie, potem kamera. */
export const CURVE_PROJECT = /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelMatrix * mvPosition;
vec2 curveD = mvPosition.xz - uCurve.xy;
mvPosition.y -= dot(curveD, curveD) * uCurve.z;
mvPosition = viewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;
