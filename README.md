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

Free-for-all is the default: three stocks and an 80-second clock (most lobbies are decided in about a minute), then sudden death if more than one ball remains. Once you are out, the rest of the match fast-forwards, and RESULTS skips straight to the end. Falling off the arena is the knockout. A faster, heavier contact launches a slower ball. Dash is a redirect with a cooldown, and a dash on landing is a **perfect dash**: stronger, partly refunded, and called out on screen. Abilities are decisions, not flat power.

A dash or ability pressed up to 150 ms before its cooldown ends is buffered and fires the moment it is ready (`inputBuffer`). The open arenas (Classic, Pinball, Gravity, Ricochet, Turbine) start tightening at 30 seconds, so a match builds toward its finish instead of stalling (`shrinkRate`, `shrinkDelay` in `src/data/content.ts`).

**Heat.** Every hit you take raises your heat, shown as the % beside your name and above your speed gauge. Each 100% makes the next launch 80% stronger. Heat resets when you lose a stock, so a stock builds from safe trades to a dangerous finish. Glancing bumps barely count; committed strikes do. Base launches sit well under the speed cap (`launchScale`), so a fresh ball survives a hit near the rim and heat is what turns the same hit into a knockout. Tuning is in `src/data/tuning.ts` (`heatGain`, `heatScale`, `launchScale`).

**Launch stun.** A strike whose heat-scaled power passes `stunFloor` takes control away for up to 0.45 s: the ball tumbles with dizzy eyes and a white launch streak, and cannot steer, dash, or cast. Stun grows with *uncapped* power, so heat keeps mattering past the speed cap. A dash or ability pressed during stun is buffered and fires the moment control returns. This is what makes knockouts belong to the hitter: nobody, bot or human, can react out of a real launch.

**The edge: teeter, claw, recover.** The rim's lip stops a ball that is simply rolling. A ball that goes over without stun (an overshot dash, a light hit) *teeters*: it hangs on the brink a little longer (`teeter`), wobbling with a "!" over it, and its outward speed bleeds off unless it is jumping toward floor ahead. Holding toward the floor claws it back (`clawAccel`); your own ball shows chevrons pointing home. Over the edge with dash on cooldown, you still get one weaker recovery dash per trip (`recoverSpeed`), and a dash toward the floor while falling pops the ball up (`recoverHop`). A stunned ball gets none of this. Players who have not yet saved themselves get a coaching line the first time it happens.

**Launch steering.** While you are being hit, steering sideways bends your launch up to about 9 degrees (`diAngle`). Steering along the rim is often the difference between a save and a knockout.

**Daily Twist.** The menu features one mode and two mutators each day, the same for everyone on that date: low gravity, giants, hyper speed, dash frenzy, glass cannons, black ice, or overheat. See `MUTATORS` and `dailyTwist` in `src/data/content.ts`.

**Bots.** Bots re-aim often but only commit to a dash or ability after a human reaction time: about 420 ms for a rookie and 180 ms for a champion. They also have to *notice* the edge before steering home (about 200 ms for a rookie, 70 ms for a champion), sometimes misread a scare and react late, and cannot act through launch stun, so a well-aimed launch beats a bot's recovery. On split floors (Islands, Moving) they leap gaps with a committed dash instead of camping one platform, and skilled bots avoid ramming an Anchor or a Mirror. The tutorial rival is a sparring partner: it notices the edge late, never saves with a dash, takes launches harder, and tires after 25 s so every learner gets the knockout. Their aim error shrinks with skill but never reaches zero, and they spread out instead of piling onto one ball. In casual play, a player's first matches use slower bots that give humans a short warm-up, and a run of bottom-half finishes eases them a little. Only bot pace and aim change, never the physics, and never in ranked (`botEase` in `src/game/setup.ts`).

Ranked matches use a standard ball (stable core, rubber shell, no passive). The ability you picked is the only signature. Account level, mastery, and cosmetics do not change competitive hits.

## Progression

Everything earned is cosmetic or coins. Nothing changes a hit. Pick your name and ball colour in Loadout, which also shows your core and shell as stat bars against the Stable/Rubber baseline. In menus, Q and E switch top tabs and Esc goes back.

- **Account level** (cap 80): coins every level, a bigger payout every fifth, cosmetics through level 30. Match xp is itemized on the results screen: placement, knockouts, time, day streak, first win of the day, win streak.
- **Mastery**: ten levels for each core and each ability. Level-ups pay coins, cores unlock cosmetics, and every ability has a title at mastery 5. Forfeits earn none.
- **Challenges**: three daily and three weekly, one reroll a day, and a sweep bonus for clearing a full set. Completing one also pays season xp.
- **Season track**: 16 tiers per season, then repeatable overtime coins. When a season ends you get coins for your peak rank, plus a season title at Gold or higher, and the season goes into your history.
- **Ranked**: five placement matches, a three-match shield after a promotion so one loss cannot drop you straight back, and a small bonus from the third ranked win in a row.
- **Awards**: fifteen three-tier achievements built on career stats, each ending in a cosmetic.

Rewards added after a player already passed them are paid when the profile loads and shown once on the menu. Saves from before these changes migrate on load (`migrateProfile`).

## Feel, audio, and accessibility

- The camera is pitched, so arenas read as thick floating platforms over a void. It frames the live balls and pushes in as the field thins out.
- Balls are characters: their eyes follow their travel, they squint when hit, panic near the edge, spin with dizzy spiral eyes and orbiting stars when launched, wobble when hanging off the edge, get determined at full speed, and celebrate a win. All skins render as their own material (glass, chrome, ember, nebula, prism, frost, glacier, hollow, ringed). Players drop in from the sky at the start and on respawn.
- The HUD uses Smash-style player cards (heat %, stocks), a speed dial, and cooldown rings. Your knockouts and streaks get a callout. The countdown shows the mode, the arena, and a lineup of everyone in the match. Name tags never pile up: yours is always shown, others fall back to a compact heat chip in a crowd. Banners and tips never stack, and the camera frames the arena below the top HUD. On phones the player cards become compact heat chips, and the results actions dock to the bottom of the screen.
- Heavy launches get an anime speed burst and a brief extra freeze; a knockout blasts at the screen edge where the ball left.
- The sim ticks at a fixed 60 Hz. The renderer blends between ticks, so motion stays smooth on 120/144 Hz screens. It keeps the canvas under about 4 MP and lowers its resolution on its own if frames run long.
- Hitstop scales with hit power, and the struck ball shudders during the freeze. Shake is trauma based, and the deciding knockout gets a slow-motion finish.
- Audio is fully procedural. Every ability has its own sound, sounds are panned by position and capped per voice, and the music ducks on knockouts, all through a master limiter. The music is a sequencer with layers that build from menu to match to final phase to sudden death.
- Leaving the tab pauses the match and silences audio.
- Settings include separate effects and music volume, screen shake, a screen-flash toggle for photosensitive players, reduced effects, stronger ball patterns, UI scale, stick deadzone, haptics, and Practice speed (50–100%, Practice and Tutorial only). `prefers-reduced-motion` is respected.

## Balance tooling

Balance is measured, not guessed. Three headless scripts drive the real sim:

- `npm run balance -- [matches] [casual|good|bot|idle] [mode] [arena|all] [veteran 1|0]` puts a human-like proxy in your slot. It sees the world through a reaction delay (0.2 to 0.3 s), aims with error, and sometimes misses the edge. It reports placement, win rate, knockouts, falls (and how many were self-inflicted), when the first stock and the last one go, match length, and how often sudden death happens. `bot` puts a bot in your slot as the fairness baseline (it should place near the middle). `CAUSES=1` breaks your falls down by cause: launched, light hit, own dash, drift.
- `npm run census -- [matches] [mode]` runs all-bot lobbies and averages placement per core, shell, ability, and passive. Sidegrades should all land near 0.5.
- `npm run tutorial-timing` measures how long a learner needs to land the knockout that ends the tutorial.

Current targets: a casual proxy places about 3 of 6 and wins about one match in five, a good one places about 2.5; FFA matches run about a minute with sudden death in a quarter of them; every core and ability sits within about 0.07 of 0.5 in the census.

## Install and offline

Production builds register a service worker (`public/sw.js`) and ship a web manifest, so the game installs as an app and plays offline after the first load. Page loads are network first, so a deploy is picked up right away. Hashed assets are cache first.

## Layout

- `src/sim` authoritative match, physics, hazards, abilities, bots, replay input log
- `src/data` tuning and content definitions
- `src/progression` profile, rank, challenges, season track
- `src/render`, `src/audio`, `src/ui` presentation (`render/ball.ts` paints the ball characters for both the arena and the UI; `ui/icons.ts` is the inline icon set)
- `src/game` setup and the browser shell

The session accepts inputs only. Positions, eliminations, and rewards come from the sim. A network adapter can feed the same `submit` path later.
