/**
 * Procedural face artwork.
 *
 * Every card, chip and die face is drawn with the Canvas 2D API at load time and
 * uploaded as a texture. Nothing is fetched, so the app ships no image assets and
 * carries no licensing baggage for card art — and a user-authored pack can produce
 * new faces from plain text without uploading anything either.
 *
 * Textures are cached by key, because a 52-card deck asks for the same back 52 times.
 */

import * as THREE from 'three';
import type { FaceSource } from '@wvtt/shared';
import { atlasGrid, FACE_FILL } from './dice';

const cache = new Map<string, THREE.Texture>();

const CARD_PX_W = 320;
const CARD_PX_H = 448;

const SUIT_GLYPH: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣', X: '★' };
const SUIT_COLOR: Record<string, string> = { S: '#16161a', C: '#16161a', H: '#c0392b', D: '#c0392b', X: '#8e44ad' };

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

function finish(c: HTMLCanvasElement): THREE.Texture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * The card stock every face is drawn on.
 *
 * A flat fill reads as a rectangle of paint; a very shallow vertical gradient plus a
 * hairline inner rule reads as card stock under a light. Both are nearly free, and
 * they are what makes the deck look printed rather than filled.
 */
function paperFill(ctx: CanvasRenderingContext2D, w: number, h: number, tint = '#fbfaf6') {
  // The top stop is derived from the tint, not a fixed white. A pack's cards can be any
  // colour, and a hard white top on a saturated blue card reads as a lighting fault
  // rather than as paper — on the default near-white stock the two are indistinguishable.
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, shade(tint, 0.22));
  grad.addColorStop(0.35, tint);
  grad.addColorStop(1, shade(tint, -0.08));
  ctx.fillStyle = grad;
  roundRect(ctx, 4, 4, w - 8, h - 8, 22);
  ctx.fill();

  ctx.strokeStyle = 'rgba(0,0,0,0.20)';
  ctx.lineWidth = 2;
  roundRect(ctx, 4, 4, w - 8, h - 8, 22);
  ctx.stroke();

  // The inner rule. Barely visible on its own, but its absence is what makes a
  // generated card look like a slide rather than a card.
  ctx.strokeStyle = 'rgba(0,0,0,0.07)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, 13, 13, w - 26, h - 26, 15);
  ctx.stroke();
}

/** Lighten (+) or darken (-) a hex colour by a fraction. Used for shading only. */
function shade(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
    Math.max(0, Math.min(255, Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount)))));
  return `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** A short centred hairline, used to separate a crest's letter from its suit. */
function rule(ctx: CanvasRenderingContext2D, cx: number, y: number, w: number, color: string) {
  const grad = ctx.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.5, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = grad;
  ctx.fillRect(cx - w / 2, y, w, 1.5);
  ctx.restore();
}

/** Pip layout for number cards, in fractions of the card's inner area. */
const PIP_LAYOUT: Record<string, [number, number][]> = {
  '2': [[0.5, 0.18], [0.5, 0.82]],
  '3': [[0.5, 0.18], [0.5, 0.5], [0.5, 0.82]],
  '4': [[0.28, 0.18], [0.72, 0.18], [0.28, 0.82], [0.72, 0.82]],
  '5': [[0.28, 0.18], [0.72, 0.18], [0.5, 0.5], [0.28, 0.82], [0.72, 0.82]],
  '6': [[0.28, 0.18], [0.72, 0.18], [0.28, 0.5], [0.72, 0.5], [0.28, 0.82], [0.72, 0.82]],
  '7': [[0.28, 0.18], [0.72, 0.18], [0.5, 0.34], [0.28, 0.5], [0.72, 0.5], [0.28, 0.82], [0.72, 0.82]],
  '8': [[0.28, 0.18], [0.72, 0.18], [0.5, 0.34], [0.28, 0.5], [0.72, 0.5], [0.5, 0.66], [0.28, 0.82], [0.72, 0.82]],
  '9': [[0.28, 0.18], [0.72, 0.18], [0.28, 0.39], [0.72, 0.39], [0.5, 0.5], [0.28, 0.61], [0.72, 0.61], [0.28, 0.82], [0.72, 0.82]],
  T: [[0.28, 0.18], [0.72, 0.18], [0.5, 0.28], [0.28, 0.39], [0.72, 0.39], [0.28, 0.61], [0.72, 0.61], [0.5, 0.72], [0.28, 0.82], [0.72, 0.82]],
};

function drawPlayingCard(rank: string, suit: string): HTMLCanvasElement {
  const [c, ctx] = canvas(CARD_PX_W, CARD_PX_H);
  const color = SUIT_COLOR[suit] ?? '#16161a';
  const glyph = SUIT_GLYPH[suit] ?? '?';

  paperFill(ctx, CARD_PX_W, CARD_PX_H);

  if (rank === 'X') {
    ctx.textAlign = 'center';
    ctx.fillStyle = color;
    ctx.font = '150px Georgia, serif';
    ctx.globalAlpha = 0.12;
    ctx.fillText('★', CARD_PX_W / 2, CARD_PX_H / 2 + 108);
    ctx.globalAlpha = 1;
    ctx.font = 'bold 42px Georgia, serif';
    ctx.fillText('JOKER', CARD_PX_W / 2, CARD_PX_H / 2 - 16);
    rule(ctx, CARD_PX_W / 2, CARD_PX_H / 2 + 4, 96, color);
    ctx.font = '84px Georgia, serif';
    ctx.fillText('★', CARD_PX_W / 2, CARD_PX_H / 2 + 92);
    return c;
  }

  // Corner index, top-left and repeated upside-down bottom-right.
  const drawCorner = () => {
    ctx.textAlign = 'center';
    ctx.fillStyle = color;
    ctx.font = 'bold 54px Georgia, serif';
    ctx.fillText(rank === 'T' ? '10' : rank, 40, 66);
    ctx.font = '44px Georgia, serif';
    ctx.fillText(glyph, 40, 112);
  };
  drawCorner();
  ctx.save();
  ctx.translate(CARD_PX_W, CARD_PX_H);
  ctx.rotate(Math.PI);
  drawCorner();
  ctx.restore();

  const innerX = 78, innerY = 60, innerW = CARD_PX_W - 156, innerH = CARD_PX_H - 120;

  if (rank === 'J' || rank === 'Q' || rank === 'K') {
    // Court cards get a simple crest rather than a figure — legible at table scale.
    ctx.fillStyle = color;
    roundRect(ctx, innerX, innerY, innerW, innerH, 12);
    ctx.globalAlpha = 0.07;
    ctx.fill();
    ctx.globalAlpha = 1;
    // A double rule: the outer heavy, the inner hairline, the way a real court card's
    // frame is printed. One line alone reads as a placeholder box.
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    roundRect(ctx, innerX, innerY, innerW, innerH, 12);
    ctx.stroke();
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1.5;
    roundRect(ctx, innerX + 7, innerY + 7, innerW - 14, innerH - 14, 8);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.font = 'bold 116px Georgia, serif';
    ctx.fillText(rank, CARD_PX_W / 2, CARD_PX_H / 2 + 10);
    rule(ctx, CARD_PX_W / 2, CARD_PX_H / 2 + 34, 84, color);
    ctx.font = '50px Georgia, serif';
    ctx.fillText(glyph, CARD_PX_W / 2, CARD_PX_H / 2 + 88);
    return c;
  }

  if (rank === 'A') {
    ctx.textAlign = 'center';
    // A thin ring behind the single pip, so the ace reads as designed rather than as
    // a number card that lost its other pips.
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(CARD_PX_W / 2, CARD_PX_H / 2, 108, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.font = '164px Georgia, serif';
    ctx.fillText(glyph, CARD_PX_W / 2, CARD_PX_H / 2 + 60);
    return c;
  }

  const pips = PIP_LAYOUT[rank] ?? [];
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.font = '58px Georgia, serif';
  for (const [fx, fy] of pips) {
    const px = innerX + fx * innerW;
    const py = innerY + fy * innerH;
    ctx.save();
    ctx.translate(px, py);
    // Bottom-half pips are inverted, as on a real card.
    if (fy > 0.55) ctx.rotate(Math.PI);
    ctx.fillText(glyph, 0, 20);
    ctx.restore();
  }
  return c;
}

function drawCardBack(): HTMLCanvasElement {
  const [c, ctx] = canvas(CARD_PX_W, CARD_PX_H);
  ctx.fillStyle = '#fbfaf6';
  roundRect(ctx, 4, 4, CARD_PX_W - 8, CARD_PX_H - 8, 22);
  ctx.fill();

  ctx.save();
  roundRect(ctx, 16, 16, CARD_PX_W - 32, CARD_PX_H - 32, 14);
  ctx.clip();

  // A vertical gradient under the lattice. A single flat blue is the single clearest
  // tell that a deck was generated; two stops cost nothing and remove it.
  const ground = ctx.createLinearGradient(0, 16, 0, CARD_PX_H - 16);
  ground.addColorStop(0, '#3a5d92');
  ground.addColorStop(1, '#22406c');
  ctx.fillStyle = ground;
  ctx.fillRect(16, 16, CARD_PX_W - 32, CARD_PX_H - 32);

  // Diagonal lattice.
  ctx.strokeStyle = 'rgba(255,255,255,0.20)';
  ctx.lineWidth = 3;
  for (let i = -CARD_PX_H; i < CARD_PX_W + CARD_PX_H; i += 22) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + CARD_PX_H, CARD_PX_H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(i, CARD_PX_H); ctx.lineTo(i + CARD_PX_H, 0); ctx.stroke();
  }

  // A centre medallion gives the back a middle to look at, and gives a fanned hand a
  // repeating landmark instead of an unbroken field of diagonals.
  const cx = CARD_PX_W / 2, cy = CARD_PX_H / 2;
  ctx.fillStyle = 'rgba(16,30,52,0.55)';
  ctx.beginPath(); ctx.arc(cx, cy, 64, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.38)';
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(cx, cy, 64, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(cx, cy, 54, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.80)';
  ctx.textAlign = 'center';
  ctx.font = 'bold 30px Georgia, serif';
  ctx.fillText('W', cx, cy + 11);

  // A soft corner-to-corner sheen, so the back catches light like a printed surface.
  const sheen = ctx.createLinearGradient(16, 16, CARD_PX_W - 16, CARD_PX_H - 16);
  sheen.addColorStop(0, 'rgba(255,255,255,0.10)');
  sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
  sheen.addColorStop(1, 'rgba(0,0,0,0.16)');
  ctx.fillStyle = sheen;
  ctx.fillRect(16, 16, CARD_PX_W - 32, CARD_PX_H - 32);
  ctx.restore();

  ctx.strokeStyle = 'rgba(0,0,0,0.20)';
  ctx.lineWidth = 2;
  roundRect(ctx, 4, 4, CARD_PX_W - 8, CARD_PX_H - 8, 22);
  ctx.stroke();
  return c;
}

function drawChip(value: number, color: string): HTMLCanvasElement {
  const size = 256;
  const [c, ctx] = canvas(size, size);
  const r = size / 2;

  // Body, lit from the top-left. A flat disc of colour looks like a sticker; the
  // gradient is what makes it read as moulded clay.
  const body = ctx.createRadialGradient(r * 0.7, r * 0.65, r * 0.1, r, r, r);
  body.addColorStop(0, shade(color, 0.22));
  body.addColorStop(0.65, color);
  body.addColorStop(1, shade(color, -0.28));
  ctx.fillStyle = body;
  ctx.beginPath(); ctx.arc(r, r, r - 4, 0, Math.PI * 2); ctx.fill();

  // Edge spots, the way real chips are marked.
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.save();
    ctx.translate(r + Math.cos(a) * (r - 22), r + Math.sin(a) * (r - 22));
    ctx.rotate(a);
    ctx.fillRect(-16, -9, 32, 18);
    ctx.restore();
  }

  // Inlay: a recessed ring, then the pale face the value is stamped on.
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(r, r, r - 46, 0, Math.PI * 2); ctx.stroke();
  const inlay = ctx.createRadialGradient(r * 0.8, r * 0.75, 4, r, r, r - 52);
  inlay.addColorStop(0, '#ffffff');
  inlay.addColorStop(1, '#e6e2d8');
  ctx.fillStyle = inlay;
  ctx.beginPath(); ctx.arc(r, r, r - 52, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = '#16161a';
  ctx.textAlign = 'center';
  ctx.font = `bold ${value >= 100 ? 62 : 76}px Helvetica, Arial, sans-serif`;
  ctx.fillText(String(value), r, r + 26);
  return c;
}

function drawTextFace(text: string, bg: string, fg: string, fontScale = 1): HTMLCanvasElement {
  const [c, ctx] = canvas(CARD_PX_W, CARD_PX_H);
  // Same stock as the built-in deck: a pack's own cards should not be identifiable
  // from across the table by their flatter paper.
  paperFill(ctx, CARD_PX_W, CARD_PX_H, bg);

  if (!text) return c;

  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  const base = Math.max(20, Math.min(40, 460 / Math.max(8, text.length) + 16)) * fontScale;
  ctx.font = `600 ${base}px Helvetica, Arial, sans-serif`;

  // Wrap to the card width.
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const trial = line ? `${line} ${w}` : w;
    if (ctx.measureText(trial).width > CARD_PX_W - 60 && line) { lines.push(line); line = w; }
    else line = trial;
  }
  if (line) lines.push(line);

  const lh = base * 1.25;
  let y = CARD_PX_H / 2 - ((lines.length - 1) * lh) / 2;
  for (const l of lines.slice(0, 10)) { ctx.fillText(l, CARD_PX_W / 2, y); y += lh; }
  return c;
}

function drawBlank(color: string): HTMLCanvasElement {
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 128, 128);
  return c;
}

/**
 * The colours a die can be, offered in its context menu.
 *
 * Named rather than free-form: a colour picker on a table gives you a die nobody else
 * can describe out loud, and "the red d20" is how dice are actually referred to. The
 * body colour is what the atlas is painted on; the pips are chosen to stay legible
 * against it.
 */
export const DIE_COLORS: { id: string; label: string; body: string; ink: string }[] = [
  { id: 'bone', label: 'Bone', body: '#f2efe6', ink: '#1d1d22' },
  { id: 'red', label: 'Red', body: '#c0392b', ink: '#fdf3f1' },
  { id: 'orange', label: 'Orange', body: '#d2751f', ink: '#fff6ec' },
  { id: 'yellow', label: 'Yellow', body: '#e0b02a', ink: '#241d05' },
  { id: 'green', label: 'Green', body: '#2f8b57', ink: '#f0fbf4' },
  { id: 'blue', label: 'Blue', body: '#2f6fb8', ink: '#f1f7ff' },
  { id: 'purple', label: 'Purple', body: '#7a4fa8', ink: '#f8f2ff' },
  { id: 'black', label: 'Black', body: '#26262c', ink: '#f0f0f4' },
];

export function dieColor(id: string | undefined) {
  return DIE_COLORS.find((c) => c.id === id) ?? DIE_COLORS[0];
}

/** The colour a die is by default, when its pack has not said and nobody has chosen. */
const DEFAULT_DIE_COLOR: Record<number, string> = {
  4: 'yellow', 6: 'bone', 8: 'blue', 10: 'purple', 12: 'green', 20: 'red', 100: 'black',
};

export function defaultDieColor(sides: number): string {
  return DEFAULT_DIE_COLOR[sides] ?? 'bone';
}

/** The classic pip layout, in fractions of a face. */
const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.3, 0.3], [0.7, 0.7]],
  3: [[0.28, 0.28], [0.5, 0.5], [0.72, 0.72]],
  4: [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]],
  5: [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]],
  6: [[0.3, 0.26], [0.7, 0.26], [0.3, 0.5], [0.7, 0.5], [0.3, 0.74], [0.7, 0.74]],
};

/**
 * The numbered faces of a die, as one texture.
 *
 * One cell per face, laid out to match the UVs generated in dice.ts — the two have to
 * agree about the grid, so both ask atlasGrid() rather than each working it out.
 *
 * A d6 gets pips, because that is what a six-sided die has; everything else gets a
 * numeral, because twenty pips is not a die face. Numerals that can be read upside
 * down are underlined, the way real dice mark them.
 */
export function dieAtlasTexture(
  sides: number,
  cells: { label: string; fit: number }[],
  colorId: string,
): THREE.Texture {
  const key = `__die:${sides}:${colorId}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const { cols, rows } = atlasGrid(cells.length);
  // Enough that a d20's twenty cells are still sharp when one fills the screen.
  const cell = 256;
  const [c, ctx] = canvas(cols * cell, rows * cell);
  const paint = dieColor(colorId);

  cells.forEach(({ label, fit }, i) => {
    const x = (i % cols) * cell;
    const y = Math.floor(i / cols) * cell;

    // A radial fall-off per cell reads as a moulded face catching the light. A flat
    // fill reads as a sticker.
    const g = ctx.createRadialGradient(x + cell * 0.38, y + cell * 0.34, cell * 0.04,
      x + cell / 2, y + cell / 2, cell * 0.72);
    g.addColorStop(0, shade(paint.body, 0.24));
    g.addColorStop(0.62, paint.body);
    g.addColorStop(1, shade(paint.body, -0.24));
    ctx.fillStyle = g;
    ctx.fillRect(x, y, cell, cell);

    ctx.save();
    // Clipped to its own cell. A numeral that overruns bleeds into the neighbouring
    // cell, and the face sampling that cell then shows two numbers at once — which is
    // exactly what a d4 printed with a 4 and half a 7 looked like.
    ctx.beginPath();
    ctx.rect(x, y, cell, cell);
    ctx.clip();
    ctx.translate(x, y);
    ctx.fillStyle = paint.ink;

    const pips = sides === 6 ? PIPS[Number(label)] : undefined;
    if (pips) {
      const r = cell * fit * FACE_FILL * 0.15;
      for (const [px, py] of pips) {
        ctx.beginPath();
        ctx.arc(px * cell, py * cell, r, 0, Math.PI * 2);
        ctx.fill();
        // A pip is drilled into the face, not printed on it: one highlight along the
        // top edge is the whole of that impression.
        ctx.save();
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(px * cell - r * 0.22, py * cell - r * 0.26, r * 0.62, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = paint.ink;
      }
    } else {
      /**
       * Sized to the circle that actually fits on the face.
       *
       * The unwrap maps the face's circumradius to half the cell (less FACE_FILL), so
       * the inscribed circle lands at `fit` of that — and a numeral drawn to the full
       * cell runs well past the edges of a triangle. Two digits are wider than they
       * are tall, so they get a shorter cap to keep the pair inside the same circle.
       */
      const room = cell * fit * FACE_FILL;
      const size = label.length > 1 ? room * 0.66 : room * 0.95;
      ctx.font = `700 ${size}px Helvetica, Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, cell / 2, cell * 0.5);
      // 6 and 9 are the same numeral upside down, so dice underline them. So do we.
      if (label === '6' || label === '9') {
        const w = ctx.measureText(label).width;
        ctx.fillRect(cell / 2 - w / 2, cell * 0.5 + size * 0.42, w, Math.max(3, size * 0.075));
      }
    }
    ctx.restore();
  });

  const tex = finish(c);
  cache.set(key, tex);
  return tex;
}

/** Build the canvas for a face. Shared by the 3D texture path and the 2D hand tray. */
function renderFace(src: FaceSource): HTMLCanvasElement {
  switch (src.type) {
    case 'generated': {
      const p = src.params ?? {};
      if (src.generator === 'playing-card') {
        return p.back ? drawCardBack() : drawPlayingCard(String(p.rank ?? 'A'), String(p.suit ?? 'S'));
      }
      if (src.generator === 'chip') return drawChip(Number(p.value ?? 1), String(p.color ?? '#c0392b'));
      if (src.generator === 'die') return drawBlank(dieColor(defaultDieColor(Number(p.sides ?? 6))).body);
      if (src.generator === 'chess') return drawBlank(String(p.color) === 'w' ? '#efe7d8' : '#2a2a30');
      return drawBlank(String(p.color ?? '#888'));
    }
    case 'text':
      return drawTextFace(src.text, src.bg ?? '#f7f4ec', src.fg ?? '#16161a', src.fontScale ?? 1);
    default:
      return drawBlank('#888');
  }
}

/** Resolve a pack FaceSource into a cached texture. */
export function faceTexture(key: string, src: FaceSource | undefined): THREE.Texture | null {
  if (!src) return null;
  const hit = cache.get(key);
  if (hit) return hit;

  if (src.type === 'image') {
    // Draw the supplied bitmap once it decodes; the texture updates in place.
    const [c2, ctx2] = canvas(CARD_PX_W, CARD_PX_H);
    ctx2.fillStyle = '#20202a';
    ctx2.fillRect(0, 0, CARD_PX_W, CARD_PX_H);
    const tex = finish(c2);
    const img = new Image();
    img.onload = () => { ctx2.drawImage(img, 0, 0, CARD_PX_W, CARD_PX_H); tex.needsUpdate = true; };
    img.src = src.dataUri;
    cache.set(key, tex);
    return tex;
  }

  const tex = finish(renderFace(src));
  cache.set(key, tex);
  return tex;
}

const imageCache = new Map<string, string>();

/**
 * A face as a data URL, for the HTML hand tray.
 *
 * The tray exists because reading your own cards off an angled 3D table is miserable
 * on a phone. It shows the same artwork, drawn by the same code.
 */
export function faceImage(key: string, src: FaceSource | undefined): string {
  if (!src) return '';
  const hit = imageCache.get(key);
  if (hit) return hit;
  if (src.type === 'image') { imageCache.set(key, src.dataUri); return src.dataUri; }
  const url = renderFace(src).toDataURL('image/png');
  imageCache.set(key, url);
  return url;
}

/** The card back as a data URL. */
export function backImage(): string {
  const hit = imageCache.get('__backimg');
  if (hit) return hit;
  const url = drawCardBack().toDataURL('image/png');
  imageCache.set('__backimg', url);
  return url;
}

/** The shared card back, used for every face-down card regardless of pack. */
export function defaultBackTexture(): THREE.Texture {
  const hit = cache.get('__back');
  if (hit) return hit;
  const tex = finish(drawCardBack());
  cache.set('__back', tex);
  return tex;
}

/**
 * The table surface.
 *
 * The felt used to be a single flat colour, which is the one thing a real table never
 * is: baize is woven, it soaks up light, and it falls off towards the edges. Three
 * cheap layers fix that — broad mottling, per-pixel grain, and a vignette — and the
 * middle of the table stops competing with the pieces sitting on it.
 *
 * The noise is seeded rather than Math.random: an e2e screenshot of the table should
 * differ between runs only when something actually changed.
 */
export function feltTexture(color: string): THREE.Texture {
  const key = `__felt:${color}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const W = 1536, H = 1056;
  const [c, ctx] = canvas(W, H);
  let seed = 0x9e3779b9;
  const rnd = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return ((seed >>> 0) % 100000) / 100000;
  };

  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);

  // Broad, very faint patches. Real baize is never one tone across two metres.
  for (let i = 0; i < 90; i++) {
    const x = rnd() * W, y = rnd() * H, r = 60 + rnd() * 220;
    const up = rnd() > 0.5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, up ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.045)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Per-pixel grain, so the surface has a weave at close camera distances.
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 9;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);

  // Vignette. Baked into the texture rather than added as an overlay mesh: the felt
  // covers exactly this texture, so one draw call does the whole job.
  const v = ctx.createRadialGradient(W / 2, H * 0.44, Math.min(W, H) * 0.14, W / 2, H / 2, W * 0.63);
  v.addColorStop(0, 'rgba(255,255,255,0.05)');
  v.addColorStop(0.55, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.34)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);

  const tex = finish(c);
  cache.set(key, tex);
  return tex;
}

/**
 * The marker for a zone.
 *
 * Zones used to be drawn as flat translucent rectangles, which on felt read as grey
 * slabs someone had left on the table — hard-edged, uniform, and visually louder than
 * the pieces they were meant to be behind. This is a faint fill inside a bright inset
 * border, which is how a marked-out area on a real table looks.
 *
 * White, so the material's own colour tints it. The corner radius is small enough that
 * a very wide zone stretching it into an ellipse is not noticeable.
 */
export function zoneTexture(): THREE.Texture {
  const hit = cache.get('__zone');
  if (hit) return hit;

  const S = 256;
  const [c, ctx] = canvas(S, S);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';

  // A whisper of fill, not a slab. A pack like Hold'em has fifteen zones, and at 0.3
  // the felt disappeared under a patchwork of pale rectangles — the border is what
  // says where a zone is, the fill only has to keep it from being a bare outline.
  ctx.globalAlpha = 0.09;
  roundRect(ctx, 5, 5, S - 10, S - 10, 12);
  ctx.fill();

  ctx.globalAlpha = 1;
  ctx.lineWidth = 4;
  roundRect(ctx, 9, 9, S - 18, S - 18, 10);
  ctx.stroke();

  const tex = finish(c);
  cache.set('__zone', tex);
  return tex;
}

/**
 * A checkerboard for grid zones.
 *
 * One pixel per cell with nearest-neighbour filtering, so the squares stay crisp at any
 * size. A chess board drawn as bare gridlines is genuinely hard to read a diagonal on.
 */
export function checkerTexture(cols: number, rows: number, light = '#d8c9a8', dark = '#8a6b4a'): THREE.Texture {
  const key = `__checker${cols}x${rows}:${light}:${dark}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const [c, ctx] = canvas(Math.max(1, cols), Math.max(1, rows));
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? light : dark;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

