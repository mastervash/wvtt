/**
 * The 3D table.
 *
 * Owns the scene, the camera framing and all pointer interaction. Dragging is
 * predictive-free: the client sends move requests and renders whatever the server
 * confirms, so two players grabbing the same card can never disagree about where it
 * ended up.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { ComponentDef } from '@wvtt/shared';
import { useStore, useMySeat, type Snapshot } from '../net/store';
import { Piece } from './Piece';
import { checkerTexture } from './faces';

const TABLE_W = 16;
const TABLE_H = 11;
/**
 * The region the camera tries to keep on screen: wide enough for the deck, the play
 * area and your own hand, but deliberately narrower than the whole table. Fitting all
 * 16 units of width onto a portrait phone would push the camera so far back that cards
 * became unreadable, so the far corners are left off screen for players to pan to.
 */
const VIEW_W = 8.5;
const VIEW_D = 9.5;

/**
 * Handle to the scene's recenter function.
 *
 * The HUD lives outside the Canvas, so it cannot hold a ref into the scene graph. A
 * module-level slot is the simplest way to let a button reach in; there is only ever
 * one table on screen.
 */
const recenterRef: { current: (() => void) | null } = { current: null };

export function recenterCamera(): void {
  recenterRef.current?.();
}
/** Cap on how often drag positions go to the server. */
const MOVE_HZ = 30;

export function Table() {
  const tableColor = useStore((s) => s.snap.tableColor);
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ fov: 42, position: [0, 8, 11], near: 0.1, far: 100 }}
      style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <color attach="background" args={['#0d1014']} />
      <ambientLight intensity={0.9} />
      <hemisphereLight intensity={1.1} groundColor="#2a2a33" />
      <directionalLight
        position={[6, 12, 6]}
        intensity={2.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
      />
      <Felt color={tableColor} />
      <Scene />
    </Canvas>
  );
}

function Felt({ color }: { color: string }) {
  return (
    <group>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[TABLE_W, TABLE_H]} />
        <meshStandardMaterial color={color} roughness={0.95} />
      </mesh>
      {/* A rim, so the table reads as an object rather than an infinite plane. Its top
          face must stay below the felt or it hides it. */}
      <mesh position={[0, -0.12, 0]} receiveShadow>
        <boxGeometry args={[TABLE_W + 0.7, 0.2, TABLE_H + 0.7]} />
        <meshStandardMaterial color="#4a3524" roughness={0.8} />
      </mesh>
    </group>
  );
}

function Scene() {
  const snap = useStore((s) => s.snap);
  const pack = useStore((s) => s.pack);
  const send = useStore((s) => s.send);
  const sessionId = useStore((s) => s.sessionId);
  const setDragging = useStore((s) => s.setDragging);
  const dragging = useStore((s) => s.dragging);
  const mySeat = useMySeat();
  const { camera, size } = useThree();

  const controls = useRef<any>(null);
  /** Set once the player pans or zooms, so automatic reframing backs off. */
  const userMoved = useRef(false);
  const plane = useRef<THREE.Mesh>(null);
  const lastSend = useRef(0);
  /**
   * The press in progress.
   *
   * `mode` starts undecided when a pile is pressed, because what the press means depends
   * on what happens next: pulling away straight away takes the top card off, while
   * holding first and then pulling drags the whole pile.
   */
  const gesture = useRef<{
    id: string;
    stackId: string | null;
    topPieceId: string | null;
    startX: number; startY: number;
    t: number;
    moved: boolean;
    armed: boolean;
    mode: 'undecided' | 'card' | 'pile' | 'loose';
  } | null>(null);
  /** Fires if a press is held still long enough to mean "open the menu". */
  const longPress = useRef<number | null>(null);

  const openMenu = useStore((s) => s.openMenu);
  const closeMenu = useStore((s) => s.closeMenu);

  const cancelLongPress = () => {
    if (longPress.current !== null) {
      window.clearTimeout(longPress.current);
      longPress.current = null;
    }
  };

  const defs = useMemo(() => {
    const map = new Map<string, ComponentDef>();
    for (const c of pack?.components ?? []) map.set(c.id, c);
    return map;
  }, [pack]);

  /**
   * Frame the table from the seat you are sitting in, pulled back far enough to suit
   * the shape of the screen. A phone in portrait needs a very different distance from
   * a desktop window.
   */
  const frameCamera = useCallback(() => {
    const zone = snap.zones[`hand${mySeat}`];
    const dir = zone ? new THREE.Vector3(zone.x, 0, zone.z) : new THREE.Vector3(0, 0, 1);
    if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);
    dir.normalize();

    const cam = camera as THREE.PerspectiveCamera;
    const aspect = size.width / Math.max(1, size.height);
    const halfFov = Math.tan((cam.fov * Math.PI) / 360);
    const fitDepth = VIEW_D / 2 / halfFov;
    const fitWidth = VIEW_W / 2 / (halfFov * aspect);
    const dist = Math.min(30, Math.max(6, Math.max(fitDepth, fitWidth)));

    // Keep roughly the same viewing angle at every distance.
    cam.position.set(dir.x * dist * 0.6, dist * 0.78, dir.z * dist * 0.6);
    cam.lookAt(0, 0, 0);
    controls.current?.target.set(0, 0, 0);
    controls.current?.update();
  }, [camera, mySeat, size.width, size.height, snap.zones[`hand${mySeat}`]?.x]);

  // Taking a seat always reframes, and clears the "user has moved the camera" flag so
  // the new seat starts from a sensible view.
  useEffect(() => {
    userMoved.current = false;
    frameCamera();
    // Only the seat should trigger this; resizing is handled separately below.
  }, [mySeat, snap.zones[`hand${mySeat}`]?.x]);

  // Resizing reframes ONLY if the player has not moved the camera themselves. On a
  // phone the address bar sliding away counts as a resize, and snapping the view back
  // to default every time someone scrolls it is maddening.
  useEffect(() => {
    if (userMoved.current) return;
    frameCamera();
  }, [size.width, size.height, frameCamera]);

  // Exposed so the HUD can offer a way back to a sensible view.
  useEffect(() => {
    recenterRef.current = () => { userMoved.current = false; frameCamera(); };
    return () => { recenterRef.current = null; };
  }, [frameCamera]);

  /** Where on the table plane is this pointer event? */
  function tablePoint(e: ThreeEvent<PointerEvent>): { x: number; z: number } | null {
    const hit = e.intersections.find((i) => i.object === plane.current);
    if (hit) return { x: hit.point.x, z: hit.point.z };
    return { x: e.point.x, z: e.point.z };
  }

  function onPiecePointerDown(e: ThreeEvent<PointerEvent>, pieceId: string) {
    e.stopPropagation();
    // Only the primary button drags. Without this a right-click both opened the menu
    // and grabbed the piece, so opening a menu on a deck quietly pulled a card out of
    // it; middle-click did the same.
    if (e.button !== undefined && e.button !== 0) return;
    const piece = snap.pieces[pieceId];
    if (!piece) return;
    // Grabbing a card that is part of a deck grabs the deck, not the card.
    const targetId = piece.stackId || pieceId;
    const target = snap.stacks[targetId] ?? piece;
    if (target.heldBy && target.heldBy !== sessionId) return;

    closeMenu();
    const stack = piece.stackId ? snap.stacks[piece.stackId] : undefined;
    const topPieceId = stack?.pieceIds?.length ? stack.pieceIds[stack.pieceIds.length - 1] : null;

    gesture.current = {
      id: targetId,
      stackId: piece.stackId || null,
      topPieceId,
      startX: e.clientX, startY: e.clientY,
      t: performance.now(),
      moved: false,
      armed: false,
      mode: piece.stackId ? 'undecided' : 'loose',
    };
    setDragging(targetId);
    send({ t: 'grab', target: targetId });
    if (controls.current) controls.current.enabled = false;
    (e.target as Element)?.setPointerCapture?.(e.pointerId);

    // Holding still arms the press: releasing now shows the menu, while pulling away
    // drags the whole pile rather than peeling a card off it.
    const { clientX, clientY } = e;
    cancelLongPress();
    longPress.current = window.setTimeout(() => {
      longPress.current = null;
      const g = gesture.current;
      if (!g || g.moved) return;
      g.armed = true;
      if (g.mode === 'undecided') g.mode = 'pile';
      openMenu({ x: clientX, y: clientY, targetId });
    }, 450);
  }

  function onPointerMove(e: ThreeEvent<PointerEvent>) {
    const g = gesture.current;
    if (!g) return;
    const justMoved = !g.moved
      && (Math.abs(e.clientX - g.startX) > 6 || Math.abs(e.clientY - g.startY) > 6);

    if (justMoved) {
      g.moved = true;
      cancelLongPress();
      const p0 = tablePoint(e);

      if (g.armed) {
        // Held first, now pulling: take the whole pile and drop the menu.
        closeMenu();
        g.mode = 'pile';
      } else if (g.mode === 'undecided' && g.stackId && g.topPieceId && p0) {
        // Pulled straight away: peel the top card off and drag just that.
        send({ t: 'release', target: g.stackId });
        send({ t: 'unstack', stackId: g.stackId, count: 1, x: p0.x, z: p0.z });
        send({ t: 'grab', target: g.topPieceId });
        g.id = g.topPieceId;
        g.mode = 'card';
        setDragging(g.topPieceId);
      }
    }
    if (!g.moved) return;

    const now = performance.now();
    if (now - lastSend.current < 1000 / MOVE_HZ) return;
    lastSend.current = now;
    const p = tablePoint(e);
    if (p) send({ t: 'move', target: g.id, x: p.x, z: p.z });
  }

  function onPointerUp(e: ThreeEvent<PointerEvent>) {
    cancelLongPress();
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    setDragging(null);
    if (controls.current) controls.current.enabled = true;

    // Held without moving: the menu is already open, so just let go of the piece.
    if (g.armed && !g.moved) {
      send({ t: 'release', target: g.id });
      return;
    }

    const tapped = !g.moved && performance.now() - g.t < 400;
    if (tapped) {
      const stack = snap.stacks[g.id];
      if (stack && mySeat >= 0 && snap.zones[`hand${mySeat}`]) {
        // Tapping a deck draws the top card to your hand — the commonest action.
        send({ t: 'draw', stackId: g.id, toZoneId: `hand${mySeat}` });
      } else {
        send({ t: 'flip', target: g.id });
      }
      send({ t: 'release', target: g.id });
      return;
    }

    const p = tablePoint(e);
    if (p) send({ t: 'drop', target: g.id, zoneId: null, x: p.x, z: p.z });
    else send({ t: 'release', target: g.id });
  }

  const pieces = Object.values(snap.pieces);

  return (
    <>
      <OrbitControls
        ref={controls}
        target={[0, 0, 0]}
        enablePan
        maxPolarAngle={1.35}
        minPolarAngle={0.15}
        minDistance={4}
        maxDistance={34}
        // One finger drags pieces; two fingers move the camera.
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
        onStart={() => { userMoved.current = true; }}
        makeDefault
      />

      {/* Invisible catcher: gives drags a surface to resolve against and receives
          pointer events that miss every piece. */}
      <mesh
        ref={plane}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerDown={() => closeMenu()}
        visible={false}
      >
        <planeGeometry args={[TABLE_W * 2, TABLE_H * 2]} />
        <meshBasicMaterial />
      </mesh>

      <Zones snap={snap} mySeat={mySeat} />

      <group onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        {pieces.map((p) => (
          <Piece
            key={p.id}
            piece={p}
            def={defs.get(p.defId)}
            heldByOther={!!p.heldBy && p.heldBy !== sessionId}
            selected={dragging === p.id || (!!p.stackId && dragging === p.stackId)}
            onPointerDown={onPiecePointerDown}
            onContextMenu={(e: ThreeEvent<MouseEvent>) => {
              e.stopPropagation();
              openMenu({ x: e.clientX, y: e.clientY, targetId: p.stackId || p.id });
            }}
          />
        ))}
      </group>

      <StackLabels snap={snap} />
      <Cursors snap={snap} sessionId={sessionId} />
    </>
  );
}

function Zones({ snap, mySeat }: { snap: Snapshot; mySeat: number }) {
  return (
    <group>
      {Object.values(snap.zones).map((z) => {
        const mine = z.ownerSeat === mySeat && mySeat >= 0;
        const owned = (z.ownerSeat ?? -1) >= 0;
        // Only your own private zone is highlighted; other players' hands are drawn
        // faintly so you can see where they are without them drawing attention.
        const color = mine ? '#5ac8fa' : owned ? '#6b7280' : '#c8b88a';
        const opacity = mine ? 0.16 : owned ? 0.05 : 0.08;
        const isGrid = z.layout === 'grid' && z.gridCols > 0 && z.gridRows > 0;
        const isBoard = isGrid && z.checkered;
        return (
          <group key={z.id} position={[z.x, 0.0015, z.z]}>
            {isBoard ? (
              <Checkerboard zone={z} />
            ) : (
              <mesh rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[z.w, z.h]} />
                <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
              </mesh>
            )}
            {isGrid && <GridLines zone={z} />}
          </group>
        );
      })}
    </group>
  );
}

/** Alternating squares for a grid zone, so a board reads as a board. */
function Checkerboard({ zone }: { zone: Snapshot['zones'][string] }) {
  const texture = useMemo(
    () => checkerTexture(zone.gridCols, zone.gridRows),
    [zone.gridCols, zone.gridRows],
  );
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[zone.w, zone.h]} />
      <meshStandardMaterial map={texture} roughness={0.85} />
    </mesh>
  );
}

function GridLines({ zone }: { zone: Snapshot['zones'][string] }) {
  const geometry = useMemo(() => {
    const pts: number[] = [];
    const { w, h, gridCols: cols, gridRows: rows } = zone;
    for (let i = 0; i <= cols; i++) {
      const x = -w / 2 + (i * w) / cols;
      pts.push(x, 0.004, -h / 2, x, 0.004, h / 2);
    }
    for (let j = 0; j <= rows; j++) {
      const z = -h / 2 + (j * h) / rows;
      pts.push(-w / 2, 0.004, z, w / 2, 0.004, z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [zone.w, zone.h, zone.gridCols, zone.gridRows]);

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#000000" transparent opacity={0.25} />
    </lineSegments>
  );
}

/** Card counts floating over each pile. */
function StackLabels({ snap }: { snap: Snapshot }) {
  return (
    <>
      {Object.values(snap.stacks).map((s) => {
        const n = s.pieceIds?.length ?? 0;
        if (n < 2) return null;
        return (
          <Html
            key={s.id}
            position={[s.x, 0.35 + n * 0.006, s.z]}
            center
            distanceFactor={9}
            style={{ pointerEvents: 'none' }}
          >
            <div className="stack-count">{n}</div>
          </Html>
        );
      })}
    </>
  );
}

/** Other players' pointers, so you can see what someone is reaching for. */
function Cursors({ snap, sessionId }: { snap: Snapshot; sessionId: string }) {
  return (
    <>
      {Object.values(snap.players)
        .filter((p) => p.sessionId !== sessionId && p.connected)
        .map((p) => (
          <group key={p.sessionId} position={[p.px, 0.02, p.pz]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.12, 20]} />
              <meshBasicMaterial color={p.color} transparent opacity={0.75} depthWrite={false} />
            </mesh>
            <Html position={[0, 0.05, 0.25]} center distanceFactor={11} style={{ pointerEvents: 'none' }}>
              <div className="cursor-name" style={{ background: p.color }}>{p.name}</div>
            </Html>
          </group>
        ))}
    </>
  );
}
