import { sfx } from '../audio/sfx.js';
import { store, useAppState } from '../state/store.js';
import { StorageNote } from './StorageNote.js';

const QUALITIES: { id: 'low' | 'medium' | 'high'; label: string; note: string }[] = [
  { id: 'low', label: 'Low', note: 'Smaller shadows, lower pixel ratio. Best on phones.' },
  { id: 'medium', label: 'Medium', note: 'Balanced. A good default for laptops.' },
  { id: 'high', label: 'High', note: 'Full shadow resolution. Needs a dedicated GPU to stay at 60.' },
];

export function Settings(): JSX.Element {
  const { settings, storage, pingMs, connected } = useAppState();

  return (
    <div className="overlay">
      <div className="sheet sheet--tilt">
        <div className="masthead">
          <div>
            <h2>Settings</h2>
            <p className="masthead__sub">Saved in this browser.</p>
          </div>
        </div>

        <div className="toggle-row">
          <div>
            <div className="toggle-row__label">Sound effects</div>
            <p className="toggle-row__hint">All sounds are generated in the browser — no audio files.</p>
          </div>
          <button
            type="button"
            className={settings.sfxEnabled ? 'button button--small' : 'button button--ghost button--small'}
            onClick={() => {
              store.updateSettings({ sfxEnabled: !settings.sfxEnabled });
              sfx.unlock();
              sfx.syncVolume();
              if (!settings.sfxEnabled) sfx.play('click');
            }}
          >
            {settings.sfxEnabled ? 'On' : 'Off'}
          </button>
        </div>

        <div className="toggle-row">
          <div>
            <div className="toggle-row__label">Volume</div>
            <p className="toggle-row__hint">{Math.round(settings.masterVolume * 100)}%</p>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.masterVolume}
            onChange={(event) => {
              store.updateSettings({ masterVolume: Number(event.target.value) });
              sfx.syncVolume();
            }}
            onMouseUp={() => sfx.play('click')}
          />
        </div>

        <div className="toggle-row">
          <div>
            <div className="toggle-row__label">Aim sensitivity</div>
            <p className="toggle-row__hint">
              Higher means a shorter drag reaches full power. {settings.aimSensitivity.toFixed(1)}×
            </p>
          </div>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.1}
            value={settings.aimSensitivity}
            onChange={(event) =>
              store.updateSettings({ aimSensitivity: Number(event.target.value) })
            }
          />
        </div>

        <div className="toggle-row">
          <div>
            <div className="toggle-row__label">Show control hints</div>
            <p className="toggle-row__hint">The one-line reminder under the power bar.</p>
          </div>
          <button
            type="button"
            className={settings.showHints ? 'button button--small' : 'button button--ghost button--small'}
            onClick={() => store.updateSettings({ showHints: !settings.showHints })}
          >
            {settings.showHints ? 'On' : 'Off'}
          </button>
        </div>

        <h3 style={{ marginTop: 20 }}>Graphics</h3>
        <div className="choice-grid">
          {QUALITIES.map((option) => (
            <button
              key={option.id}
              type="button"
              className="choice"
              aria-pressed={settings.quality === option.id}
              onClick={() => store.updateSettings({ quality: option.id })}
            >
              <span className="choice__name">{option.label}</span>
              <span className="choice__note">{option.note}</span>
            </button>
          ))}
        </div>

        <div className="button-row" style={{ marginTop: 20 }}>
          <button type="button" className="button button--ghost" onClick={() => store.navigate('menu')}>
            Back to menu
          </button>
        </div>

        <p className="storage-note">
          Connection: {connected ? `online, ${pingMs} ms round trip` : 'offline'}
        </p>
        <StorageNote storage={storage} />
      </div>
    </div>
  );
}
