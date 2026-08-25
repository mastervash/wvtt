/**
 * The pack editor.
 *
 * Four tabs, in the order people actually work: describe the game and let a model draft
 * it, adjust the components and zones, write the rules, then export or load it.
 *
 * Everything here operates on a plain JSON pack. There is no privileged format for
 * built-in games — "Duplicate this table's pack" hands you exactly what chess or poker
 * is made of, which is the fastest way to learn the format.
 */

import { useMemo, useState } from 'react';
import {
  buildPrompt, GAME_SHAPES, TURN_STRUCTURES, WIN_CONDITIONS, COMPONENT_SETS,
  scriptApiReference, standardDeck, textDeck, diceSet, chipSet, tokenSet,
  type GamePack, type ComponentDef, type ZoneDef,
} from '@wvtt/shared';
import { useStore } from '../net/store';
import { CodeEditor } from './CodeEditor';

type Tab = 'design' | 'pieces' | 'rules' | 'share';

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

export function Editor({ onClose }: { onClose: () => void }) {
  const room = useStore((s) => s.room);
  const livePack = useStore((s) => s.pack);
  const showToast = useStore((s) => s.showToast);

  const [tab, setTab] = useState<Tab>('design');
  const [pack, setPack] = useState<GamePack>(() => structuredClone(livePack ?? BLANK));
  const [raw, setRaw] = useState('');
  const [rawOpen, setRawOpen] = useState(false);

  // Prompt generator inputs.
  const [description, setDescription] = useState('');
  const [shape, setShape] = useState('trick');
  const [turns, setTurns] = useState('clockwise');
  const [win, setWin] = useState('points');
  const [comps, setComps] = useState<string[]>(['cards52']);
  const [useBase, setUseBase] = useState(false);

  const json = useMemo(() => JSON.stringify(pack, null, 2), [pack]);

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
    room.send('loadPack', { packJson: JSON.stringify(pack) });
    showToast('Loading pack onto the table…');
    onClose();
  }

  function importJson(text: string) {
    try {
      const parsed = JSON.parse(text) as GamePack;
      if (!parsed?.manifest) throw new Error('That JSON has no manifest.');
      setPack(parsed);
      setRawOpen(false);
      showToast('Pack imported into the editor.');
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
        <strong>Pack editor</strong>
        <nav>
          {(['design', 'pieces', 'rules', 'share'] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {t === 'design' ? 'Describe' : t === 'pieces' ? 'Pieces & zones' : t === 'rules' ? 'Rules' : 'Export'}
            </button>
          ))}
        </nav>
        <button className="icon" onClick={onClose} title="Close">✕</button>
      </header>

      <div className="editor-body">
        {tab === 'design' && (
          <>
            <p className="lead">
              Describe the game you want, pick a few options, then copy the generated prompt into
              any AI assistant. Paste what it gives you back under Export and load it onto the table.
            </p>

            <label>
              What is the game?
              <textarea
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. A three-player trick-taking game where hearts are worth minus one and the queen of spades is minus five."
              />
            </label>

            <div className="grid2">
              <Choice label="Game shape" list={GAME_SHAPES} value={shape} onChange={setShape} />
              <Choice label="Turn structure" list={TURN_STRUCTURES} value={turns} onChange={setTurns} />
              <Choice label="Winning" list={WIN_CONDITIONS} value={win} onChange={setWin} />
              <div className="field">
                <span>Players</span>
                <div className="row">
                  <input
                    type="number" min={1} max={12} value={pack.manifest.minSeats}
                    onChange={(e) => patchManifest({ minSeats: Number(e.target.value) })}
                  />
                  <span className="to">to</span>
                  <input
                    type="number" min={1} max={12} value={pack.manifest.maxSeats}
                    onChange={(e) => patchManifest({ maxSeats: Number(e.target.value) })}
                  />
                </div>
              </div>
            </div>

            <div className="field">
              <span>Components</span>
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

            <label className="check">
              <input type="checkbox" checked={useBase} onChange={(e) => setUseBase(e.target.checked)} />
              Include the current pack so the assistant modifies it instead of starting fresh
            </label>

            <div className="prompt-out">
              <div className="row between">
                <span className="field-label">Generated prompt</span>
                <button className="primary" onClick={() => copy(prompt, 'Prompt')}>Copy prompt</button>
              </div>
              <textarea readOnly rows={12} value={prompt} onClick={(e) => e.currentTarget.select()} />
            </div>
          </>
        )}

        {tab === 'pieces' && (
          <>
            <div className="grid2">
              <label>Name<input value={pack.manifest.name} onChange={(e) => patchManifest({ name: e.target.value })} /></label>
              <label>Id<input value={pack.manifest.id} onChange={(e) => patchManifest({ id: e.target.value })} /></label>
              <label>Author<input value={pack.manifest.author} onChange={(e) => patchManifest({ author: e.target.value })} /></label>
              <label>Felt colour<input type="color" value={pack.manifest.tableColor ?? '#1f6f4a'} onChange={(e) => patchManifest({ tableColor: e.target.value })} /></label>
            </div>
            <label>Description<textarea rows={2} value={pack.manifest.description} onChange={(e) => patchManifest({ description: e.target.value })} /></label>

            <h4>Add components ({pack.components.length} defined)</h4>
            <div className="chips">
              <button onClick={() => addComponents(standardDeck(false), 'a 52-card deck')}>52-card deck</button>
              <button onClick={() => addComponents(standardDeck(true), 'a deck with jokers')}>+ jokers</button>
              <button onClick={() => addComponents(chipSet(), 'poker chips')}>Chips</button>
              <button onClick={() => addComponents(diceSet(), 'dice')}>Dice</button>
              <button onClick={() => addComponents(tokenSet(), 'tokens')}>Tokens</button>
              <button onClick={() => setPack((p) => ({ ...p, components: [] }))}>Clear all</button>
            </div>

            <TextDeckBuilder onAdd={(lines, prefix) => addComponents(textDeck(prefix, lines), `${lines.length} text cards`)} />

            <h4>Zones ({pack.zones.length})</h4>
            <p className="hint">
              A zone's visibility is what makes hidden information work. "owner" means only the
              player in that seat can read the faces of pieces inside it.
            </p>
            <ZoneList zones={pack.zones} onChange={(zones) => setPack((p) => ({ ...p, zones }))} />

            <h4>Setup ({pack.setup.length} steps)</h4>
            <SetupList
              setup={pack.setup}
              zones={pack.zones}
              onChange={(setup) => setPack((p) => ({ ...p, setup }))}
            />
            <button onClick={addSetupStep}>Add setup step</button>
          </>
        )}

        {tab === 'rules' && (
          <>
            <p className="lead">
              Rules are optional. Without a script the table is a pure sandbox. A script only takes
              effect when the room's rules setting is Advisory or Enforced.
            </p>
            <CodeEditor
              value={pack.script ?? ''}
              onChange={(script) => setPack((p) => ({ ...p, script }))}
              height="340px"
            />
            <details className="ref">
              <summary>Script API reference</summary>
              <pre>{scriptApiReference()}</pre>
            </details>
          </>
        )}

        {tab === 'share' && (
          <>
            <p className="lead">
              A pack is one JSON blob. Copy it to share it, or paste one in to play someone else's.
            </p>
            {pack.script?.trim() && (
              <div className="warn">
                <strong>This pack carries a rules script.</strong> Scripts run on the server and can
                read the whole table, including face-down cards. They are sandboxed — no network, no
                filesystem, no access to anything outside the game — but a pack you did not write is
                trusted the way a human dealer is trusted. You can switch rules off at any time to
                stop it.
              </div>
            )}

            <div className="row wrap">
              <button className="primary" onClick={loadIntoTable} disabled={!room}>Load onto this table</button>
              <button onClick={() => copy(json, 'Pack JSON')}>Copy pack JSON</button>
              <button onClick={download}>Download .wvtt.json</button>
              <button onClick={() => { setRaw(''); setRawOpen(true); }}>Paste a pack</button>
            </div>

            {rawOpen && (
              <div className="paste">
                <textarea
                  rows={10}
                  value={raw}
                  onChange={(e) => setRaw(e.target.value)}
                  placeholder="Paste pack JSON here — including something an AI assistant generated for you."
                />
                <div className="row">
                  <button className="primary" onClick={() => importJson(raw)}>Import</button>
                  <button onClick={() => setRawOpen(false)}>Cancel</button>
                </div>
              </div>
            )}

            <h4>Current pack</h4>
            <textarea className="mono" readOnly rows={14} value={json} onClick={(e) => e.currentTarget.select()} />
          </>
        )}
      </div>
    </div>
  );
}

function Choice({ label, list, value, onChange }: {
  label: string;
  list: { id: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {list.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
    </div>
  );
}

function TextDeckBuilder({ onAdd }: { onAdd: (lines: string[], prefix: string) => void }) {
  const [text, setText] = useState('');
  const [prefix, setPrefix] = useState('c');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  return (
    <div className="subpanel">
      <span className="field-label">Text deck — one card per line</span>
      <textarea
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'Name a fruit\nName a country\nName a film'}
      />
      <div className="row">
        <input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="id prefix" style={{ maxWidth: 120 }} />
        <button disabled={lines.length === 0} onClick={() => { onAdd(lines, prefix || 'c'); setText(''); }}>
          Add {lines.length} card{lines.length === 1 ? '' : 's'}
        </button>
      </div>
    </div>
  );
}

function ZoneList({ zones, onChange }: { zones: ZoneDef[]; onChange: (z: ZoneDef[]) => void }) {
  function patch(i: number, p: Partial<ZoneDef>) {
    onChange(zones.map((z, j) => (i === j ? { ...z, ...p } : z)));
  }
  return (
    <div className="rows">
      {zones.map((z, i) => (
        <div className="zone-row" key={i}>
          <input value={z.id} onChange={(e) => patch(i, { id: e.target.value })} placeholder="id" />
          <input value={z.label} onChange={(e) => patch(i, { label: e.target.value })} placeholder="label" />
          <select value={z.visibility} onChange={(e) => patch(i, { visibility: e.target.value as ZoneDef['visibility'] })}>
            <option value="public">public</option>
            <option value="owner">owner only</option>
            <option value="hidden">hidden</option>
            <option value="inherit">inherit</option>
          </select>
          <select value={z.layout} onChange={(e) => patch(i, { layout: e.target.value as ZoneDef['layout'] })}>
            <option value="free">free</option>
            <option value="row">row</option>
            <option value="fan">fan</option>
            <option value="grid">grid</option>
            <option value="stack">stack</option>
          </select>
          <input
            type="number" value={z.ownerSeat ?? -1} title="Owning seat, or -1 for shared"
            onChange={(e) => patch(i, { ownerSeat: Number(e.target.value) < 0 ? null : Number(e.target.value) })}
          />
          <button className="icon" onClick={() => onChange(zones.filter((_, j) => j !== i))} title="Remove">✕</button>
        </div>
      ))}
      <button onClick={() => onChange([...zones, {
        id: `zone${zones.length}`, label: 'New zone', ownerSeat: null, visibility: 'public',
        x: 0, z: 0, w: 2, h: 1.4, layout: 'free',
      }])}>
        Add zone
      </button>
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
  return (
    <div className="rows">
      {setup.map((s, i) => (
        <div className="zone-row" key={i}>
          <input
            value={s.componentIds.join(', ')}
            onChange={(e) => patch(i, { componentIds: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })}
            placeholder="deck:standard52, repeat:d6:2"
          />
          <select value={s.as} onChange={(e) => patch(i, { as: e.target.value as 'stack' | 'loose' | 'grid' })}>
            <option value="stack">as a pile</option>
            <option value="loose">loose</option>
            <option value="grid">in a grid</option>
          </select>
          <select value={s.zoneId ?? ''} onChange={(e) => patch(i, { zoneId: e.target.value || null })}>
            <option value="">no zone</option>
            {zones.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
            <option value="hand{seat}">each seat's hand</option>
          </select>
          <label className="inline"><input type="checkbox" checked={s.faceUp} onChange={(e) => patch(i, { faceUp: e.target.checked })} /> face up</label>
          <label className="inline"><input type="checkbox" checked={s.shuffled} onChange={(e) => patch(i, { shuffled: e.target.checked })} /> shuffled</label>
          <button className="icon" onClick={() => onChange(setup.filter((_, j) => j !== i))} title="Remove">✕</button>
        </div>
      ))}
    </div>
  );
}
