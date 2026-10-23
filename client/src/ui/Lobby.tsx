import { useState } from 'react';

import { getArena } from '@pfa/shared';
import type { PlayerSlot, RoomView } from '@pfa/shared';

import { net } from '../net/socket.js';
import { store, useAppState } from '../state/store.js';

function SeatRow({
  slot,
  room,
  isYou,
}: {
  slot: PlayerSlot;
  room: RoomView;
  isYou: boolean;
}): JSX.Element {
  const player = room.players.find((candidate) => candidate.slot === slot);

  if (!player) {
    return (
      <li className={`seat seat--${slot.toLowerCase()} seat--empty`}>
        <span className="seat__name">Waiting for a player…</span>
        <span className="seat__meta">Seat {slot}</span>
      </li>
    );
  }

  return (
    <li className={`seat seat--${slot.toLowerCase()}`}>
      <span className="seat__name">
        {player.profile.nickname}
        {isYou ? ' (you)' : ''}
      </span>
      <span className="seat__meta">
        {player.profile.rating} rating · {player.profile.wins}W
      </span>
      {!player.connected ? (
        <span className="pill pill--offline">Reconnecting</span>
      ) : player.ready ? (
        <span className="pill pill--ready">Ready</span>
      ) : (
        <span className="pill">Not ready</span>
      )}
    </li>
  );
}

export function Lobby(): JSX.Element {
  const { room, slot, storage } = useAppState();
  const [ready, setReady] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!room) {
    return (
      <div className="overlay">
        <div className="sheet">
          <h2>No room</h2>
          <p>You are not in a room any more.</p>
          <button type="button" className="button" onClick={() => store.navigate('menu')}>
            Back to menu
          </button>
        </div>
      </div>
    );
  }

  const arena = getArena(room.arenaId);
  const bothSeated = room.players.length === 2;

  const copyInvite = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(room.inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      store.toast(`Invite link: ${room.inviteUrl}`, 'info');
    }
  };

  const toggleReady = (): void => {
    const next = !ready;
    setReady(next);
    net.setReady(next);
  };

  return (
    <div className="overlay">
      <div className="sheet sheet--tilt">
        <div className="masthead">
          <div>
            <h2>Room</h2>
            <p className="masthead__sub">
              {room.mode === 'ranked' ? 'Ranked' : 'Casual'} · {arena.name}
            </p>
          </div>
        </div>

        <div className="roomcode">
          <span className="roomcode__value">{room.code}</span>
          <button type="button" className="button button--ghost button--small" onClick={() => void copyInvite()}>
            {copied ? 'Link copied' : 'Copy invite link'}
          </button>
        </div>

        <p style={{ marginTop: 10 }}>
          Send that code, or the invite link, to the person you want to play. Testing on your own
          machine? Open the link in a second browser, or add <code>?guest=1</code> to it so the tab
          gets its own profile.
        </p>

        <ul className="seat-list">
          <SeatRow slot="A" room={room} isYou={slot === 'A'} />
          <SeatRow slot="B" room={room} isYou={slot === 'B'} />
        </ul>

        {room.mode === 'ranked' ? (
          <p>
            Ranked normalises pen attributes for both players, so the match is decided by aim and
            timing rather than by who has spent more coins.
          </p>
        ) : null}

        <div className="button-row button-row--split" style={{ marginTop: 18 }}>
          <button
            type="button"
            className={ready ? 'button button--ghost' : 'button'}
            onClick={toggleReady}
            disabled={!bothSeated}
          >
            {ready ? 'Cancel ready' : bothSeated ? "I'm ready" : 'Waiting for an opponent'}
          </button>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => {
              net.leaveRoom();
              store.navigate('menu');
            }}
          >
            Leave room
          </button>
        </div>

        <p className="storage-note">
          Both players ready starts a three second countdown.{' '}
          {storage?.kind === 'local-json'
            ? 'This server is using local development storage, so results are saved on this machine only.'
            : ''}
        </p>
      </div>
    </div>
  );
}
