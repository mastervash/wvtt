/**
 * Pack validation.
 *
 * A pack arriving over the wire is fully untrusted input: anyone in a room can paste
 * one. Before it is allowed to build a table it must be proven well-formed and within
 * resource limits, because a pack is otherwise a very convenient way to ask the server
 * to allocate a million pieces or hold a 50 MB string in memory.
 *
 * This validates SHAPE and SIZE. It deliberately does not try to judge whether a
 * script is well-behaved — that is the isolate's job, and trying to detect hostile
 * script by inspection is a losing game.
 */

import type { PackValidation, GamePack } from '@wvtt/shared';
import { PACK_FORMAT_VERSION } from '@wvtt/shared';

const LIMITS = {
  components: 500,
  zones: 64,
  setup: 256,
  scriptBytes: 64 * 1024,
  dataUriBytes: 256 * 1024,
  totalBytes: 4 * 1024 * 1024,
  stringField: 2000,
  /** Cap on how many pieces the setup may put on the table. */
  totalPieces: 800,
};

/** Accepted image data URIs: raster formats only, deliberately excluding SVG. */
const RASTER_IMAGE = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/;

const VALID_KINDS = new Set(['card', 'chip', 'die', 'token', 'piece', 'tile', 'note']);
const VALID_ZONE_VIS = new Set(['public', 'owner', 'hidden', 'inherit']);
const VALID_LAYOUTS = new Set(['free', 'row', 'fan', 'grid', 'stack']);
const VALID_ENFORCEMENT = new Set(['off', 'advisory', 'enforced']);

export function validatePack(input: unknown): PackValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const bail = () => ({ ok: false, errors, warnings });

  if (!input || typeof input !== 'object') {
    errors.push('Pack must be a JSON object.');
    return bail();
  }

  // Reject oversized blobs before doing any deeper work.
  let approxBytes = 0;
  try {
    approxBytes = Buffer.byteLength(JSON.stringify(input), 'utf8');
  } catch {
    errors.push('Pack contains circular references.');
    return bail();
  }
  if (approxBytes > LIMITS.totalBytes) {
    errors.push(`Pack is ${(approxBytes / 1024 / 1024).toFixed(1)} MB; the limit is ${LIMITS.totalBytes / 1024 / 1024} MB.`);
    return bail();
  }

  const pack = input as Partial<GamePack>;
  const m = pack.manifest;

  if (!m || typeof m !== 'object') {
    errors.push('Pack is missing its manifest.');
    return bail();
  }
  if (m.formatVersion !== PACK_FORMAT_VERSION) {
    errors.push(`Pack format version ${m.formatVersion} is not supported (this server speaks version ${PACK_FORMAT_VERSION}).`);
  }
  for (const field of ['id', 'name', 'author', 'description'] as const) {
    const v = m[field];
    if (typeof v !== 'string' || v.length === 0) errors.push(`manifest.${field} must be a non-empty string.`);
    else if (v.length > LIMITS.stringField) errors.push(`manifest.${field} is too long.`);
  }
  if (!Number.isInteger(m.minSeats) || m.minSeats < 1 || m.minSeats > 12) errors.push('manifest.minSeats must be 1-12.');
  if (!Number.isInteger(m.maxSeats) || m.maxSeats < 1 || m.maxSeats > 12) errors.push('manifest.maxSeats must be 1-12.');
  if (Number.isInteger(m.minSeats) && Number.isInteger(m.maxSeats) && m.minSeats! > m.maxSeats!) {
    errors.push('manifest.minSeats cannot exceed manifest.maxSeats.');
  }
  if (!VALID_ENFORCEMENT.has(m.defaultEnforcement as string)) {
    errors.push('manifest.defaultEnforcement must be off, advisory or enforced.');
  }
  if (m.actions !== undefined) {
    if (!Array.isArray(m.actions)) {
      errors.push('manifest.actions must be an array.');
    } else if (m.actions.length > 12) {
      errors.push(`manifest.actions has ${m.actions.length} entries; the limit is 12.`);
    } else {
      m.actions.forEach((a, i) => {
        if (!a || typeof a !== 'object') return errors.push(`manifest.actions[${i}] is not an object.`);
        if (typeof a.id !== 'string' || !a.id || a.id.length > 64) errors.push(`manifest.actions[${i}].id must be a string of up to 64 characters.`);
        if (typeof a.label !== 'string' || !a.label || a.label.length > 40) errors.push(`manifest.actions[${i}].label must be a string of up to 40 characters.`);
      });
    }
  }

  /* components */
  if (!Array.isArray(pack.components)) {
    errors.push('Pack must have a components array.');
  } else if (pack.components.length > LIMITS.components) {
    errors.push(`Pack defines ${pack.components.length} components; the limit is ${LIMITS.components}.`);
  } else {
    const seen = new Set<string>();
    pack.components.forEach((c, i) => {
      if (!c || typeof c !== 'object') return errors.push(`components[${i}] is not an object.`);
      if (typeof c.id !== 'string' || !c.id) return errors.push(`components[${i}].id must be a non-empty string.`);
      if (seen.has(c.id)) errors.push(`Duplicate component id "${c.id}".`);
      seen.add(c.id);
      if (!VALID_KINDS.has(c.kind)) errors.push(`components[${i}].kind "${c.kind}" is not a known kind.`);
      if (c.sides !== undefined && (!Number.isInteger(c.sides) || c.sides < 2 || c.sides > 1000)) {
        errors.push(`components[${i}].sides must be an integer between 2 and 1000.`);
      }
      for (const face of [c.front, c.back]) {
        if (!face) continue;
        if (face.type === 'image') {
          // Raster formats only. SVG is a document format that can carry script and
          // external references; nothing about a playing card needs it.
          if (typeof face.dataUri !== 'string' || !RASTER_IMAGE.test(face.dataUri)) {
            errors.push(`components[${i}] image face must be a PNG, JPEG, WebP or GIF data URI.`);
          } else if (Buffer.byteLength(face.dataUri, 'utf8') > LIMITS.dataUriBytes) {
            errors.push(`components[${i}] image is larger than ${LIMITS.dataUriBytes / 1024} KB.`);
          }
        } else if (face.type === 'text') {
          if (typeof face.text !== 'string' || face.text.length > LIMITS.stringField) {
            errors.push(`components[${i}] text face is missing or too long.`);
          }
        }
      }
    });
  }

  /* zones */
  const zoneIds = new Set<string>();
  if (!Array.isArray(pack.zones)) {
    errors.push('Pack must have a zones array.');
  } else if (pack.zones.length > LIMITS.zones) {
    errors.push(`Pack defines ${pack.zones.length} zones; the limit is ${LIMITS.zones}.`);
  } else {
    pack.zones.forEach((z, i) => {
      if (!z || typeof z !== 'object') return errors.push(`zones[${i}] is not an object.`);
      if (typeof z.id !== 'string' || !z.id) return errors.push(`zones[${i}].id must be a non-empty string.`);
      if (zoneIds.has(z.id)) errors.push(`Duplicate zone id "${z.id}".`);
      zoneIds.add(z.id);
      if (!VALID_ZONE_VIS.has(z.visibility)) errors.push(`zones[${i}].visibility "${z.visibility}" is not valid.`);
      if (!VALID_LAYOUTS.has(z.layout)) errors.push(`zones[${i}].layout "${z.layout}" is not valid.`);
      for (const n of ['x', 'z', 'w', 'h'] as const) {
        if (!Number.isFinite(z[n]) || Math.abs(z[n]) > 100) errors.push(`zones[${i}].${n} is out of range.`);
      }
      if (z.layout === 'grid') {
        const cols = z.gridCols ?? 0, rows = z.gridRows ?? 0;
        if (!Number.isInteger(cols) || cols < 1 || cols > 64) errors.push(`zones[${i}].gridCols must be 1-64.`);
        if (!Number.isInteger(rows) || rows < 1 || rows > 64) errors.push(`zones[${i}].gridRows must be 1-64.`);
      }
    });
  }

  /* setup */
  if (!Array.isArray(pack.setup)) {
    errors.push('Pack must have a setup array.');
  } else if (pack.setup.length > LIMITS.setup) {
    errors.push(`Pack has ${pack.setup.length} setup steps; the limit is ${LIMITS.setup}.`);
  } else {
    let estimatedPieces = 0;
    pack.setup.forEach((s, i) => {
      if (!s || typeof s !== 'object') return errors.push(`setup[${i}] is not an object.`);
      if (!Array.isArray(s.componentIds)) return errors.push(`setup[${i}].componentIds must be an array.`);
      for (const raw of s.componentIds) {
        if (typeof raw !== 'string') { errors.push(`setup[${i}].componentIds must contain strings.`); continue; }
        if (raw.startsWith('repeat:')) {
          const n = parseInt(raw.split(':')[2] ?? '1', 10) || 0;
          if (n > 200) errors.push(`setup[${i}] repeats a component ${n} times; the limit is 200.`);
          estimatedPieces += Math.min(n, 200);
        } else if (raw.startsWith('deck:')) {
          estimatedPieces += 54;
        } else {
          estimatedPieces += 1;
        }
      }
      // A per-seat placement multiplies across the table.
      if (s.perSeat) estimatedPieces *= 1; // counted once; seats are capped at 12 anyway
      if (s.zoneId != null && typeof s.zoneId !== 'string') errors.push(`setup[${i}].zoneId must be a string or null.`);
      if (typeof s.zoneId === 'string' && s.zoneId && !s.zoneId.includes('{seat}') && !zoneIds.has(s.zoneId)) {
        warnings.push(`setup[${i}] refers to zone "${s.zoneId}", which the pack does not define.`);
      }
    });
    if (estimatedPieces * 12 > LIMITS.totalPieces * 12) {
      // Only flag when a single seat's worth already blows the budget.
      if (estimatedPieces > LIMITS.totalPieces) {
        errors.push(`Setup would create about ${estimatedPieces} pieces; the limit is ${LIMITS.totalPieces}.`);
      }
    }
  }

  /* script */
  if (pack.script !== undefined) {
    if (typeof pack.script !== 'string') {
      errors.push('Pack script must be a string.');
    } else if (Buffer.byteLength(pack.script, 'utf8') > LIMITS.scriptBytes) {
      errors.push(`Script is larger than ${LIMITS.scriptBytes / 1024} KB.`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export const PACK_LIMITS = LIMITS;
