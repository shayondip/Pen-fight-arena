import { useState } from 'react';

import {
  ATTRIBUTE_KEYS,
  ATTRIBUTE_META,
  MAX_ATTRIBUTE_LEVEL,
  PEN_SKINS,
  effectsFor,
  normalizeForRanked,
  upgradeCost,
} from '@pfa/shared';
import type { AttributeKey } from '@pfa/shared';

import { buyUpgrade, equipSkin } from '../net/api.js';
import { net } from '../net/socket.js';
import { store, useAppState } from '../state/store.js';

export function Workshop(): JSX.Element {
  const { profile } = useAppState();
  const [pending, setPending] = useState<string | null>(null);

  if (!profile) {
    return (
      <div className="overlay">
        <div className="sheet">
          <h2>Pen Workshop</h2>
          <p>Set a nickname on the menu first — that is what creates your profile.</p>
          <button type="button" className="button" onClick={() => store.navigate('menu')}>
            Back to menu
          </button>
        </div>
      </div>
    );
  }

  const secret = net.profileSecret;
  const ranked = normalizeForRanked(profile.attributes);
  const casualEffects = effectsFor(profile.attributes);
  const rankedEffects = effectsFor(ranked);

  const handleUpgrade = async (attribute: AttributeKey): Promise<void> => {
    if (!secret) {
      store.toast('Your profile token is missing. Reload the page.', 'error');
      return;
    }
    setPending(attribute);
    try {
      const updated = await buyUpgrade(profile.id, attribute, secret);
      store.set({ profile: updated });
      store.toast(`${ATTRIBUTE_META[attribute].label} raised to ${updated.attributes[attribute]}.`, 'good');
    } catch (error) {
      store.toast(error instanceof Error ? error.message : 'Upgrade failed.', 'warn');
    } finally {
      setPending(null);
    }
  };

  const handleSkin = async (skinId: string): Promise<void> => {
    if (!secret) {
      store.toast('Your profile token is missing. Reload the page.', 'error');
      return;
    }
    setPending(skinId);
    try {
      const updated = await equipSkin(profile.id, skinId, secret);
      store.set({ profile: updated });
    } catch (error) {
      store.toast(error instanceof Error ? error.message : 'Could not equip that skin.', 'warn');
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="overlay">
      <div className="sheet sheet--wide sheet--tilt">
        <div className="masthead">
          <div>
            <h2>Pen Workshop</h2>
            <p className="masthead__sub">Upgrades apply in full in casual, normalised in ranked.</p>
          </div>
          <span className="wallet">{profile.coins} Pen Coins</span>
        </div>

        {ATTRIBUTE_KEYS.map((key) => {
          const level = profile.attributes[key];
          const cost = upgradeCost(key, level);
          const rankedLevel = ranked[key];
          const maxed = level >= MAX_ATTRIBUTE_LEVEL;

          return (
            <div className="attr" key={key}>
              <div>
                <span className="attr__name">{ATTRIBUTE_META[key].label}</span>
                <div className="pips" aria-label={`Level ${level} of ${MAX_ATTRIBUTE_LEVEL}`}>
                  {Array.from({ length: MAX_ATTRIBUTE_LEVEL }, (_unused, index) => {
                    const on = index < level;
                    const inRanked = index < rankedLevel;
                    return (
                      <span
                        key={index}
                        className={`pip${on ? (inRanked ? ' pip--ranked' : ' pip--on') : ''}`}
                      />
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                className="button button--small"
                disabled={maxed || cost === null || profile.coins < cost || pending !== null}
                onClick={() => void handleUpgrade(key)}
              >
                {maxed ? 'Maxed' : `Upgrade — ${cost}`}
              </button>

              <p className="attr__desc">
                {ATTRIBUTE_META[key].description} In ranked this counts as level {rankedLevel}.
              </p>
            </div>
          );
        })}

        <h3 style={{ marginTop: 22 }}>What your pen does right now</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Property</th>
              <th className="numeric">Casual</th>
              <th className="numeric">Ranked</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Launch speed</td>
              <td className="numeric">{Math.round(casualEffects.launchSpeedMult * 100)}%</td>
              <td className="numeric">{Math.round(rankedEffects.launchSpeedMult * 100)}%</td>
            </tr>
            <tr>
              <td>Pen mass</td>
              <td className="numeric">{Math.round(casualEffects.massMult * 100)}%</td>
              <td className="numeric">{Math.round(rankedEffects.massMult * 100)}%</td>
            </tr>
            <tr>
              <td>Aim scatter at full power</td>
              <td className="numeric">{casualEffects.aimSpreadDeg.toFixed(1)}°</td>
              <td className="numeric">{rankedEffects.aimSpreadDeg.toFixed(1)}°</td>
            </tr>
            <tr>
              <td>Shot cooldown</td>
              <td className="numeric">{(casualEffects.cooldownMs / 1000).toFixed(2)}s</td>
              <td className="numeric">{(rankedEffects.cooldownMs / 1000).toFixed(2)}s</td>
            </tr>
          </tbody>
        </table>

        <h3 style={{ marginTop: 22 }}>Pen skins</h3>
        <div className="skin-grid">
          {PEN_SKINS.map((skin) => {
            const owned = profile.ownedSkins.includes(skin.id);
            const equipped = profile.skinId === skin.id;
            return (
              <button
                key={skin.id}
                type="button"
                className="skin"
                aria-pressed={equipped}
                disabled={pending !== null || (!owned && profile.coins < skin.cost)}
                onClick={() => void handleSkin(skin.id)}
              >
                <span
                  className="skin__swatch"
                  style={{ background: `linear-gradient(90deg, ${skin.barrel}, ${skin.accent})` }}
                />
                <span className="skin__name">{skin.name}</span>
                <br />
                <span className="skin__price">
                  {equipped ? 'Equipped' : owned ? 'Equip' : `${skin.cost} coins`}
                </span>
              </button>
            );
          })}
        </div>

        <div className="button-row" style={{ marginTop: 22 }}>
          <button type="button" className="button button--ghost" onClick={() => store.navigate('menu')}>
            Back to menu
          </button>
        </div>
      </div>
    </div>
  );
}
