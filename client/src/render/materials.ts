/**
 * Shared materials.
 *
 * Materials were previously constructed inside each Piece's useMemo, so every flip and
 * every deal allocated new GPU resources that nothing ever disposed. A 52-card deck
 * being shuffled and dealt repeatedly leaked steadily.
 *
 * Materials depend only on a piece's definition and its visible state, never on which
 * piece it is, so one instance can serve every card showing the same face. Geometry is
 * shared the same way in geometry.ts.
 */

import * as THREE from 'three';
import type { ComponentDef } from '@wvtt/shared';
import { faceTexture, defaultBackTexture, dieValueTexture } from './faces';

const cache = new Map<string, THREE.Material | THREE.Material[]>();

function memo<T extends THREE.Material | THREE.Material[]>(key: string, make: () => T): T {
  const hit = cache.get(key);
  if (hit) return hit as T;
  const made = make();
  cache.set(key, made);
  return made;
}

/** The pale edge of a card or tile, shared by every piece that has one. */
function edgeMaterial(): THREE.MeshStandardMaterial {
  return memo('__edge', () => new THREE.MeshStandardMaterial({ color: '#e8e4da', roughness: 0.85 })) as THREE.MeshStandardMaterial;
}

export interface PieceLook {
  def: ComponentDef | undefined;
  kind: string;
  faceUp: boolean;
  /** Present only when this client was told the piece's identity. */
  known: boolean;
  dieValue: number | undefined;
}

export function materialsFor(look: PieceLook): THREE.Material | THREE.Material[] {
  const { def, kind, faceUp, known, dieValue } = look;
  const defId = def?.id ?? `anon:${kind}`;

  if (kind === 'card' || kind === 'tile') {
    // A piece whose identity we were not told always shows its back, whatever its
    // faceUp flag says — the client has nothing else it could draw.
    const showFace = faceUp && known;
    return memo(`${defId}:card:${showFace}`, () => {
      const front = known && def ? faceTexture(`${def.id}:front`, def.front) : null;
      const back = def?.back ? faceTexture(`${def.id}:back`, def.back) : defaultBackTexture();
      const up = showFace && front ? front : back;
      const down = showFace && front ? back : (front ?? back);
      const edge = edgeMaterial();
      // BoxGeometry material order: +x, -x, +y, -y, +z, -z
      return [
        edge, edge,
        new THREE.MeshStandardMaterial({ map: up, roughness: 0.6 }),
        new THREE.MeshStandardMaterial({ map: down, roughness: 0.6 }),
        edge, edge,
      ];
    });
  }

  if (kind === 'die') {
    return memo(`${defId}:die:${dieValue ?? 'blank'}`, () => {
      const tex = dieValue ? dieValueTexture(dieValue) : (def ? faceTexture(`${def.id}:front`, def.front) : null);
      return new THREE.MeshStandardMaterial({ map: tex ?? undefined, color: '#ffffff', roughness: 0.4 });
    });
  }

  if (kind === 'piece') {
    const color = String(def?.data?.color ?? 'w') === 'w' ? '#efe7d8' : '#26262c';
    return memo(`${defId}:piece:${color}`, () =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.05 }));
  }

  return memo(`${defId}:flat`, () => {
    const tex = def ? faceTexture(`${def.id}:front`, def.front) : null;
    const color = String(def?.data?.color ?? '#c0392b');
    return new THREE.MeshStandardMaterial({
      map: tex ?? undefined,
      color: tex ? '#ffffff' : color,
      roughness: 0.55,
    });
  });
}

/**
 * Drop every cached material. Called when a room loads a different pack, since the old
 * pack's components will never be drawn again.
 */
export function clearMaterialCache(): void {
  for (const entry of cache.values()) {
    for (const m of Array.isArray(entry) ? entry : [entry]) m.dispose();
  }
  cache.clear();
}
