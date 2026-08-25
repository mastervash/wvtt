/**
 * A thin CodeMirror 6 wrapper.
 *
 * CodeMirror is created once and fed changes imperatively; re-creating the editor on
 * every keystroke would lose the cursor and the undo history.
 */

import { useEffect, useRef } from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';

interface Props {
  value: string;
  onChange: (v: string) => void;
  height?: string;
}

export function CodeEditor({ value, onChange, height = '300px' }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        javascript(),
        oneDark,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) latest.current(u.state.doc.toString());
        }),
        EditorView.theme({ '&': { height, fontSize: '13px' } }),
      ],
    });
    const v = new EditorView({ state, parent: host.current });
    view.current = v;
    return () => { v.destroy(); view.current = null; };
    // Deliberately mounts once: `value` is pushed in via the effect below.
  }, []);

  // Accept programmatic changes (loading a pack, pasting LLM output) without
  // clobbering what the user is currently typing.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (current === value) return;
    v.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  return <div className="code-host" ref={host} />;
}
