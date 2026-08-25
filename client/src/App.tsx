import { useStore } from './net/store';
import { Table } from './render/Table';
import { Lobby } from './ui/Lobby';
import { Hud } from './ui/Hud';

export function App() {
  const phase = useStore((s) => s.phase);

  if (phase === 'playing') {
    return (
      <div className="app">
        <Table />
        <Hud />
      </div>
    );
  }
  return <Lobby />;
}
