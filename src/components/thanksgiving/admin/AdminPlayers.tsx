import { useState } from 'react';
import type { Player } from '../../../lib/thanksgiving/view';
import { ActionButton } from './AdminApp';

type Call = (body: Record<string, unknown>) => Promise<unknown>;

export function AdminPlayers({ players, call }: { players: Player[]; call: Call }) {
  return (
    <section className="tg-card">
      <h2>Players ({players.length})</h2>
      {players.length === 0 ? <p className="muted">Nobody has joined yet.</p> : (
        <ul className="tg-admin-players">
          {players.map((p) => <PlayerRow key={p.id} player={p} call={call} />)}
        </ul>
      )}
    </section>
  );
}

function PlayerRow({ player, call }: { player: Player; call: Call }) {
  const [name, setName] = useState(player.name);
  return (
    <li>
      <input aria-label={`Rename ${player.name}`} value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
      <ActionButton label="Rename" run={() => call({ action: 'renamePlayer', playerId: player.id, name })} />
      {player.hasPin && <ActionButton label="Reset PIN" run={() => call({ action: 'resetPin', playerId: player.id })} />}
      <ActionButton
        label="Remove"
        danger
        run={async () => {
          if (!window.confirm(`Remove ${player.name} and all their picks?`)) return;
          await call({ action: 'removePlayer', playerId: player.id });
        }}
      />
    </li>
  );
}
