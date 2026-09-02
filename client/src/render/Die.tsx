/**
 * A die, and the way it moves.
 *
 * Separate from Piece because it is the one piece on the table that animates. A roll is
 * not an instant change of state to a player — it is a thing that happens and then
 * settles — and a die that simply blinks from a 3 to a 17 reads as a bug rather than as
 * a roll. So the number the server rolled is the number the die lands on, and it gets
 * there by tumbling.
 *
 * Everything driving the animation is in shared state — the value, the spin and the
 * roll counter — so every player at the table watches the same die land the same way
 * up at the same moment, without a single message about the animation itself.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { dieShape, orientationFor } from './dice';

interface Props {
  sides: number;
  /** The face the server rolled, 1-based. */
  value: number;
  /** Bumped by the server on each roll; a change is what starts the tumble. */
  rollSeq: number;
  /** The spin the server chose to go with the roll, so all clients agree. */
  spin: number;
  /** Suppressed while the piece is being dragged, so a shake does not fight the hand. */
  settled: boolean;
  children: React.ReactNode;
}

/** How long a roll takes to come to rest. Long enough to read as a throw, not a stutter. */
const TUMBLE_MS = 780;

/** Axis the die spins about while in the air. Off-vertical so it reads as a tumble. */
const TUMBLE_AXIS = new THREE.Vector3(0.62, 0.5, 0.6).normalize();

/** Ease-out. Fast off the hand, slow into the felt, which is how a thrown die behaves. */
function settle(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function Die({ sides, value, rollSeq, spin, settled, children }: Props) {
  const group = useRef<THREE.Group>(null);
  const shape = useMemo(() => dieShape(sides), [sides]);

  /** Where the die is meant to end up: the rolled face up, turned by the server's spin. */
  const target = useMemo(
    () => orientationFor(shape, value, spin),
    [shape, value, spin],
  );

  /** The roll in flight, or null when the die is at rest. */
  const roll = useRef<{ from: THREE.Quaternion; start: number } | null>(null);
  const seen = useRef(rollSeq);
  const first = useRef(true);

  useEffect(() => {
    // A die already on the table when you join has a roll count from before you
    // arrived. Joining a room is not something to animate.
    if (first.current) {
      first.current = false;
      seen.current = rollSeq;
      return;
    }
    if (rollSeq === seen.current) return;
    seen.current = rollSeq;
    const from = group.current?.quaternion.clone() ?? new THREE.Quaternion();
    roll.current = { from, start: performance.now() };
  }, [rollSeq]);

  useFrame(() => {
    const g = group.current;
    if (!g) return;

    const inFlight = roll.current;
    if (!inFlight) {
      // Not rolling: ease towards the orientation the state says, rather than snapping.
      // A die nudged by someone else's drag then turns rather than teleporting.
      g.quaternion.slerp(target, settled ? 0.25 : 0.5);
      return;
    }

    const t = Math.min(1, (performance.now() - inFlight.start) / TUMBLE_MS);
    if (t >= 1) {
      roll.current = null;
      g.quaternion.copy(target);
      return;
    }

    // Spin hard, then blend into the landing. The blend is what makes the die arrive on
    // the right face instead of stopping wherever the spin happened to leave it.
    const spun = new THREE.Quaternion()
      .setFromAxisAngle(TUMBLE_AXIS, settle(t) * Math.PI * 6)
      .multiply(inFlight.from);
    g.quaternion.copy(spun).slerp(target, settle(t));
  });

  return <group ref={group}>{children}</group>;
}
