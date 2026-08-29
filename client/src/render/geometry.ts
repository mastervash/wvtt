/**
 * Mesh geometry per piece kind.
 *
 * Geometries are shared across every piece of the same kind — a 52-card deck uses one
 * BoxGeometry instance, not 52. Only materials differ per piece.
 */

import * as THREE from 'three';
import { CARD_W, CARD_H, CARD_D } from '@wvtt/shared';

const cache = new Map<string, THREE.BufferGeometry>();

function memo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = cache.get(key);
  if (!g) { g = make(); cache.set(key, g); }
  return g;
}

export function cardGeometry(w = CARD_W, h = CARD_H, d = CARD_D) {
  return memo(`card:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, d, h));
}

export function chipGeometry(r = 0.16, d = 0.045) {
  return memo(`chip:${r}:${d}`, () => new THREE.CylinderGeometry(r, r, d, 28));
}

export function tokenGeometry(r = 0.14, d = 0.12) {
  return memo(`token:${r}:${d}`, () => new THREE.CylinderGeometry(r * 0.85, r, d, 20));
}

export function tileGeometry(w = 0.4, h = 0.6, d = 0.12) {
  return memo(`tile:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, d, h));
}

/**
 * Dice use the platonic solid that matches their face count where one exists.
 *
 * Sized larger than the original 0.15: a d20 at that scale was a speck on a phone, and
 * the rolled value floating over it (see DiceLabels) needs something under it big
 * enough to look like the thing it is labelling.
 */
export function dieGeometry(sides: number, size = 0.22) {
  return memo(`die:${sides}:${size}`, () => {
    switch (sides) {
      case 4: return new THREE.TetrahedronGeometry(size * 1.3);
      case 6: return new THREE.BoxGeometry(size * 1.7, size * 1.7, size * 1.7);
      case 8: return new THREE.OctahedronGeometry(size * 1.3);
      case 12: return new THREE.DodecahedronGeometry(size * 1.2);
      case 20: return new THREE.IcosahedronGeometry(size * 1.25);
      // d10 and d100 have no platonic form; a bipyramid-ish octahedron reads correctly.
      default: return new THREE.OctahedronGeometry(size * 1.25);
    }
  });
}

/**
 * Chess pieces built from stacked primitives. Deliberately abstract rather than
 * figurative: silhouettes stay readable at table scale and on a phone screen.
 */
export function chessGeometry(piece: string) {
  return memo(`chess:${piece}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    const base = new THREE.CylinderGeometry(0.16, 0.19, 0.07, 24);
    base.translate(0, 0.035, 0);
    parts.push(base);

    const stem = (h: number, top: number, bot: number, y: number) => {
      const g = new THREE.CylinderGeometry(top, bot, h, 20);
      g.translate(0, y + h / 2, 0);
      return g;
    };

    switch (piece) {
      case 'p':
        parts.push(stem(0.12, 0.07, 0.11, 0.07));
        parts.push(sphere(0.085, 0.245));
        break;
      case 'r': {
        parts.push(stem(0.22, 0.12, 0.13, 0.07));
        const top = new THREE.CylinderGeometry(0.14, 0.13, 0.07, 20);
        top.translate(0, 0.325, 0);
        parts.push(top);
        break;
      }
      case 'n':
        parts.push(stem(0.2, 0.1, 0.13, 0.07));
        parts.push(box(0.1, 0.14, 0.2, 0, 0.34, 0.03));
        break;
      case 'b':
        parts.push(stem(0.26, 0.07, 0.13, 0.07));
        parts.push(sphere(0.085, 0.36));
        parts.push(sphere(0.032, 0.44));
        break;
      case 'q':
        parts.push(stem(0.32, 0.09, 0.14, 0.07));
        parts.push(new THREE.TorusGeometry(0.1, 0.028, 8, 20).rotateX(Math.PI / 2).translate(0, 0.4, 0));
        parts.push(sphere(0.05, 0.45));
        break;
      case 'k':
      default:
        parts.push(stem(0.34, 0.09, 0.14, 0.07));
        parts.push(box(0.16, 0.045, 0.045, 0, 0.44, 0));
        parts.push(box(0.045, 0.14, 0.045, 0, 0.44, 0));
        break;
    }
    return mergeAll(parts);
  });

  function sphere(r: number, y: number) {
    const g = new THREE.SphereGeometry(r, 16, 12);
    g.translate(0, y, 0);
    return g;
  }
  function box(w: number, h: number, d: number, x: number, y: number, z: number) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    return g;
  }
}

/**
 * Merge geometries by concatenating position/normal/uv attributes.
 *
 * Written out rather than pulled from three's BufferGeometryUtils so the merge only
 * has to handle the non-indexed, same-attribute case these primitives produce.
 */
function mergeAll(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const nonIndexed = list.map((g) => (g.index ? g.toNonIndexed() : g));
  const out = new THREE.BufferGeometry();
  for (const attr of ['position', 'normal', 'uv'] as const) {
    const arrays = nonIndexed.map((g) => g.getAttribute(attr) as THREE.BufferAttribute).filter(Boolean);
    if (arrays.length !== nonIndexed.length) continue;
    const size = arrays[0].itemSize;
    const total = arrays.reduce((n, a) => n + a.array.length, 0);
    const merged = new Float32Array(total);
    let off = 0;
    for (const a of arrays) { merged.set(a.array as Float32Array, off); off += a.array.length; }
    out.setAttribute(attr, new THREE.BufferAttribute(merged, size));
  }
  out.computeBoundingSphere();
  return out;
}
