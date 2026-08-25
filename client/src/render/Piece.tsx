/**
 * One piece on the table.
 *
 * A piece renders its face only if the client actually received the identity. When the
 * server withholds a secret there is nothing to render but the back — the client has
 * no fallback and no way to guess, which is the whole point.
 */

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { ComponentDef } from '@wvtt/shared';
import type { Snapshot } from '../net/store';
import { materialsFor } from './materials';
import { cardGeometry, chipGeometry, dieGeometry, tokenGeometry, tileGeometry, chessGeometry } from './geometry';

type PieceData = Snapshot['pieces'][string];

interface Props {
  piece: PieceData;
  def: ComponentDef | undefined;
  heldByOther: boolean;
  selected: boolean;
  onPointerDown: (e: any, id: string) => void;
  onContextMenu?: (e: any) => void;
}

/** Lift a held piece off the table so it reads as picked up. */
const HELD_LIFT = 0.35;

/** Clearance above the felt so pieces never z-fight with zone overlays. */
const BASE_LIFT = 0.008;

export function Piece({ piece, def, heldByOther, selected, onPointerDown, onContextMenu }: Props) {
  const group = useRef<THREE.Group>(null);
  const known = piece.secret?.face;

  const materials = materialsFor({
    def,
    kind: def?.kind ?? piece.kind,
    faceUp: piece.faceUp,
    known: !!known,
    dieValue: piece.secret?.value,
  });

  const geometry = useMemo(() => {
    const kind = def?.kind ?? piece.kind;
    switch (kind) {
      case 'card': return cardGeometry(def?.w, def?.h, def?.d);
      case 'tile': return tileGeometry(def?.w, def?.h, def?.d);
      case 'chip': return chipGeometry((def?.w ?? 0.32) / 2, def?.d ?? 0.045);
      case 'token': return tokenGeometry((def?.w ?? 0.28) / 2, def?.d ?? 0.12);
      case 'die': return dieGeometry(def?.sides ?? 6);
      case 'piece': return chessGeometry(String(def?.data?.piece ?? 'p'));
      default: return cardGeometry();
    }
  }, [def, piece.kind]);

  const held = !!piece.heldBy;
  // Sit just clear of the felt and the zone overlays drawn on it.
  const y = piece.y + BASE_LIFT + (held ? HELD_LIFT : 0);
  const kind = def?.kind ?? piece.kind;
  // Flat pieces sit on the table; upright pieces are modelled from their base.
  const yOffset = kind === 'card' || kind === 'tile' ? (def?.d ?? 0.006) / 2 : 0;

  return (
    <group
      ref={group}
      position={[piece.x, y + yOffset, piece.z]}
      rotation={[0, piece.rotY, 0]}
      onPointerDown={(e) => onPointerDown(e, piece.id)}
      onContextMenu={onContextMenu}
    >
      <mesh
        geometry={geometry}
        material={materials as THREE.Material | THREE.Material[]}
        castShadow
        receiveShadow
      />
      {(selected || heldByOther) && (
        <mesh geometry={geometry} scale={1.06}>
          <meshBasicMaterial
            color={heldByOther ? '#ff9f43' : '#5ac8fa'}
            transparent
            opacity={0.28}
            depthWrite={false}
          />
        </mesh>
      )}
    </group>
  );
}
