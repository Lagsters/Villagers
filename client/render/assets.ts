/**
 * Ladowanie modeli .glb wygenerowanych skryptami Blendera (art/models) i ikon (art/icons).
 * Vite dolacza je do builda jako zasoby z haszem w nazwie.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { setModel } from './models.ts';

const modelUrls = import.meta.glob('../../art/models/*.glb', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const iconUrls = import.meta.glob(['../../art/icons/building_*.png', '../../art/icons/good_*.png', '../../art/icons/icon_*.png'], { query: '?url', import: 'default', eager: true }) as Record<string, string>;

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1, path.lastIndexOf('.'));
}

const ICONS: Record<string, string> = {};
for (const [p, url] of Object.entries(iconUrls)) ICONS[baseName(p)] = url;

/** URL ikony (np. 'building_4', 'good_9') albo ''. */
export function iconUrl(name: string): string {
  return ICONS[name] ?? '';
}

/** Geometria ze sceny glTF: wszystkie meshe scalone w jeden (z kolorami wierzcholkow). */
function sceneGeometry(scene: THREE.Object3D): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    parts.push(g.index ? g.toNonIndexed() : g);
  });
  if (parts.length === 0) return null;
  const g = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
  if (!g) return null;
  g.computeBoundingSphere();
  return g;
}

/** Laduje wszystkie modele; progress(0..1). Brakujace/uszkodzone zostaja jako zastepniki. */
export async function loadModels(progress: (f: number) => void = () => {}): Promise<number> {
  const entries = Object.entries(modelUrls);
  const loader = new GLTFLoader();
  let done = 0;
  let ok = 0;
  await Promise.all(entries.map(async ([path, url]) => {
    try {
      const buf = await (await fetch(url)).arrayBuffer();
      const gltf = await loader.parseAsync(buf, '');
      const g = sceneGeometry(gltf.scene);
      if (g) {
        setModel(baseName(path), g);
        ok++;
      }
    } catch (e) {
      console.warn('Model', path, e);
    }
    progress(++done / entries.length);
  }));
  return ok;
}
