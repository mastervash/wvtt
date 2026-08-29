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

  ctx.fillStyle = '#fbfaf6';
  roundRect(ctx, 4, 4, CARD_PX_W - 8, CARD_PX_H - 8, 22);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 2;
  ctx.stroke();

  if (rank === 'X') {
    ctx.fillStyle = color;
    ctx.font = 'bold 44px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('JOKER', CARD_PX_W / 2, CARD_PX_H / 2 - 10);
    ctx.font = '90px Georgia, serif';
    ctx.fillText('★', CARD_PX_W / 2, CARD_PX_H / 2 + 90);
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
    ctx.globalAlpha = 0.08;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    roundRect(ctx, innerX, innerY, innerW, innerH, 12);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.font = 'bold 116px Georgia, serif';
    ctx.fillText(rank, CARD_PX_W / 2, CARD_PX_H / 2 + 16);
    ctx.font = '52px Georgia, serif';
    ctx.fillText(glyph, CARD_PX_W / 2, CARD_PX_H / 2 + 84);
    return c;
  }

  if (rank === 'A') {
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.font = '170px Georgia, serif';
    ctx.fillText(glyph, CARD_PX_W / 2, CARD_PX_H / 2 + 62);
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
  ctx.fillStyle = '#2b4a7a';
  ctx.fillRect(16, 16, CARD_PX_W - 32, CARD_PX_H - 32);
  // Diagonal lattice.
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 3;
  for (let i = -CARD_PX_H; i < CARD_PX_W + CARD_PX_H; i += 22) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + CARD_PX_H, CARD_PX_H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(i, CARD_PX_H); ctx.lineTo(i + CARD_PX_H, 0); ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 2;
  roundRect(ctx, 4, 4, CARD_PX_W - 8, CARD_PX_H - 8, 22);
  ctx.stroke();
  return c;
}

function drawChip(value: number, color: string): HTMLCanvasElement {
  const size = 256;
  const [c, ctx] = canvas(size, size);
  const r = size / 2;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(r, r, r - 4, 0, Math.PI * 2); ctx.fill();

  // Edge spots, the way real chips are marked.
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.save();
    ctx.translate(r + Math.cos(a) * (r - 22), r + Math.sin(a) * (r - 22));
    ctx.rotate(a);
    ctx.fillRect(-16, -9, 32, 18);
    ctx.restore();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath(); ctx.arc(r, r, r - 52, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = '#16161a';
  ctx.textAlign = 'center';
  ctx.font = `bold ${value >= 100 ? 62 : 76}px Helvetica, Arial, sans-serif`;
  ctx.fillText(String(value), r, r + 26);
  return c;
}

function drawTextFace(text: string, bg: string, fg: string, fontScale = 1): HTMLCanvasElement {
  const [c, ctx] = canvas(CARD_PX_W, CARD_PX_H);
  ctx.fillStyle = bg;
  roundRect(ctx, 4, 4, CARD_PX_W - 8, CARD_PX_H - 8, 22);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 2;
  ctx.stroke();

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
 * The body of an unrolled die.
 *
 * Deliberately plain. Text painted here is stretched across every face of a
 * polyhedron by the UV mapping, so it can never be read reliably; the die's value is
 * shown on a billboard above it instead. What this needs to do is look like a die and
 * stay distinguishable at a glance, which a tinted body with a subtle edge does.
 */
const DIE_TINTS: Record<number, string> = {
  4: '#e9dcc0', 6: '#f2efe6', 8: '#d8e3ef', 10: '#e7dcef',
  12: '#dcefe1', 20: '#efdcdc', 100: '#e2e2ea',
};

function drawDieFace(sides: number): HTMLCanvasElement {
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = DIE_TINTS[sides] ?? '#f2efe6';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 8;
  ctx.strokeRect(0, 0, 128, 128);
  return c;
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
      if (src.generator === 'die') return drawDieFace(Number(p.sides ?? 6));
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

