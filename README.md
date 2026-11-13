# Bounce Arena

A competitive arena where you are a bouncing ball. Speed is power: build momentum, spend it on a hit, or give it up to stay alive.

## Play

```bash
npm install
npm run dev
```

Open the local URL. `npm test` runs the physics, match, and progression tests. `npm run build` typechecks and bundles.

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Steer | WASD (arrows too, without a local player 2) | Left stick or d-pad |
| Dash | Space | A, RT, or RB |
| Ability | F or E | B or X |
| Brake | Shift | LT or LB |
| Emote | G | Y |
| Pause | Esc | Start |

- Player 2: arrow keys, Enter dash, Right Ctrl ability, Right Shift brake, or a second gamepad.
- In menus a gamepad moves focus with the stick or d-pad. A presses, B goes back, and Start queues.
- On touch screens, touching anywhere on the left half plants a floating stick under your thumb. Dash, ability, and brake sit on the right, with cooldown rings.
- Pad rumble and phone vibration follow hits and knockouts. They can be turned off in Settings.

## What a match is

Free-for-all is the default: three stocks, about 80 seconds, then sudden death if more than one ball remains. Falling off the arena is the knockout. A faster, heavier contact launches a slower ball. Dash is a redirect with a cooldown, and a dash on landing is stronger. Abilities are decisions, not flat power.

**Heat.** Every hit you take raises your heat, shown as the % beside your name and above your speed gauge. Each 100% makes the next launch 80% stronger. Heat resets when you lose a stock, so a stock builds from safe trades to a dangerous finish. Glancing bumps barely count; committed strikes do. Tuning is in `src/data/tuning.ts` (`heatGain`, `heatScale`).

**Launch steering.** While you are being hit, steering sideways bends your launch up to about 9 degrees (`diAngle`). Steering along the rim is often the difference between a save and a knockout.

**Daily Twist.** The menu features one mode and two mutators each day, the same for everyone on that date: low gravity, giants, hyper speed, dash frenzy, glass cannons, black ice, or overheat. See `MUTATORS` and `dailyTwist` in `src/data/content.ts`.

**Bots.** Bots re-aim often but only commit to a dash or ability after a human reaction time: about 420 ms for a rookie and 180 ms for a champion. Their aim error shrinks with skill but never reaches zero, and they spread out instead of piling onto one ball. In casual play, a player's first matches use slower bots that give humans a short warm-up, and a run of bottom-half finishes eases them a little. Only bot pace and aim change, never the physics, and never in ranked (`botEase` in `src/game/setup.ts`).

Ranked matches use a standard ball (stable core, rubber shell, no passive). The ability you picked is the only signature. Account level, mastery, and cosmetics do not change competitive hits.

## Progression

Everything earned is cosmetic or coins. Nothing changes a hit.

- **Account level** (cap 80): coins every level, a bigger payout every fifth, cosmetics through level 30. Match xp is itemized on the results screen: placement, knockouts, time, day streak, first win of the day, win streak.
- **Mastery**: ten levels for each core and each ability. Level-ups pay coins, cores unlock cosmetics, and every ability has a title at mastery 5. Forfeits earn none.
- **Challenges**: three daily and three weekly, one reroll a day, and a sweep bonus for clearing a full set. Completing one also pays season xp.
- **Season track**: 16 tiers per season, then repeatable overtime coins. When a season ends you get coins for your peak rank, plus a season title at Gold or higher, and the season goes into your history.
- **Ranked**: five placement matches, a three-match shield after a promotion so one loss cannot drop you straight back, and a small bonus from the third ranked win in a row.
- **Awards**: fifteen three-tier achievements built on career stats, each ending in a cosmetic.

Rewards added after a player already passed them are paid when the profile loads and shown once on the menu. Saves from before these changes migrate on load (`migrateProfile`).

## Feel, audio, and accessibility

- The sim ticks at a fixed 60 Hz. The renderer blends between ticks, so motion stays smooth on 120/144 Hz screens.
- Hitstop scales with hit power, and the struck ball shudders during the freeze. Shake is trauma based, and the deciding knockout gets a slow-motion finish.
- Audio is fully procedural. Every ability has its own sound, sounds are panned by position and capped per voice, and the music ducks on knockouts, all through a master limiter. The music is a sequencer with layers that build from menu to match to final phase to sudden death.
- Leaving the tab pauses the match and silences audio.
- Settings include separate effects and music volume, screen shake, a screen-flash toggle for photosensitive players, reduced effects, stronger ball patterns, UI scale, stick deadzone, haptics, and Practice speed (50–100%, Practice and Tutorial only). `prefers-reduced-motion` is respected.

## Install and offline

Production builds register a service worker (`public/sw.js`) and ship a web manifest, so the game installs as an app and plays offline after the first load. Page loads are network first, so a deploy is picked up right away. Hashed assets are cache first.

## Layout

- `src/sim` authoritative match, physics, hazards, abilities, bots, replay input log
- `src/data` tuning and content definitions
- `src/progression` profile, rank, challenges, season track
- `src/render`, `src/audio`, `src/ui` presentation
- `src/game` setup and the browser shell

The session accepts inputs only. Positions, eliminations, and rewards come from the sim. A network adapter can feed the same `submit` path later.
