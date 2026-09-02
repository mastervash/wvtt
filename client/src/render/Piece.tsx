/**
 * One piece on the table.
 *
 * A piece renders its face only if the client actually received the identity. When the
 * server withholds a secret there is nothing to render but the back — the client has
 * no fallback and no way to guess, which is the whole point.
 */

import { memo, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { ComponentDef } from '@wvtt/shared';
import type { Snapshot } from '../net/store';
import { materialsFor } from './materials';
import { cardGeometry, chipGeometry, tokenGeometry, tileGeometry, chessGeometry } from './geometry';
import { dieShape } from './dice';
import { Die } from './Die';

type PieceData = Snapshot['pieces'][string];

interface Props {
  piece: PieceData;
  /** False on the fastest quality setting, where the scene has no shadows at all. */
  shadows: boolean;
  def: ComponentDef | undefined;
  /**
   * Whether this client may read the piece — not merely whether it happens to hold its
   * identity. See canRead() in the store.
   */
  readable: boolean;
  heldByOther: boolean;
  selected: boolean;
  /** Under the pointer, and therefore what a keyboard shortcut would act on. */
  hovered: boolean;
  onPointerDown: (e: any, id: string) => void;
  /** The drag handlers, which have to live on the piece itself. See Table.tsx. */
  onPointerMove?: (e: any) => void;
  onPointerUp?: (e: any) => void;
  onPointerOver?: (e: any, id: string) => void;
  onPointerOut?: (e: any, id: string) => void;
  onContextMenu?: (e: any) => void;
}

/** Lift a held piece off the table so it reads as picked up. */
const HELD_LIFT = 0.35;

/** …and tip it towards the viewer, which is what actually sells the gesture. */
const HELD_TILT = -0.22;

/** Clearance above the felt so pieces never z-fight with zone overlays. */
const BASE_LIFT = 0.008;

function PieceBase({
  piece, def, heldByOther, selected, hovered, readable, shadows,
  onPointerDown, onPointerMove, onPointerUp, onPointerOver, onPointerOut, onContextMenu,
}: Props) {
  const group = useRef<THREE.Group>(null);

  const materials = materialsFor({
    def,
    tint: piece.tint ?? '',
    kind: def?.kind ?? piece.kind,
    // A card in a hand you do not own is drawn face down whatever its flag says. The
    // server sets faceUp on cards entering a hand so their owner can read them off the
    // table; everyone else must see a back.
    faceUp: piece.faceUp && readable,
    known: readable,
  });

  const geometry = useMemo(() => {
    const kind = def?.kind ?? piece.kind;
    switch (kind) {
      case 'card': return cardGeometry(def?.w, def?.h, def?.d);
      case 'tile': return tileGeometry(def?.w, def?.h, def?.d);
      case 'chip': return chipGeometry((def?.w ?? 0.32) / 2, def?.d ?? 0.045);
      case 'token': return tokenGeometry((def?.w ?? 0.28) / 2, def?.d ?? 0.12);
      case 'die': return dieShape(def?.sides ?? 6).geometry;
      case 'piece': return chessGeometry(String(def?.data?.piece ?? 'p'));
      default: return cardGeometry();
    }
  }, [def, piece.kind]);

  const held = !!piece.heldBy;
  // Sit just clear of the felt and the zone overlays drawn on it.
  const y = piece.y + BASE_LIFT + (held ? HELD_LIFT : 0);
  const kind = def?.kind ?? piece.kind;
  // Flat pieces sit on the table; upright pieces are modelled from their base.
  const flat = kind === 'card' || kind === 'tile';
  const isDie = kind === 'die';
  /**
   * How far to lift the mesh so it rests ON the felt rather than through it.
   *
   * Asked of the geometry rather than kept as a table of per-kind constants, because
   * the constants were wrong for anything the author had not thought about. A card is
   * modelled about its middle and a chess piece from its base, which the old two-case
   * rule got right; a die and a chip are modelled about their centres, which it did
   * not, so both sat buried to the waist in the table until somebody picked them up.
   * The bounding box knows how far below the origin a shape reaches, for every kind
   * there is and every kind a pack invents later.
   */
  const yOffset = useMemo(() => {
    geometry.computeBoundingBox();
    return Math.max(0, -(geometry.boundingBox?.min.y ?? 0));
  }, [geometry]);
  // A held card tips towards the person holding it, the way one does in a real hand.
  // Height alone reads as "floating"; the tilt is what reads as "picked up".
  const tilt = held && flat ? HELD_TILT : 0;

  const body = (
    <>
      <mesh
        geometry={geometry}
        material={materials as THREE.Material | THREE.Material[]}
        castShadow={shadows}
        receiveShadow={shadows}
      />
      {(selected || heldByOther || hovered) && (
        <mesh geometry={geometry} scale={selected || heldByOther ? 1.055 : 1.03}>
          {/* An outline, not a wash. Drawing the shell's BACK faces leaves only the
              rim that sticks out past the piece — the front faces are hidden by the
              piece itself — so the artwork underneath stays readable. The previous
              front-facing translucent copy tinted the whole card, which made a
              selected face-up card noticeably harder to read than an unselected one.

              Hover is drawn fainter and tighter than a grab: it is a hint about what
              a key press would hit, not a claim that anybody is holding the piece. */}
          <meshBasicMaterial
            color={heldByOther ? '#ff9f43' : selected ? '#5ac8fa' : '#ffffff'}
            side={THREE.BackSide}
            transparent
            opacity={selected || heldByOther ? 0.9 : 0.5}
            depthWrite={false}
          />
        </mesh>
      )}
    </>
  );

  return (
    <group
      ref={group}
      position={[piece.x, y + yOffset, piece.z]}
      onPointerDown={(e) => onPointerDown(e, piece.id)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerOver={(e) => onPointerOver?.(e, piece.id)}
      onPointerOut={(e) => onPointerOut?.(e, piece.id)}
      onContextMenu={onContextMenu}
    >
      {/* A die owns its own orientation: it has to land with the rolled number facing
          up, and it gets there by tumbling rather than by snapping. Everything else
          takes the rotation straight from the table. */}
      {isDie ? (
        <Die
          sides={def?.sides ?? 6}
          value={piece.secret?.value ?? 1}
          rollSeq={piece.rollSeq ?? 0}
          spin={piece.rotY}
          settled={!held}
        >
          {body}
        </Die>
      ) : (
        <group rotation={[tilt, piece.rotY, 0]}>{body}</group>
      )}
    </group>
  );
}

/**
 * Whether a re-render can be skipped.
 *
 * The snapshot is rebuilt by copying the whole room, so every piece arrives as a BRAND
 * NEW object on every sync even when nothing about it changed. A default shallow
 * comparison therefore never matches and all hundred-odd pieces re-render several times
 * a second — which is what made a big table crawl on slower machines. Comparing the
 * handful of fields that actually affect what is drawn costs a few primitive
 * comparisons and skips almost all of that work.
 *
 * Handler identity is deliberately ignored: the callbacks are recreated on every parent
 * render but always do the same thing.
 */
function samePiece(a: Props, b: Props): boolean {
  if (a.def !== b.def
    || a.heldByOther !== b.heldByOther
    || a.selected !== b.selected
    || a.hovered !== b.hovered
    || a.readable !== b.readable
    || a.shadows !== b.shadows) return false;

  const p = a.piece;
  const q = b.piece;
  return p.id === q.id
    && p.x === q.x && p.y === q.y && p.z === q.z
    && p.rotY === q.rotY
    && p.faceUp === q.faceUp
    && p.kind === q.kind
    && p.defId === q.defId
    && p.stackId === q.stackId
    && p.zoneId === q.zoneId
    && p.heldBy === q.heldBy
    && p.locked === q.locked
    && p.tint === q.tint
    && p.rollSeq === q.rollSeq
    && p.secret?.face === q.secret?.face
    && p.secret?.value === q.secret?.value;
}

export const Piece = memo(PieceBase, samePiece);
