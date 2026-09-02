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
import { faceTexture, defaultBackTexture, dieAtlasTexture, defaultDieColor } from './faces';
import { dieShape } from './dice';

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
  return memo('__edge', () => new THREE.MeshStandardMaterial({
    color: '#ded9cd', roughness: 0.9, metalness: 0,
  })) as THREE.MeshStandardMaterial;
}

export interface PieceLook {
  def: ComponentDef | undefined;
  kind: string;
  faceUp: boolean;
  /** Present only when this client was told the piece's identity. */
  known: boolean;
  /** Colour chosen for this piece at the table, or '' for the pack's own. */
  tint?: string;
}

export function materialsFor(look: PieceLook): THREE.Material | THREE.Material[] {
  const { def, kind, faceUp, known, tint } = look;
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
      /**
       * The corners are cut by the artwork, not by the mesh.
       *
       * Every generated face is painted onto a transparent canvas inside a rounded
       * rectangle, so the four corners already have zero alpha — they were simply
       * being ignored. Discarding them turns a deck of hard-cornered rectangles into
       * a deck of cards, at the cost of one comparison per fragment and with none of
       * the sort-order trouble real transparency brings. A face with no transparency
       * anywhere, such as a pack's own bitmap, is unaffected.
       *
       * alphaTest also propagates into the shadow pass, so a card's shadow gets the
       * same rounded corners its face has.
       */
      const face = (map: THREE.Texture | null) => new THREE.MeshStandardMaterial({
        map: map ?? undefined, roughness: 0.62, metalness: 0, alphaTest: 0.5,
      });
      // BoxGeometry material order: +x, -x, +y, -y, +z, -z
      return [
        edge, edge,
        face(up),
        face(down),
        edge, edge,
      ];
    });
  }

  if (kind === 'die') {
    /**
     * The numbers ARE painted on the mesh now.
     *
     * They could not be while the solid used three.js's default UVs, which stretch one
     * texture across every face — the old comment here was right about that, and the
     * value lived on a billboard overhead instead. dice.ts unwraps each solid into a
     * face-per-cell atlas, so the numerals sit flat on the faces the way they do on a
     * real die, and the billboard is no longer standing in for them.
     */
    const sides = def?.sides ?? 6;
    const colorId = tint || defaultDieColor(sides);
    return memo(`${defId}:die:${colorId}`, () => new THREE.MeshStandardMaterial({
      map: dieAtlasTexture(sides, dieShape(sides).cells, colorId),
      // Moulded acrylic: tighter highlight than paper, no metal in it.
      roughness: 0.3,
      metalness: 0.02,
    }));
  }

  if (kind === 'piece') {
    const color = String(def?.data?.color ?? 'w') === 'w' ? '#efe7d8' : '#26262c';
    return memo(`${defId}:piece:${color}`, () =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.05 }));
  }

  return memo(`${defId}:flat:${kind}`, () => {
    const tex = def ? faceTexture(`${def.id}:front`, def.front) : null;
    const color = String(def?.data?.color ?? '#c0392b');
    // Chips are moulded clay with a sheen; tokens are matte. Sharing one roughness left
    // a stack of chips reading as painted card.
    const moulded = kind === 'chip';
    return new THREE.MeshStandardMaterial({
      map: tex ?? undefined,
      color: tex ? '#ffffff' : color,
      roughness: moulded ? 0.34 : 0.6,
      metalness: moulded ? 0.06 : 0,
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
