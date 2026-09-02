/**
 * The game maker.
 *
 * Everything here operates on a plain JSON pack, and there is no privileged format for
 * built-in games — starting from the pack on this table hands you exactly what chess or
 * poker is made of, which is the fastest way to learn the format.
 *
 * The shape of the panel is the point. An earlier version was four equal tabs of dense
 * form fields with the one button that matters — put this on the table — buried at the
 * bottom of the last one, so it read as a configuration file with a UI stuck on it.
 * Now:
 *
 *   - Three tabs, named after what you are doing, not after what the JSON is called.
 *   - The action bar is always on screen, so "play it" is never more than one press away
 *     and the pack's problems are always visible rather than discovered on export.
 *   - Coordinates are placed by dragging on a map of the table. The numbers are still
 *     there for anyone who wants them, folded away behind the thing they describe.
 *   - Anything that is a wall of text — the generated prompt, the raw JSON, the script
 *     API — is collapsed by default. It is all still one press away.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildPrompt, GAME_SHAPES, TURN_STRUCTURES, WIN_CONDITIONS, COMPONENT_SETS,
  scriptApiReference, standardDeck, textDeck, diceSet, chipSet, tokenSet, validatePack,
  type GamePack, type ComponentDef, type ZoneDef,
} from '@wvtt/shared';
import { useStore } from '../net/store';
import { CodeEditor } from './CodeEditor';

type Tab = 'make' | 'table' | 'rules';

const TAB_LABELS: Record<Tab, string> = {
  make: 'Describe it',
  table: 'What is on the table',
  rules: 'Rules',
};

const BLANK: GamePack = {
  manifest: {
    formatVersion: 1,
    id: 'my-game',
    name: 'My Game',
    author: 'me',
    description: 'A game I made.',
    minSeats: 1,
    maxSeats: 6,
    defaultEnforcement: 'off',
    tableColor: '#1f6f4a',
  },
  components: [],
  zones: [
    { id: 'hand0', label: 'Seat 1 hand', ownerSeat: 0, visibility: 'owner', x: 0, z: 3.6, w: 4.2, h: 1.3, layout: 'fan' },
    { id: 'hand1', label: 'Seat 2 hand', ownerSeat: 1, visibility: 'owner', x: 0, z: -3.6, w: 4.2, h: 1.3, layout: 'fan' },
    { id: 'play', label: 'Play area', ownerSeat: null, visibility: 'public', x: 0, z: 0, w: 8, h: 4, layout: 'free' },
  ],
  setup: [],
};

/**
 * Where the work in progress is kept between sessions.
 *
 * A pack takes real effort to write, and the editor used to lose all of it the moment
 * the panel was closed — including a script someone had just pasted out of an AI
 * assistant. The draft is saved locally on every change and offered back on reopen.
 */
const DRAFT_KEY = 'wvtt:draft-pack';

function loadDraft(): GamePack | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GamePack;
    return parsed?.manifest ? parsed : null;
  } catch {
    return null;
  }
}

function saveDraft(pack: GamePack) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(pack));
  } catch {
    // Storage full or disabled: the editor still works, it just cannot remember.
  }
}

/** The table, in table units. Matches TABLE_W / TABLE_H in the renderer. */
const MAP_W = 16;
const MAP_H = 11;

/** Zone caption size on the map, in table units. */
const LABEL_SIZE = 0.3;

/**
 * As much of a zone's name as its rectangle can hold.
 *
 * A proportional font has no fixed character width, but half the point size is close
 * enough for a caption that only has to be recognisable — and being slightly cautious
 * is the right way to be wrong here.
 */
function fitLabel(label: string, width: number): string {
  const max = Math.floor((width - 0.2) / (LABEL_SIZE * 0.52));
  if (max < 3) return '';
  return label.length <= max ? label : `${label.slice(0, max - 1)}…`;
}

export function Editor({ onClose }: { onClose: () => void }) {
  const room = useStore((s) => s.room);
  const livePack = useStore((s) => s.pack);
  const showToast = useStore((s) => s.showToast);

  const [tab, setTab] = useState<Tab>('make');
  // A saved draft wins over the table's own pack: it is the thing the author was last
  // working on, and losing it is the expensive mistake.
  const [pack, setPack] = useState<GamePack>(() => loadDraft() ?? structuredClone(livePack ?? BLANK));
  const [raw, setRaw] = useState('');
  const [rawOpen, setRawOpen] = useState(false);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [savedAt, setSavedAt] = useState<number>(0);
  /** Which zone the map is highlighting, so the map and the list point at each other. */
  const [activeZone, setActiveZone] = useState<string | null>(null);

  // Prompt generator inputs.
  const [description, setDescription] = useState('');
  const [shape, setShape] = useState('trick');
  const [turns, setTurns] = useState('clockwise');
  const [win, setWin] = useState('points');
  const [comps, setComps] = useState<string[]>(['cards52']);
  const [useBase, setUseBase] = useState(false);

  const json = useMemo(() => JSON.stringify(pack, null, 2), [pack]);

  /**
   * The same checks the server runs on arrival, run here as you type.
   *
   * The commonest way to lose an afternoon with this editor was pasting JSON from an
   * assistant, pressing Load, and getting a toast that vanished before it could be
   * read. Now the problems are listed, in place, before anything is sent.
   */
  const check = useMemo(() => validatePack(pack), [pack]);

  /** Nothing has been built yet, so offer a way in rather than an empty form. */
  const untouched = pack.components.length === 0 && !pack.script?.trim();

  /**
   * Draft autosave, debounced.
   *
   * localStorage writes are synchronous, and a pack with a long script is not small —
   * writing the whole thing on every keystroke stutters the script editor. Three
   * quarters of a second after you stop typing is soon enough to survive a closed tab.
   */
  useEffect(() => {
    const t = window.setTimeout(() => {
      saveDraft(pack);
      setSavedAt(Date.now());
    }, 750);
    return () => window.clearTimeout(t);
  }, [json]);

  const prompt = useMemo(
    () => buildPrompt({
      description,
      shape,
      turns,
      win,
      components: comps,
      seats: [pack.manifest.minSeats, pack.manifest.maxSeats],
      enforcement: pack.manifest.defaultEnforcement,
      basePack: useBase ? json : undefined,
    }),
    [description, shape, turns, win, comps, pack.manifest, json, useBase],
  );

  function patchManifest(patch: Partial<GamePack['manifest']>) {
    setPack((p) => ({ ...p, manifest: { ...p.manifest, ...patch } }));
  }

  function copy(text: string, what: string) {
    navigator.clipboard?.writeText(text).then(
      () => showToast(`${what} copied.`),
      () => showToast('Could not copy — select the text and copy it manually.'),
    );
  }

  function addComponents(defs: ComponentDef[], label: string) {
    setPack((p) => {
      const existing = new Set(p.components.map((c) => c.id));
      const added = defs.filter((d) => !existing.has(d.id));
      return { ...p, components: [...p.components, ...added] };
    });
    showToast(`Added ${label}.`);
  }

  function addSetupStep() {
    setPack((p) => ({
      ...p,
      setup: [...p.setup, { componentIds: [], as: 'stack', zoneId: null, x: 0, z: -2, faceUp: false, shuffled: true }],
    }));
  }

  function loadIntoTable() {
    if (!room) return;
    if (!check.ok) {
      setProblemsOpen(true);
      showToast('Fix the problems listed at the bottom first.');
      return;
    }
    room.send('loadPack', { packJson: JSON.stringify(pack) });
    showToast('Loading pack onto the table…');
    onClose();
  }

  function startFresh() {
    setPack(structuredClone(BLANK));
    setActiveZone(null);
    showToast('Started a new pack. The old draft is gone.');
  }

  function startFromTable() {
    if (!livePack) return;
    setPack(structuredClone(livePack));
    setActiveZone(null);
    setTab('table');
    showToast(`Copied "${livePack.manifest.name}". Change anything you like.`);
  }

  function importJson(text: string) {
    try {
      const parsed = JSON.parse(text) as GamePack;
      if (!parsed?.manifest) throw new Error('That JSON has no manifest.');
      setPack(parsed);
      setRawOpen(false);
      const verdict = validatePack(parsed);
      if (verdict.ok) {
        showToast('Pack imported and it checks out.');
      } else {
        setProblemsOpen(true);
        showToast(`Imported, but ${verdict.errors.length} problem${verdict.errors.length === 1 ? '' : 's'} to fix.`);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'That is not valid JSON.');
    }
  }

  function download() {
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${pack.manifest.id || 'pack'}.wvtt.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="editor">
      <header>
        <div className="editor-title">
          <strong>Game maker</strong>
          <span className="editor-name">{pack.manifest.name || 'Untitled'}</span>
        </div>
        <nav>
          {(['make', 'table', 'rules'] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {TAB_LABELS[t]}
            </button>
          ))}
        </nav>
        <button className="icon" onClick={onClose} title="Close">✕</button>
      </header>

      <div className="editor-body">
        {tab === 'make' && (
          <>
            {untouched && (
              <StartPoints
                canCopyTable={!!livePack}
                tableName={livePack?.manifest.name ?? ''}
                onFromTable={startFromTable}
                onByHand={() => setTab('table')}
                onPaste={() => { setRaw(''); setRawOpen(true); }}
              />
            )}

            <Step n={1} title="Say what the game is">
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="A three-player trick-taking game where hearts are worth minus one and the queen of spades is minus five."
              />
              <Pills label="Shape" list={GAME_SHAPES} value={shape} onChange={setShape} />
              <Pills label="Turns" list={TURN_STRUCTURES} value={turns} onChange={setTurns} />
              <Pills label="Winning" list={WIN_CONDITIONS} value={win} onChange={setWin} />
              <div className="field">
                <span>What is it played with</span>
                <div className="chips">
                  {COMPONENT_SETS.map((c) => (
                    <button
                      key={c.id}
                      className={comps.includes(c.id) ? 'on' : ''}
                      onClick={() => setComps((v) => v.includes(c.id) ? v.filter((x) => x !== c.id) : [...v, c.id])}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span>Players</span>
                <div className="row">
                  <input
                    type="number" min={1} max={12} value={pack.manifest.minSeats}
                    onChange={(e) => patchManifest({ minSeats: Number(e.target.value) })}
                    style={{ maxWidth: 90 }}
                  />
                  <span className="to">to</span>
                  <input
                    type="number" min={1} max={12} value={pack.manifest.maxSeats}
                    onChange={(e) => patchManifest({ maxSeats: Number(e.target.value) })}
                    style={{ maxWidth: 90 }}
                  />
                </div>
              </div>
            </Step>

            <Step n={2} title="Hand this to an AI assistant">
              <p className="lead">
                It writes the whole pack — the cards, the layout and the rules — as one block
                of JSON. Any assistant will do.
              </p>
              <div className="row wrap">
                <button className="primary" onClick={() => copy(prompt, 'Prompt')}>Copy the prompt</button>
                <label className="check">
                  <input type="checkbox" checked={useBase} onChange={(e) => setUseBase(e.target.checked)} />
                  Ask it to change this pack rather than start over
                </label>
              </div>
              <details className="ref">
                <summary>See the prompt ({prompt.length.toLocaleString()} characters)</summary>
                <textarea readOnly rows={14} className="mono" value={prompt} onClick={(e) => e.currentTarget.select()} />
              </details>
            </Step>

            <Step n={3} title="Paste what it gives you back">
              <div className="row wrap">
                <button className="primary" onClick={() => { setRaw(''); setRawOpen(true); }}>
                  Paste a pack
                </button>
                <span className="hint" style={{ margin: 0 }}>
                  Then press Play it on this table, at the bottom.
                </span>
              </div>
              {rawOpen && (
                <div className="paste">
                  <textarea
                    rows={9}
                    className="mono"
                    value={raw}
                    onChange={(e) => setRaw(e.target.value)}
                    placeholder="Paste pack JSON here."
                  />
                  <div className="row">
                    <button className="primary" disabled={!raw.trim()} onClick={() => importJson(raw)}>Import</button>
                    <button onClick={() => setRawOpen(false)}>Cancel</button>
                  </div>
                </div>
              )}
            </Step>
          </>
        )}

        {tab === 'table' && (
          <>
            <section className="card">
              <h4>About this game</h4>
              <div className="grid2">
                <label>Name<input value={pack.manifest.name} onChange={(e) => patchManifest({ name: e.target.value })} /></label>
                <label>Author<input value={pack.manifest.author} onChange={(e) => patchManifest({ author: e.target.value })} /></label>
                <label className="colour-field">
                  Felt colour
                  <input type="color" value={pack.manifest.tableColor ?? '#1f6f4a'} onChange={(e) => patchManifest({ tableColor: e.target.value })} />
                </label>
              </div>
              <label>
                One-line description
                <input value={pack.manifest.description} onChange={(e) => patchManifest({ description: e.target.value })} />
              </label>
              <details className="ref">
                <summary>Advanced — pack id and raw JSON</summary>
                <label>
                  Id
                  <input value={pack.manifest.id} onChange={(e) => patchManifest({ id: e.target.value })} />
                  <span className="hint">Lower-case, no spaces. Only used to name the downloaded file.</span>
                </label>
                {/* The whole pack, exactly as the server will receive it. Folded away
                    rather than removed: it is how you check what the editor actually
                    produced, and it is the only view of the parts the form has no
                    control for. */}
                <label>
                  The whole pack
                  <textarea className="mono" readOnly rows={12} value={json} onClick={(e) => e.currentTarget.select()} />
                </label>
              </details>
            </section>

            <section className="card">
              <h4>Pieces <span className="count">{pack.components.length}</span></h4>
              <p className="hint" style={{ marginTop: 0 }}>Press a kit to add it. Adding twice does nothing.</p>
              <div className="chips">
                <button onClick={() => addComponents(standardDeck(false), 'a 52-card deck')}>52-card deck</button>
                <button onClick={() => addComponents(standardDeck(true), 'a deck with jokers')}>Deck with jokers</button>
                <button onClick={() => addComponents(chipSet(), 'poker chips')}>Chips</button>
                <button onClick={() => addComponents(diceSet(), 'dice')}>Dice</button>
                <button onClick={() => addComponents(tokenSet(), 'tokens')}>Tokens</button>
                <button
                  className="danger-text"
                  disabled={pack.components.length === 0}
                  onClick={() => setPack((p) => ({ ...p, components: [] }))}
                >
                  Remove all
                </button>
              </div>
              <TextDeckBuilder onAdd={(lines, prefix) => addComponents(textDeck(prefix, lines), `${lines.length} text cards`)} />
            </section>

            <section className="card">
              <h4>Layout <span className="count">{pack.zones.length} zones</span></h4>
              <p className="hint" style={{ marginTop: 0 }}>
                Drag a zone on the map to move it. A zone marked <em>owner only</em> is what
                makes a hand private — nobody else is even sent what is in it.
              </p>
              <TableMap
                zones={pack.zones}
                setup={pack.setup}
                active={activeZone}
                felt={pack.manifest.tableColor ?? '#1f6f4a'}
                onActivate={setActiveZone}
                onMove={(id, x, z) => setPack((p) => ({
                  ...p,
                  zones: p.zones.map((zz) => (zz.id === id ? { ...zz, x, z } : zz)),
                }))}
              />
              <ZoneList
                zones={pack.zones}
                active={activeZone}
                onActivate={setActiveZone}
                onChange={(zones) => setPack((p) => ({ ...p, zones }))}
              />
            </section>

            <section className="card">
              <h4>Setup <span className="count">{pack.setup.length} steps</span></h4>
              <p className="hint" style={{ marginTop: 0 }}>
                What is already on the table when a game starts.
              </p>
              <SetupList
                setup={pack.setup}
                zones={pack.zones}
                onChange={(setup) => setPack((p) => ({ ...p, setup }))}
              />
              <button onClick={addSetupStep}>Add a setup step</button>
            </section>
          </>
        )}

        {tab === 'rules' && (
          <>
            <section className="card">
              <h4>Rules script <span className="count">{pack.script?.trim() ? 'present' : 'none'}</span></h4>
              <p className="hint" style={{ marginTop: 0 }}>
                Optional. Without one the table is a pure sandbox and anything can be moved
                anywhere — which is a perfectly good game. A script only takes effect when the
                room's rules setting is Advisory or Enforced.
              </p>
              <CodeEditor
                value={pack.script ?? ''}
                onChange={(script) => setPack((p) => ({ ...p, script }))}
                height="380px"
              />
              <details className="ref">
                <summary>What a script can call</summary>
                <pre>{scriptApiReference()}</pre>
              </details>
            </section>

            {pack.script?.trim() && (
              <div className="warn">
                <strong>Scripts run on the server.</strong> They can read the whole table,
                including face-down cards. They are sandboxed — no network, no filesystem,
                nothing outside the game — but a pack you did not write is trusted the way a
                human dealer is trusted. Switching rules off stops it at any time.
              </div>
            )}
          </>
        )}
      </div>

      {/* The action bar. Always on screen, on every tab: the one thing anybody comes here
          to do is put the game on the table, and it used to be at the bottom of a tab
          most people never opened. */}
      <footer className="editor-bar">
        <button
          className={`verdict ${check.ok ? 'ok' : 'bad'}`}
          onClick={() => setProblemsOpen((v) => !v)}
          title="What the server will check when this is loaded"
        >
          {check.ok
            ? `Ready${check.warnings.length ? ` · ${check.warnings.length} note${check.warnings.length === 1 ? '' : 's'}` : ''}`
            : `${check.errors.length} problem${check.errors.length === 1 ? '' : 's'}`}
        </button>

        <span className="saved-note">
          {savedAt ? 'Draft saved in this browser' : 'Saved as you go'}
        </span>

        <div className="bar-actions">
          <button onClick={() => copy(json, 'Pack JSON')} title="Copy the whole pack as JSON">Copy</button>
          <button onClick={download} title="Download a .wvtt.json file">Save file</button>
          <button onClick={() => { setRaw(''); setRawOpen(true); setTab('make'); }}>Paste</button>
          <button onClick={startFresh}>New</button>
          <button className="primary" onClick={loadIntoTable} disabled={!room || !check.ok}>
            Play it on this table
          </button>
        </div>
      </footer>

      {problemsOpen && (check.errors.length > 0 || check.warnings.length > 0) && (
        <div className="editor-problems">
          <div className="row between">
            <strong>{check.errors.length > 0 ? 'This pack cannot be loaded yet' : 'Worth a look'}</strong>
            <button className="icon" onClick={() => setProblemsOpen(false)} title="Hide">✕</button>
          </div>
          <ul>
            {check.errors.slice(0, 12).map((e) => <li key={e} className="bad">{e}</li>)}
            {check.errors.length === 0 && check.warnings.slice(0, 8).map((w) => <li key={w}>{w}</li>)}
          </ul>
          {check.errors.length > 12 && <p className="hint">…and {check.errors.length - 12} more.</p>}
        </div>
      )}

      {problemsOpen && check.ok && check.warnings.length === 0 && (
        <div className="editor-problems">
          <div className="row between">
            <strong>Nothing to fix. This will load.</strong>
            <button className="icon" onClick={() => setProblemsOpen(false)} title="Hide">✕</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Small pieces of the panel
 * ------------------------------------------------------------------ */

/** A numbered step. Three of these are the whole of the first tab. */
function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="card step">
      <h4><span className="step-n">{n}</span>{title}</h4>
      {children}
    </section>
  );
}

/**
 * A one-of-many choice, as a row of pills rather than a dropdown.
 *
 * There are four of these on the first tab and every list is short. Four dropdowns read
 * as a form to be filled in; four rows of pills read as choices to be made, and every
 * option is visible without opening anything.
 */
function Pills({ label, list, value, onChange }: {
  label: string;
  list: { id: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="chips">
        {list.map((c) => (
          <button key={c.id} className={value === c.id ? 'on' : ''} onClick={() => onChange(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Shown only on an empty pack: three ways in, instead of an empty form. */
function StartPoints({ canCopyTable, tableName, onFromTable, onByHand, onPaste }: {
  canCopyTable: boolean;
  tableName: string;
  onFromTable: () => void;
  onByHand: () => void;
  onPaste: () => void;
}) {
  return (
    <div className="starts">
      <button className="start" onClick={onFromTable} disabled={!canCopyTable}>
        <strong>Start from this table</strong>
        <span>
          {canCopyTable
            ? `Copy "${tableName}" and change it. Built-in games use the same format as yours.`
            : 'No pack loaded yet.'}
        </span>
      </button>
      <button className="start" onClick={onPaste}>
        <strong>Paste a pack</strong>
        <span>Someone sent you one, or an assistant wrote you one.</span>
      </button>
      <button className="start" onClick={onByHand}>
        <strong>Build it by hand</strong>
        <span>Pick the pieces and lay out the table yourself.</span>
      </button>
    </div>
  );
}

/**
 * A top-down map of the table, with the zones drawn on it.
 *
 * Zone position used to be four numeric fields per zone, in table units nobody has an
 * intuition for. Dragging a rectangle onto a picture of a table is the same edit and
 * needs no explanation; the numbers are still underneath for anyone who wants them.
 */
function TableMap({ zones, setup, active, felt, onActivate, onMove }: {
  zones: ZoneDef[];
  setup: GamePack['setup'];
  active: string | null;
  felt: string;
  onActivate: (id: string | null) => void;
  onMove: (id: string, x: number, z: number) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; dx: number; dz: number } | null>(null);

  /** Screen pixels to table units. */
  function toTable(e: React.PointerEvent): { x: number; z: number } | null {
    const el = svg.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return {
      x: ((e.clientX - r.left) / r.width) * MAP_W - MAP_W / 2,
      z: ((e.clientY - r.top) / r.height) * MAP_H - MAP_H / 2,
    };
  }

  function startDrag(e: React.PointerEvent, zone: ZoneDef) {
    const p = toTable(e);
    if (!p) return;
    onActivate(zone.id);
    drag.current = { id: zone.id, dx: p.x - zone.x, dz: p.z - zone.z };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }

  function onMoveDrag(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const p = toTable(e);
    if (!p) return;
    // Snapped to a tenth of a unit: table coordinates are fractional, but nobody wants
    // a zone at x = 3.0471830985915494.
    const round = (n: number) => Math.round(n * 10) / 10;
    onMove(d.id, round(p.x - d.dx), round(p.z - d.dz));
  }

  function endDrag(e: React.PointerEvent) {
    drag.current = null;
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
  }

  return (
    <div className="table-map">
      <svg
        ref={svg}
        viewBox={`${-MAP_W / 2} ${-MAP_H / 2} ${MAP_W} ${MAP_H}`}
        onPointerMove={onMoveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        role="img"
        aria-label="Top-down map of the table"
      >
        <rect x={-MAP_W / 2} y={-MAP_H / 2} width={MAP_W} height={MAP_H} rx={0.6} fill={felt} opacity={0.85} />
        {/* Centre lines, so "the middle of the table" is a place rather than a guess. */}
        <line x1={0} y1={-MAP_H / 2} x2={0} y2={MAP_H / 2} stroke="#ffffff" strokeWidth={0.02} opacity={0.25} />
        <line x1={-MAP_W / 2} y1={0} x2={MAP_W / 2} y2={0} stroke="#ffffff" strokeWidth={0.02} opacity={0.25} />

        {zones.map((z) => {
          const owned = (z.ownerSeat ?? -1) >= 0;
          const stroke = z.visibility === 'owner' ? '#5ac8fa'
            : z.visibility === 'hidden' ? '#ff9f43'
            : '#e8e4da';
          const on = active === z.id;
          return (
            <g key={z.id} className="map-zone" onPointerDown={(e) => startDrag(e, z)}>
              <rect
                x={z.x - z.w / 2} y={z.z - z.h / 2} width={Math.max(0.2, z.w)} height={Math.max(0.2, z.h)}
                rx={0.18}
                fill={stroke} fillOpacity={on ? 0.3 : 0.13}
                stroke={stroke} strokeWidth={on ? 0.12 : 0.06} strokeOpacity={on ? 1 : 0.75}
              />
              {/* Clipped to what the rectangle can actually hold. A pack with fifteen
                  zones drew fifteen full labels across one another and the map became
                  less legible than the numbers it replaced. */}
              <text
                x={z.x} y={z.z} textAnchor="middle" dominantBaseline="middle"
                fill="#ffffff" fillOpacity={0.92} fontSize={LABEL_SIZE}
              >
                {fitLabel(z.label || z.id, z.w)}
              </text>
              {owned && (
                <text
                  x={z.x - z.w / 2 + 0.16} y={z.z - z.h / 2 + 0.26}
                  fill={stroke} fillOpacity={0.95} fontSize={LABEL_SIZE * 0.85} fontWeight={700}
                >
                  {(z.ownerSeat ?? 0) + 1}
                </text>
              )}
            </g>
          );
        })}

        {/* Where the setup steps drop their pieces. Not draggable — a step's position is
            usually irrelevant once it lands in a zone — but worth seeing. */}
        {setup.filter((s) => !s.zoneId).map((s, i) => (
          <g key={i}>
            <circle cx={s.x} cy={s.z} r={0.22} fill="#f2c14e" fillOpacity={0.9} />
            <circle cx={s.x} cy={s.z} r={0.4} fill="none" stroke="#f2c14e" strokeWidth={0.05} strokeOpacity={0.6} />
          </g>
        ))}
      </svg>
      <p className="map-legend">
        <span className="k" style={{ background: '#5ac8fa' }} /> owner only
        <span className="k" style={{ background: '#e8e4da' }} /> public
        <span className="k" style={{ background: '#ff9f43' }} /> hidden
        <span className="k round" style={{ background: '#f2c14e' }} /> setup drop
      </p>
    </div>
  );
}

function TextDeckBuilder({ onAdd }: { onAdd: (lines: string[], prefix: string) => void }) {
  const [text, setText] = useState('');
  const [prefix, setPrefix] = useState('c');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  return (
    <details className="ref subpanel-details">
      <summary>Cards with your own words on them</summary>
      <div className="subpanel">
        <span className="field-label">One card per line.</span>
        <textarea
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'Name a fruit\nName a country\nName a film'}
        />
        <div className="row">
          <button className="primary" disabled={lines.length === 0} onClick={() => { onAdd(lines, prefix || 'c'); setText(''); }}>
            Add {lines.length} card{lines.length === 1 ? '' : 's'}
          </button>
          <input
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            placeholder="id prefix"
            aria-label="Component id prefix"
            style={{ maxWidth: 110 }}
          />
        </div>
      </div>
    </details>
  );
}

/**
 * The zones, as a list of rows.
 *
 * Identity on the row itself; geometry folded away behind it, because the map above is
 * the better way to do that edit and the numbers only matter when you want a zone at an
 * exact size.
 */
function ZoneList({ zones, active, onActivate, onChange }: {
  zones: ZoneDef[];
  active: string | null;
  onActivate: (id: string | null) => void;
  onChange: (z: ZoneDef[]) => void;
}) {
  function patch(i: number, p: Partial<ZoneDef>) {
    onChange(zones.map((z, j) => (i === j ? { ...z, ...p } : z)));
  }
  /** Small numeric cell. Table coordinates are fractional, so steps are fine-grained. */
  const num = (
    value: number, onValue: (n: number) => void, title: string, step = 0.1,
  ) => (
    <input
      type="number" step={step} value={value} title={title} aria-label={title}
      onChange={(e) => onValue(Number(e.target.value))}
    />
  );

  /** A friendly preset is a far better starting point than an untitled empty box. */
  function add(preset: 'hand' | 'public' | 'board') {
    const seat = zones.filter((z) => (z.ownerSeat ?? -1) >= 0).length;
    const base = { x: 0, z: 0, layout: 'free' as ZoneDef['layout'] };
    const made: ZoneDef =
      preset === 'hand'
        ? { ...base, id: `hand${seat}`, label: `Seat ${seat + 1} hand`, ownerSeat: seat, visibility: 'owner', z: seat % 2 === 0 ? 3.6 : -3.6, w: 4.2, h: 1.3, layout: 'fan' }
        : preset === 'board'
          ? { ...base, id: `board${zones.length}`, label: 'Board', ownerSeat: null, visibility: 'public', w: 6, h: 6, layout: 'grid', gridCols: 8, gridRows: 8, checkered: true }
          : { ...base, id: `zone${zones.length}`, label: 'Play area', ownerSeat: null, visibility: 'public', w: 4, h: 2.4 };
    onChange([...zones, made]);
    onActivate(made.id);
  }

  return (
    <div className="rows">
      {zones.map((z, i) => (
        <div className={`zone-block ${active === z.id ? 'on' : ''}`} key={i} onPointerDown={() => onActivate(z.id)}>
          <div className="zone-row">
            <input value={z.label} onChange={(e) => patch(i, { label: e.target.value })} placeholder="What it is called" />
            <select value={z.visibility} onChange={(e) => patch(i, { visibility: e.target.value as ZoneDef['visibility'] })}>
              <option value="public">anyone can see it</option>
              <option value="owner">owner only</option>
              <option value="hidden">nobody can see it</option>
              <option value="inherit">inherit</option>
            </select>
            <select
              value={z.ownerSeat ?? -1}
              aria-label="Owning seat"
              onChange={(e) => patch(i, { ownerSeat: Number(e.target.value) < 0 ? null : Number(e.target.value) })}
            >
              <option value={-1}>shared</option>
              {Array.from({ length: 8 }, (_, s) => <option key={s} value={s}>seat {s + 1}</option>)}
            </select>
            <select value={z.layout} onChange={(e) => patch(i, { layout: e.target.value as ZoneDef['layout'] })}>
              <option value="free">loose</option>
              <option value="row">in a row</option>
              <option value="fan">fanned</option>
              <option value="grid">on a grid</option>
              <option value="stack">in a pile</option>
            </select>
            <button className="icon" onClick={() => onChange(zones.filter((_, j) => j !== i))} title="Remove this zone">✕</button>
          </div>

          <details className="ref">
            <summary>Exact size and position</summary>
            {/* Position and size were format-only fields until the map above existed: a
                zone could not be placed without hand-editing JSON. They stay here for
                the cases the map cannot do — an exact width, a grid's dimensions. */}
            <div className="zone-row sub">
              <span className="field-label">id</span>
              <input value={z.id} onChange={(e) => patch(i, { id: e.target.value })} style={{ maxWidth: 110 }} aria-label="Zone id" />
              <span className="field-label">x / z</span>
              {num(z.x, (v) => patch(i, { x: v }), 'Centre across the table')}
              {num(z.z, (v) => patch(i, { z: v }), 'Centre toward your seat')}
              <span className="field-label">w / h</span>
              {num(z.w, (v) => patch(i, { w: v }), 'Width')}
              {num(z.h, (v) => patch(i, { h: v }), 'Depth')}
              {z.layout === 'grid' && (
                <>
                  <span className="field-label">grid</span>
                  {num(z.gridCols ?? 8, (v) => patch(i, { gridCols: Math.max(1, Math.round(v)) }), 'Columns', 1)}
                  {num(z.gridRows ?? 8, (v) => patch(i, { gridRows: Math.max(1, Math.round(v)) }), 'Rows', 1)}
                  <label className="inline">
                    <input
                      type="checkbox" checked={!!z.checkered}
                      onChange={(e) => patch(i, { checkered: e.target.checked })}
                    />
                    chequered
                  </label>
                </>
              )}
            </div>
          </details>
        </div>
      ))}
      <div className="chips">
        <button onClick={() => add('hand')}>Add a player's hand</button>
        <button onClick={() => add('public')}>Add a shared area</button>
        <button onClick={() => add('board')}>Add a board</button>
      </div>
    </div>
  );
}

function SetupList({ setup, zones, onChange }: {
  setup: GamePack['setup'];
  zones: ZoneDef[];
  onChange: (s: GamePack['setup']) => void;
}) {
  function patch(i: number, p: Partial<GamePack['setup'][number]>) {
    onChange(setup.map((s, j) => (i === j ? { ...s, ...p } : s)));
  }

  /** A step read back as a sentence, so a list of them can be skimmed. */
  function summarize(s: GamePack['setup'][number]): string {
    const what = s.componentIds.length ? s.componentIds.join(', ') : 'nothing yet';
    const where = s.zoneId === 'hand{seat}'
      ? "each seat's hand"
      : s.zoneId
        ? (zones.find((z) => z.id === s.zoneId)?.label ?? s.zoneId)
        : `the table at ${s.x}, ${s.z}`;
    const how = s.as === 'stack' ? 'as a pile' : s.as === 'grid' ? 'in a grid' : 'loose';
    return `Put ${what} ${how} in ${where}${s.perSeat ? ', once per seat' : ''}.`;
  }

  if (setup.length === 0) {
    return <p className="hint">Nothing is placed at the start. The table opens empty.</p>;
  }

  return (
    <div className="rows">
      {setup.map((s, i) => (
        <div className="zone-block" key={i}>
          <div className="row between">
            <span className="step-summary">{summarize(s)}</span>
            <button className="icon" onClick={() => onChange(setup.filter((_, j) => j !== i))} title="Remove this step">✕</button>
          </div>

          <div className="zone-row">
            <input
              value={s.componentIds.join(', ')}
              onChange={(e) => patch(i, { componentIds: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })}
              placeholder="deck:standard52, repeat:d6:2"
              aria-label="Which pieces"
            />
            <select value={s.as} onChange={(e) => patch(i, { as: e.target.value as 'stack' | 'loose' | 'grid' })}>
              <option value="stack">as a pile</option>
              <option value="loose">loose</option>
              <option value="grid">in a grid</option>
            </select>
            <select value={s.zoneId ?? ''} onChange={(e) => patch(i, { zoneId: e.target.value || null })}>
              <option value="">on the bare table</option>
              {zones.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
              <option value="hand{seat}">each seat's hand</option>
            </select>
          </div>

          <div className="zone-row sub">
            <label className="inline"><input type="checkbox" checked={s.faceUp} onChange={(e) => patch(i, { faceUp: e.target.checked })} /> face up</label>
            <label className="inline"><input type="checkbox" checked={s.shuffled} onChange={(e) => patch(i, { shuffled: e.target.checked })} /> shuffled</label>
            {/* perSeat is how a pack gives every player their own kit — chips, a set of
                pieces, a starting hand. It has always been in the format and never in
                this form, so nobody could reach it. */}
            <label className="inline">
              <input type="checkbox" checked={!!s.perSeat} onChange={(e) => patch(i, { perSeat: e.target.checked })} />
              once per seat
            </label>
            <span className="field-label">x / z</span>
            <input type="number" step={0.1} value={s.x} aria-label="Position across the table"
              onChange={(e) => patch(i, { x: Number(e.target.value) })} />
            <input type="number" step={0.1} value={s.z} aria-label="Position toward your seat"
              onChange={(e) => patch(i, { z: Number(e.target.value) })} />
            {s.as === 'grid' && (
              <>
                <span className="field-label">cols</span>
                <input type="number" step={1} value={s.gridCols ?? 4} aria-label="Grid columns"
                  onChange={(e) => patch(i, { gridCols: Math.max(1, Math.round(Number(e.target.value))) })} />
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
