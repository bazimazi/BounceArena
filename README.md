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

## Layout

- `src/sim` authoritative match, physics, hazards, abilities, bots, replay input log
- `src/data` tuning and content definitions
- `src/progression` profile, rank, challenges, season track
- `src/render`, `src/audio`, `src/ui` presentation
- `src/game` setup and the browser shell

The session accepts inputs only. Positions, eliminations, and rewards come from the sim. A network adapter can feed the same `submit` path later.
