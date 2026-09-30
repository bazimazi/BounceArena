# Bounce Arena

A competitive arena where you are a bouncing ball. Speed is power: build momentum, spend it on a hit, or give it up to stay alive.

## Play

```bash
npm install
npm run dev
```

Open the local URL. `npm test` runs the physics, match, and progression tests. `npm run build` typechecks and bundles.

## Controls

- WASD steer
- Space dash
- F ability
- Shift brake
- G emote
- Player 2: arrow keys, Enter dash, Right Ctrl ability, Right Shift brake

Touch screens get a stick plus dash, ability, and brake.

## What a match is

Free-for-all is the default: three stocks, about 80 seconds, then sudden death if more than one ball remains. Falling off the arena is the knockout. A faster, heavier contact launches a slower ball. Dash is a redirect with a cooldown, and a dash on landing is stronger. Abilities are decisions, not flat power.

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

## Layout

- `src/sim` authoritative match, physics, hazards, abilities, bots, replay input log
- `src/data` tuning and content definitions
- `src/progression` profile, rank, challenges, season track
- `src/render`, `src/audio`, `src/ui` presentation
- `src/game` setup and the browser shell

The session accepts inputs only. Positions, eliminations, and rewards come from the sim. A network adapter can feed the same `submit` path later.
