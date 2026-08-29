/**
 * The 3D table.
 *
 * Owns the scene, the camera framing and all pointer interaction. Dragging is
 * predictive-free: the client sends move requests and renders whatever the server
 * confirms, so two players grabbing the same card can never disagree about where it
 * ended up.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { ComponentDef } from '@wvtt/shared';
import { useStore, useMySeat, canRead, PING_MS, type Ping, type Snapshot } from '../net/store';
import { useSettings, dragButtonIndex, QUALITY } from '../ui/settings';
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

/**
 * Where the pointer last was on the table, in table coordinates.
 *
 * A module-level slot rather than store state: this updates on every pointer move, and
 * putting it in the store would re-render the scene at the frequency of the mouse. The
 * keyboard shortcuts read it to ping the spot you are looking at.
 */
const pointerRef = { current: { x: 0, z: 0 } };
/** The same position in screen pixels, for anchoring the menu to the pointer. */
const pointerScreenRef = { current: { x: 0, y: 0 } };

export function getPointer(): { x: number; z: number } {
  return pointerRef.current;
}

export function getPointerScreen(): { x: number; y: number } {
  return pointerScreenRef.current;
}

/**
 * Project a spot on the table to screen pixels.
 *
 * Exposed to the browser only in development, where the end-to-end tests need to put
 * the pointer on a specific card. Hunting for pieces by clicking a grid of guesses made
 * those tests slow and flaky, and silently untestable whenever the camera moved.
 */
function installProjector(camera: THREE.Camera, width: number, height: number) {
  if (!import.meta.env.DEV) return;
  (window as unknown as { __wvttProject?: (x: number, z: number) => { x: number; y: number } })
    .__wvttProject = (x: number, z: number) => {
      const v = new THREE.Vector3(x, 0.1, z).project(camera);
      return {
        x: Math.round(((v.x + 1) / 2) * width),
        y: Math.round(((1 - v.y) / 2) * height),
      };
    };
}
/**
 * Stacking range for labels drawn inside the scene.
 *
 * drei's Html defaults to z-indices in the tens of millions, which puts a card count
 * on top of every overlay — the pack editor included, where a stray "52" floated over
 * the buttons. Kept below the HUD's own layers instead.
 */
const LABEL_Z: [number, number] = [4, 0];

/** Cap on how often drag positions go to the server. */
const MOVE_HZ = 30;
/**
 * Cap on how often the presence cursor is broadcast.
 *
 * Every one of these becomes a state patch that every other client turns into a
 * snapshot rebuild, so this number is multiplied by the number of players squared.
 * Eight a second is smooth enough for a cursor and a quarter of the traffic of thirty.
 */
const POINTER_HZ = 8;
/** Don't bother telling anyone about sub-millimetre pointer movement. */
const POINTER_EPSILON = 0.02;

export function Table() {
  const tableColor = useStore((s) => s.snap.tableColor);
  const quality = useSettings((s) => s.quality);
  const q = QUALITY[quality];
  const shadows = q.shadowMap > 0;
  return (
    <Canvas
      // Turning shadows on or off changes how the renderer is built, so the canvas is
      // remounted when it changes. Rare enough to be worth the simplicity.
      key={shadows ? 'shadows' : 'flat'}
      shadows={shadows}
      dpr={q.dpr}
      gl={{ antialias: q.antialias, powerPreference: 'high-performance' }}
      camera={{ fov: 42, position: [0, 8, 11], near: 0.1, far: 100 }}
      style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
      onContextMenu={(e) => e.preventDefault()}
      // Leaving the canvas leaves nothing hovered. Pieces clear their own hover on
      // pointer-out, but a pointer that exits the window never sends one.
      onPointerLeave={() => useStore.getState().setHovered(null)}
    >
      <color attach="background" args={['#0d1014']} />
      <ambientLight intensity={0.9} />
      <hemisphereLight intensity={1.1} groundColor="#2a2a33" />
      <directionalLight
        position={[6, 12, 6]}
        intensity={2.2}
        castShadow={shadows}
        shadow-mapSize={[q.shadowMap || 512, q.shadowMap || 512]}
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
  const ping = useStore((s) => s.ping);
  const hovered = useStore((s) => s.hovered);
  const setHovered = useStore((s) => s.setHovered);
  const shadowsOn = useSettings((s) => QUALITY[s.quality].shadowMap > 0);
  const mySeat = useMySeat();
  const dragButton = useSettings((s) => s.dragButton);
  const { camera, size } = useThree();

  /**
   * Which button does what.
   *
   * The two mappings are exact mirrors: whichever button drags pieces, the other one
   * orbits the camera and opens the context menu. OrbitControls is told the same thing
   * through its own mouseButtons map below, so the two never disagree.
   */
  const grabButton = dragButtonIndex(dragButton);
  const menuButton = grabButton === 0 ? 2 : 0;

  const controls = useRef<any>(null);
  /** Set once the player pans or zooms, so automatic reframing backs off. */
  const userMoved = useRef(false);
  const plane = useRef<THREE.Mesh>(null);
  const lastSend = useRef(0);
  /** Separate budget for presence: pointer updates are not drag updates. */
  const lastPointerSend = useRef(0);
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
  /**
   * A menu-button press waiting for its release.
   *
   * The menu opens on pointer UP, not down. On down it would be closed again by the
   * very same interaction: PieceMenu dismisses itself on any mousedown outside its box,
   * and the mousedown for this click has not been dispatched yet when pointerdown runs.
   */
  const menuPending = useRef<{ x: number; y: number; targetId: string } | null>(null);

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

  // Development-only: lets the end-to-end tests aim at a piece by its table position.
  useEffect(() => {
    installProjector(camera, size.width, size.height);
  }, [camera, size.width, size.height]);

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
    // Only the drag button drags. Without this the menu button both opened the menu
    // and grabbed the piece, so opening a menu on a deck quietly pulled a card out of
    // it; middle-click did the same.
    const piece = snap.pieces[pieceId];
    if (!piece) return;

    // Middle button pings whatever is under the pointer, on either mapping. It is the
    // one button no mapping claims, so it can always mean "look at this".
    if (e.button === 1) {
      ping({ x: piece.x, z: piece.z, targetId: piece.stackId || piece.id });
      return;
    }
    // The button that is not the drag button opens the menu, on release.
    if (e.button === menuButton) {
      closeMenu();
      menuPending.current = { x: e.clientX, y: e.clientY, targetId: piece.stackId || piece.id };
      return;
    }
    if (e.button !== undefined && e.button !== grabButton) return;
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

  /**
   * Remember where the pointer is, and tell the table.
   *
   * The presence cursors have been in the schema since the beginning but never moved,
   * because nothing ever sent a `pointer` op. Hover tracking needs the same event, so
   * the two are wired together here — throttled well below the drag rate, since a
   * cursor a fraction of a second behind is invisible to everyone watching it.
   */
  function trackPointer(e: ThreeEvent<PointerEvent>) {
    pointerScreenRef.current = { x: e.clientX, y: e.clientY };
    const p = tablePoint(e);
    if (!p) return;
    const moved = Math.abs(p.x - pointerRef.current.x) + Math.abs(p.z - pointerRef.current.z);
    pointerRef.current = p;
    if (moved < POINTER_EPSILON) return;
    const now = performance.now();
    if (now - lastPointerSend.current < 1000 / POINTER_HZ) return;
    lastPointerSend.current = now;
    send({ t: 'pointer', x: p.x, z: p.z });
  }

  function onPointerMove(e: ThreeEvent<PointerEvent>) {
    trackPointer(e);
    // Dragging with the menu button means panning the camera, not asking for a menu.
    const pending = menuPending.current;
    if (pending && (Math.abs(e.clientX - pending.x) > 6 || Math.abs(e.clientY - pending.y) > 6)) {
      menuPending.current = null;
    }
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
    if (menuPending.current) {
      openMenu(menuPending.current);
      menuPending.current = null;
      return;
    }
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
        onPointerDown={(e: ThreeEvent<PointerEvent>) => {
          closeMenu();
          // Pinging bare felt is how you point at a square, a zone or just "over here".
          if (e.button === 1) ping({ x: e.point.x, z: e.point.z });
        }}
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
            shadows={shadowsOn}
            piece={p}
            def={defs.get(p.defId)}
            heldByOther={!!p.heldBy && p.heldBy !== sessionId}
            readable={canRead(snap, p, mySeat)}
            selected={dragging === p.id || (!!p.stackId && dragging === p.stackId)}
            onPointerDown={onPiecePointerDown}
            hovered={hovered === (p.stackId || p.id)}
            onPointerOver={(e: ThreeEvent<PointerEvent>, id: string) => {
              e.stopPropagation();
              const piece = snap.pieces[id];
              // A card in a pile hands its pile over: shortcuts mean the pile, the same
              // way a drag on a pile does.
              setHovered(piece ? (piece.stackId || piece.id) : id);
            }}
            onPointerOut={(e: ThreeEvent<PointerEvent>, id: string) => {
              e.stopPropagation();
              const piece = snap.pieces[id];
              const target = piece ? (piece.stackId || piece.id) : id;
              // Only clear if we are still the one being pointed at: leaving one card of
              // a pile for its neighbour must not blank the pile.
              if (useStore.getState().hovered === target) setHovered(null);
            }}
          />
        ))}
      </group>

      <FrameWatch />
      <HoverRing snap={snap} hovered={hovered} />
      <StackLabels snap={snap} />
      <DiceLabels snap={snap} defs={defs} />
      <Pings />
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

/**
 * Stable colour for a pile's group tag.
 *
 * Tags are free text typed by players, so the palette is derived from the text itself
 * rather than assigned: everyone tagging a pile "discard" sees the same colour, in
 * every room, with nothing to keep in sync.
 */
const TAG_COLORS = ['#e6432f', '#2f7de6', '#3fae57', '#e6c22f', '#8e44ad', '#e6852f', '#2fc4c4'];

export function tagColor(tag: string): string {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_COLORS[h % TAG_COLORS.length];
}

/**
 * The chip floating over each pile: its count, its name and whether it is pinned.
 *
 * A count alone was enough when a table held one deck. It stops being enough the
 * moment there are five piles, which is why a pile can carry a name at all.
 */
function StackLabels({ snap }: { snap: Snapshot }) {
  return (
    <>
      {Object.values(snap.stacks).map((s) => {
        const n = s.pieceIds?.length ?? 0;
        const named = !!s.label;
        // An unnamed pair of cards is not worth a caption; a named pile always is.
        if (n < 2 && !named && !s.locked) return null;
        return (
          <Html
            key={s.id}
            position={[s.x, 0.35 + n * 0.006, s.z]}
            center
            distanceFactor={9}
            zIndexRange={LABEL_Z}
            style={{ pointerEvents: 'none' }}
          >
            <div className="stack-chip">
              {named && (
                <span
                  className="stack-name"
                  style={s.tag ? { borderColor: tagColor(s.tag), color: tagColor(s.tag) } : undefined}
                >
                  {s.label}
                </span>
              )}
              <span className="stack-count">{s.locked ? '🔒 ' : ''}{n}</span>
            </div>
          </Html>
        );
      })}
    </>
  );
}

/**
 * The number showing on each die, drawn as a billboard rather than on the mesh.
 *
 * Painting the value onto a polyhedron is what the app used to do, and it was
 * unreadable: one texture stretched across every face of an icosahedron, at a size
 * chosen for a table seen from two metres away. A billboard always faces the camera,
 * never shears, and stays legible on a phone.
 */
function DiceLabels({ snap, defs }: { snap: Snapshot; defs: Map<string, ComponentDef> }) {
  return (
    <>
      {Object.values(snap.pieces).map((p) => {
        const kind = defs.get(p.defId)?.kind ?? p.kind;
        if (kind !== 'die') return null;
        const value = p.secret?.value;
        if (!value) return null;
        const sides = defs.get(p.defId)?.sides ?? 6;
        return (
          <Html
            key={p.id}
            position={[p.x, p.y + 0.42, p.z]}
            center
            distanceFactor={7}
            zIndexRange={LABEL_Z}
            style={{ pointerEvents: 'none' }}
          >
            {/* Just the number. The die's kind is in the tooltip and in the log:
                spelling out "d20" beside every value doubles the label's width, and
                a tray of thirteen dice then reads as one solid bar. */}
            <div className="die-value" title={`d${sides}`}>{value}</div>
          </Html>
        );
      })}
    </>
  );
}

/**
 * Watch how fast the table is actually drawing, and turn the graphics down if it is
 * struggling.
 *
 * Players do not go looking in a settings menu when a game feels bad; they conclude the
 * app is bad. Only a guessed quality setting is ever lowered — a deliberate choice is
 * left alone — and it only ever steps down, never back up, so this cannot oscillate.
 */
function FrameWatch() {
  const autoDowngrade = useSettings((s) => s.autoDowngrade);
  const showToast = useStore((s) => s.showToast);
  const window_ = useRef({ frames: 0, slow: 0, since: 0 });

  useFrame((_state, delta) => {
    const w = window_.current;
    if (w.since === 0) w.since = performance.now();
    w.frames++;
    // 40ms is 25fps: the point where dragging a card stops feeling attached to the
    // pointer. Startup frames are always slow, so a single bad one proves nothing.
    if (delta > 0.04) w.slow++;

    const elapsed = performance.now() - w.since;
    if (elapsed < 5000 || w.frames < 30) return;

    const bad = w.slow / w.frames > 0.5;
    w.frames = 0; w.slow = 0; w.since = performance.now();
    if (!bad) return;

    const next = autoDowngrade();
    if (next) {
      showToast(
        next === 'low'
          ? 'Graphics turned down to keep the table smooth. Change it in the menu.'
          : 'Graphics eased off to keep the table smooth. Change it in the menu.',
      );
    }
  });

  return null;
}

/**
 * A ring on the felt under whatever the pointer is over.
 *
 * The outline on the mesh itself is too easy to miss on a pale card seen edge-on, and
 * a keyboard shortcut that acts on "the thing you are pointing at" is only usable if
 * that thing is obvious. The ring sits on the table, so it reads at any camera angle.
 */
function HoverRing({ snap, hovered }: { snap: Snapshot; hovered: string | null }) {
  if (!hovered) return null;
  const target = snap.stacks[hovered] ?? snap.pieces[hovered];
  if (!target) return null;
  return (
    <mesh position={[target.x, 0.016, target.z]} rotation={[-Math.PI / 2, 0, 0]}>
      {/* Wider than a card's half-diagonal, so the ring shows AROUND the piece rather
          than disappearing underneath it. */}
      <ringGeometry args={[0.58, 0.66, 40]} />
      <meshBasicMaterial color="#ffffff" transparent opacity={0.5} depthWrite={false} />
    </mesh>
  );
}

/**
 * Pings: a ring that grows and fades where somebody pointed.
 *
 * Drawn with a plain expanding mesh rather than a shader so it costs nothing, and
 * captioned with the pinger's name so a table of six knows who is asking for
 * attention.
 */
function Pings() {
  const pings = useStore((s) => s.pings);
  return (
    <>
      {pings.map((p) => (
        <PingRing key={p.id} ping={p} />
      ))}
    </>
  );
}

function PingRing({ ping }: { ping: Ping }) {
  const ring = useRef<THREE.Mesh>(null);
  const inner = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const t = Math.min(1, (Date.now() - ping.at) / PING_MS);
    // Two rings offset in time read as a pulse rather than a single expanding blob.
    const grow = (phase: number) => 0.25 + 2.4 * ((t * 1.6 + phase) % 1);
    const fade = (phase: number) => 0.75 * (1 - ((t * 1.6 + phase) % 1)) * (1 - t);
    for (const [mesh, phase] of [[ring, 0], [inner, 0.5]] as const) {
      const m = mesh.current;
      if (!m) continue;
      const scale = grow(phase);
      m.scale.set(scale, scale, scale);
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, fade(phase));
    }
  });

  return (
    <group position={[ping.x, 0.03, ping.z]}>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.34, 0.42, 40]} />
        <meshBasicMaterial color={ping.color} transparent depthWrite={false} />
      </mesh>
      <mesh ref={inner} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.34, 0.42, 40]} />
        <meshBasicMaterial color={ping.color} transparent depthWrite={false} />
      </mesh>
      <Html position={[0, 0.1, 0]} center distanceFactor={10} zIndexRange={LABEL_Z} style={{ pointerEvents: 'none' }}>
        <div className="ping-name" style={{ background: ping.color }}>{ping.name}</div>
      </Html>
    </group>
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
            <Html position={[0, 0.05, 0.25]} center distanceFactor={11} zIndexRange={LABEL_Z} style={{ pointerEvents: 'none' }}>
              <div className="cursor-name" style={{ background: p.color }}>{p.name}</div>
            </Html>
          </group>
        ))}
    </>
  );
}
