/**
 * Dice: the solids, their numbered faces, and which way up each number is.
 *
 * The dice used to be untextured platonic solids with the rolled value floating over
 * them on a billboard, because a single texture stretched across a polyhedron's default
 * UVs is unreadable — the number appears sheared and repeated on every face. That is
 * true of the default UVs. It is not true of UVs we generate ourselves.
 *
 * So each solid is unwrapped here: its triangles are grouped into the faces a player
 * would recognise (three triangles make one pentagon on a d12), and each face is mapped
 * to its own cell of a texture atlas with one number drawn in it. The die then carries
 * its numbers the way a real one does.
 *
 * Knowing where the faces are also means we can turn a die so a chosen number is on
 * top, which is what makes a roll land on the value the server rolled rather than on
 * whatever orientation happened to be current.
 */

import * as THREE from 'three';

/** One face of a die: the number it carries and the way it points. */
export interface DieFace {
  /** Outward unit normal, in the geometry's own space. */
  normal: THREE.Vector3;
  /** What is printed on it — 1..sides, or 00..90 for a percentile die. */
  label: string;
  /**
   * How much of the face's atlas cell the number may fill, 0..1.
   *
   * The cell is square and the face usually is not. A triangle inscribed in the same
   * circle as the cell covers barely half of it, so a numeral sized to the cell runs
   * off the edges of a d20's faces and gets clipped mid-digit. This is the face's own
   * inradius over its circumradius — the largest circle that actually fits on it.
   */
  fit: number;
}

export interface DieShape {
  geometry: THREE.BufferGeometry;
  /** Indexed by value - 1, so faces[value - 1] is the face showing that value. */
  faces: DieFace[];
  /**
   * The same faces in the order their atlas cells are laid out.
   *
   * Not the same order as `faces`: the numbers are assigned so opposite faces add up,
   * which shuffles them relative to the geometry. The texture is drawn from this and
   * the orientation is read from `faces`, so neither has to know about the other.
   */
  cells: { label: string; fit: number }[];
}

const shapes = new Map<string, DieShape>();

/**
 * How much of a face's inscribed circle the number fills.
 *
 * Under 1 so a numeral never runs into the edge it is printed on, which on a d20 —
 * twenty small triangles — is the difference between a die and a smudge.
 */
export const FACE_FILL = 0.86;

/**
 * How wide each die is across the table, in table units.
 *
 * Set rather than derived, because the solids have wildly different ratios of width to
 * circumradius: normalising them all to the same bounding sphere makes the cube look
 * shrunken next to the icosahedron. These follow a real polyhedral set, where a d6 is
 * the small one and the d20 the big one, and they are what makes the tray read as a
 * matched set rather than as seven unrelated objects.
 */
const DIE_WIDTH: Record<number, number> = {
  4: 0.60, 6: 0.54, 8: 0.60, 10: 0.60, 12: 0.66, 20: 0.70, 100: 0.60,
};

/**
 * The solid for a die with this many sides, unwrapped and numbered.
 *
 * `size` is an overall multiplier on the set, not the size of one die: the relative
 * proportions come from DIE_WIDTH so they stay right at any scale.
 */
export function dieShape(sides: number, size = 1): DieShape {
  const key = `${sides}:${size}`;
  const hit = shapes.get(key);
  if (hit) return hit;

  const base = baseSolid(sides);
  fitWidth(base, (DIE_WIDTH[sides] ?? 0.6) * size);
  const made = unwrap(base, labelsFor(sides));
  shapes.set(key, made);
  return made;
}

/** The bare solid, before it is unwrapped. Non-indexed so every triangle is its own. */
function baseSolid(sides: number): THREE.BufferGeometry {
  switch (sides) {
    case 4: return new THREE.TetrahedronGeometry(1).toNonIndexed();
    case 6: return new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    case 8: return new THREE.OctahedronGeometry(1).toNonIndexed();
    case 12: return new THREE.DodecahedronGeometry(1).toNonIndexed();
    case 20: return new THREE.IcosahedronGeometry(1).toNonIndexed();
    // A d10 is not a platonic solid, and standing in an octahedron for one — as this
    // did — leaves eight faces to print ten numbers on. It is a pentagonal
    // trapezohedron, and building the real thing is the only way the numbers add up.
    default: return trapezohedron();
  }
}

/** Scale a solid so it is this wide across the table, whatever its shape. */
function fitWidth(g: THREE.BufferGeometry, width: number): void {
  g.computeBoundingBox();
  const b = g.boundingBox!;
  const across = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
  if (across > 1e-6) g.scale(width / across, width / across, width / across);
}

/** What is printed on each face, in the order the faces are numbered. */
function labelsFor(sides: number): string[] {
  // A percentile die is a d10 marked in tens; 00 stands for a hundred with the other.
  if (sides === 100) return ['00', '10', '20', '30', '40', '50', '60', '70', '80', '90'];
  return Array.from({ length: sides }, (_, i) => String(i + 1));
}

/**
 * A pentagonal trapezohedron: ten kite faces, the shape every d10 in a dice bag has.
 *
 * Two rings of five vertices, offset half a step from one another, capped by an apex at
 * each end. The apex height is not chosen — it is solved for, because a kite whose four
 * corners are not coplanar is not a face, and the numbers printed on it would bend
 * across a crease.
 */
function trapezohedron(): THREE.BufferGeometry {
  const r = 1;
  /**
   * How far the two rings sit above and below the equator.
   *
   * This one number decides the whole shape, because the apex is then solved from it —
   * and it is far more sensitive than it looks. At 0.35 the apexes solve to over three
   * times the base radius and the die comes out as a dart. A real d10 is a little
   * taller than it is wide, which is about here.
   */
  const h = 0.13;
  const upper: THREE.Vector3[] = [];
  const lower: THREE.Vector3[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    upper.push(new THREE.Vector3(Math.cos(a) * r, h, Math.sin(a) * r));
    const b = a + Math.PI / 5;
    lower.push(new THREE.Vector3(Math.cos(b) * r, -h, Math.sin(b) * r));
  }

  // Solve the apex height from the plane through three of a top kite's corners.
  const n = new THREE.Vector3()
    .subVectors(upper[1], upper[0])
    .cross(new THREE.Vector3().subVectors(lower[0], upper[0]))
    .normalize();
  const apexY = n.dot(upper[0]) / n.y;
  const top = new THREE.Vector3(0, apexY, 0);
  const bottom = new THREE.Vector3(0, -apexY, 0);

  const positions: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };
  /** A kite as two triangles, wound so the normal points outward. */
  const kite = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => {
    const normal = new THREE.Vector3()
      .subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const centre = new THREE.Vector3().add(a).add(b).add(c).add(d).multiplyScalar(0.25);
    if (normal.dot(centre) < 0) { tri(a, c, b); tri(a, d, c); }
    else { tri(a, b, c); tri(a, c, d); }
  };

  for (let i = 0; i < 5; i++) {
    const j = (i + 1) % 5;
    kite(top, upper[i], lower[i], upper[j]);
    kite(bottom, lower[i], upper[j], lower[j]);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Group a solid's triangles into faces and give each one its own patch of the atlas.
 *
 * Faces are ordered top-down and then around, so the numbering is stable between runs
 * and between clients — two players must never see different numbers on the same die.
 */
function unwrap(geometry: THREE.BufferGeometry, labels: string[]): DieShape {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const triangles = pos.count / 3;

  interface Group { normal: THREE.Vector3; tris: number[]; centre: THREE.Vector3 }
  const groups: Group[] = [];

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let t = 0; t < triangles; t++) {
    a.fromBufferAttribute(pos, t * 3);
    b.fromBufferAttribute(pos, t * 3 + 1);
    c.fromBufferAttribute(pos, t * 3 + 2);
    const normal = new THREE.Vector3()
      .subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    // Coplanar triangles of the same face share a normal. 0.999 is about two and a half
    // degrees, far tighter than the gap between any two faces of these solids.
    const hit = groups.find((g) => g.normal.dot(normal) > 0.999);
    if (hit) hit.tris.push(t);
    else groups.push({ normal, tris: [t], centre: new THREE.Vector3() });
  }

  for (const g of groups) {
    g.centre.set(0, 0, 0);
    for (const t of g.tris) {
      for (let k = 0; k < 3; k++) {
        a.fromBufferAttribute(pos, t * 3 + k);
        g.centre.add(a);
      }
    }
    g.centre.multiplyScalar(1 / (g.tris.length * 3));
  }

  // Highest face first, then anticlockwise. Any total order would do; this one is
  // reproducible and puts 1 somewhere sensible.
  groups.sort((p, q) => q.normal.y - p.normal.y
    || Math.atan2(p.normal.z, p.normal.x) - Math.atan2(q.normal.z, q.normal.x));

  const cols = Math.ceil(Math.sqrt(groups.length));
  const rows = Math.ceil(groups.length / cols);
  const uvs = new Float32Array(pos.count * 2);

  const rel = new THREE.Vector3();
  const flat = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);

  groups.forEach((g, index) => {
    /**
     * Unwrap each face as if it were already the face on top.
     *
     * The obvious thing is to build a basis from the face's normal where it sits in the
     * model, and that is what this did — with the result that half the numerals came
     * out upside down or on their side. A number on a die only has to read correctly
     * when its face is the one showing, so the face is rotated flat first and laid out
     * in that frame. Every number is then upright at the moment anybody reads it.
     *
     * The camera looks down the table from behind the near edge, so "up" on screen is
     * -Z. That is where the top of the numeral goes.
     */
    flat.setFromUnitVectors(g.normal, up);

    let radius = 0;
    for (const t of g.tris) {
      for (let k = 0; k < 3; k++) {
        a.fromBufferAttribute(pos, t * 3 + k);
        rel.subVectors(a, g.centre).applyQuaternion(flat);
        radius = Math.max(radius, Math.hypot(rel.x, rel.z));
      }
    }
    if (radius < 1e-6) radius = 1;

    const col = index % cols;
    const row = Math.floor(index / cols);
    for (const t of g.tris) {
      for (let k = 0; k < 3; k++) {
        const v = t * 3 + k;
        a.fromBufferAttribute(pos, v);
        rel.subVectors(a, g.centre).applyQuaternion(flat);
        const u = 0.5 + (rel.x / (2 * radius)) * FACE_FILL;
        const w = 0.5 + (-rel.z / (2 * radius)) * FACE_FILL;
        uvs[v * 2] = (col + u) / cols;
        // The atlas is drawn top-down but sampled bottom-up, so rows count back.
        uvs[v * 2 + 1] = (rows - 1 - row + w) / rows;
      }
    }
  });

  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  /**
   * Number the faces so opposite ones add up to sides + 1.
   *
   * Every real die is made this way — 1 opposite 6, 20 opposite 1 — and numbering the
   * faces in whatever order they happened to sort gives a solid that is unmistakably
   * not a die to anyone who plays with them. Walking the faces and handing each pair
   * the lowest and highest numbers left reproduces the convention exactly.
   *
   * A tetrahedron has no opposite faces at all, so it simply numbers through.
   */
  const n = groups.length;
  const number = new Array<number>(n).fill(0);
  let next = 1;
  for (let i = 0; i < n; i++) {
    if (number[i]) continue;
    const anti = groups.findIndex((g, j) => j !== i && g.normal.dot(groups[i].normal) < -0.9);
    number[i] = next;
    if (anti >= 0) number[anti] = n + 1 - next;
    next += 1;
  }

  const fits = groups.map((g) => faceFit(pos, g.tris, g.centre));
  const faces: DieFace[] = [];
  groups.forEach((g, i) => {
    faces[number[i] - 1] = {
      normal: g.normal.clone(),
      label: labels[number[i] - 1] ?? String(number[i]),
      fit: fits[i],
    };
  });

  return {
    geometry,
    faces,
    // Cell order follows the geometry, because that is what the UVs were built against.
    cells: groups.map((_, i) => ({
      label: labels[number[i] - 1] ?? String(number[i]),
      fit: fits[i],
    })),
  };
}

/**
 * The largest circle that fits inside a face, as a fraction of the one around it.
 *
 * Found from the face's outline: an edge shared by two of its triangles is internal,
 * and one that appears only once is on the boundary. Measuring to those gives the right
 * answer for a kite or a pentagon as readily as for a triangle, so a pack inventing its
 * own die shape gets legible numbers without anyone hand-tuning a constant.
 */
function faceFit(pos: THREE.BufferAttribute, tris: number[], centre: THREE.Vector3): number {
  const seen = new Map<string, { a: THREE.Vector3; b: THREE.Vector3; count: number }>();
  const at = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, i);
  /** Quantised so the two triangles sharing an edge agree it is the same edge. */
  const key = (v: THREE.Vector3) =>
    `${Math.round(v.x * 1e4)},${Math.round(v.y * 1e4)},${Math.round(v.z * 1e4)}`;

  for (const t of tris) {
    const v = [at(t * 3), at(t * 3 + 1), at(t * 3 + 2)];
    for (let k = 0; k < 3; k++) {
      const a = v[k];
      const b = v[(k + 1) % 3];
      const id = [key(a), key(b)].sort().join('|');
      const hit = seen.get(id);
      if (hit) hit.count += 1;
      else seen.set(id, { a, b, count: 1 });
    }
  }

  let circum = 0;
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      circum = Math.max(circum, at(t * 3 + k).distanceTo(centre));
    }
  }
  if (circum < 1e-6) return 1;

  let inradius = Infinity;
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  for (const e of seen.values()) {
    if (e.count !== 1) continue;         // internal edge, not part of the outline
    ab.subVectors(e.b, e.a);
    ac.subVectors(centre, e.a);
    const len = ab.length();
    if (len < 1e-6) continue;
    // Perpendicular distance from the centre to the line the edge lies on.
    inradius = Math.min(inradius, ac.clone().cross(ab).length() / len);
  }
  if (!Number.isFinite(inradius)) return 1;
  return Math.max(0.2, Math.min(1, inradius / circum));
}

/** How the atlas is laid out, so the texture and the UVs agree without a second guess. */
export function atlasGrid(count: number): { cols: number; rows: number } {
  const cols = Math.ceil(Math.sqrt(count));
  return { cols, rows: Math.ceil(count / cols) };
}

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

/**
 * The rotation that lands a given value.
 *
 * The server rolls the number and a spin to go with it; both are in shared state, so
 * every client works this out identically and sees the same die land the same way up.
 *
 * Turning the rolled face straight up is right for every solid here but one. A d6, d8,
 * d10, d12 and d20 all have a face directly opposite each face, so pointing one at the
 * ceiling rests its opposite flat on the table. A tetrahedron does not: a d4 with the 4
 * pointing up is balanced on a corner, which is what it looked like. That one rests on
 * a face instead, leaving the rolled number on one of the three faces tilted towards
 * you — which is how a d4 sits in real life anyway.
 */
export function orientationFor(shape: DieShape, value: number, spin: number): THREE.Quaternion {
  const around = new THREE.Quaternion().setFromAxisAngle(UP, spin);
  const face = shape.faces[Math.max(0, Math.min(shape.faces.length - 1, value - 1))];
  if (!face) return around;

  // The face most opposed to the rolled one is what the die would come to rest on.
  let rest = face;
  let worst = Infinity;
  for (const other of shape.faces) {
    const d = other.normal.dot(face.normal);
    if (d < worst) { worst = d; rest = other; }
  }

  const align = new THREE.Quaternion();
  // Close to antipodal: putting the rolled face up does rest the die on a face.
  if (worst < -0.9) align.setFromUnitVectors(face.normal, UP);
  // Otherwise sit it on that face and let the number be read off the slope.
  else align.setFromUnitVectors(rest.normal, DOWN);
  return around.multiply(align);
}
