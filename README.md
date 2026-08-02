# Gzowo Orbit

A co-op game about a crew of astronauts exploring the Solar System at 1:1. Real radii,
real distances, real orbits, and no loading screen anywhere between the bridge and a
bootprint on Mars.

three.js, ES modules from a CDN, no build step. Desktop only.

## Running it

```bash
npm run serve
```

Then open <http://localhost:8310>. Never use `python3 -m http.server` for this project:
it sends no cache headers and the browser will happily serve you yesterday's ES modules.

```bash
npm test
```

Precision, flight and networking suites, in Node, with no browser and no dependencies.

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/build-interior.py
```

Regenerates the ship interior from the same room layout the collision uses.

## Controls

| | |
|---|---|
| mouse | steers the ship from the pilot seat, looks around otherwise |
| W / S | main engines up and down |
| shift / ctrl | lift engines up and down |
| Q / E | roll · A / D strafe · R / F translate |
| space | stabiliser in flight, jump on foot |
| X | cut all thrust · G landing gear |
| E | sit or stand · L lift between decks |
| O | airlock: step outside, or come back in |
| B | unload, board or leave the rover |
| Z | cut ore with the laser · X deploy the drill |
| K | repair the worst-damaged system, from outside |
| J | cycle jump target · enter engage · backspace abort |
| T | sell and refuel while docked · U fit a module |
| V | chase camera · C free camera · alt+mouse look around |
| F2 | settings · F3 photo mode · F5 save · F9 load |

## Why the code looks like this

**Positions are plain JavaScript numbers, which are float64.** At 1 AU a float32 has a
step of about 9 metres. `src/shared/` is float64 throughout and imports neither three.js
nor Rapier, so the host of a crew runs the same code as everyone else.

**Nothing is stored in absolute coordinates.** Every moving thing carries a reference
frame - the body it belongs to - and a local offset. Changing frames carries the velocity
difference of the two bodies with it.

**What a crew feels on a deck is the ship's non-gravitational acceleration, never
gravity.** Free fall, thrust and standing on the gear all fall out of that one vector, so
none of them is a special case.

**The near/far split is decided on distance to the surface, not to the centre.** A body
with a 6371 km radius is never close by centre distance.

**The interior layout is data.** Both the Blender model and the collision are generated
from `src/ship/deck.js`, so a wall cannot end up somewhere you can walk through.

**Deposits and terrain are functions of position.** Every crew member on every machine
finds the same ore in the same crater with nothing crossing the wire, and a dig is stored
as a crater on the body rather than an edit to a mesh.

**Commands go up, facts come down.** A guest never changes the world. WebRTC carries the
game; Firebase only ever carries the handshake.

## Measured

| what | measured |
|------|----------|
| ship at 1 AU, 10 000 frames, float64 | 5.4e-9 m error (float32: 6764 m) |
| 400 km orbit held for a full 92 minute period | apoapsis and periapsis within 3.3 m |
| free fall against 0.5·g·t² | 0.18% |
| jump on the Moon vs v²/2g | 3.52 m against 3.56 m |
| touchdown at 4 / 14 m/s | hull 100% / 53% |
| terrain coverage at 400 km and at 12 km | 0 black pixels of 17150 and 18318 sampled |
| jump arrival | 2.6 body radii, eccentricity 0.0000, 14% of tank |
| snapshot | 276 bytes, 5.4 kB/s per guest at 20 Hz, exactly 20 per second |
| rover | 40 km/h top speed, brakes to 0.2 km/h, drives over the pole |
| frame cost | 0.26 ms without post, 0.85 ms with it |

## Layout

```
src/shared/   float64 maths, bodies, orbits, terrain height, geodesy - no three.js
src/core/     renderer, post, sky, hud, shell, audio, observer
src/world/    quadtree terrain, patch worker, atmosphere, planet surface
src/ship/     flight model, cockpit, pilot input, deck layout, crew aboard, jump drive
src/crew/     astronaut outside, visor, failure and rescue
src/work/     resources, mining, rover
src/econ/     station, market, modules, contracts
src/net/      protocol, session, other people
tools/        headless Blender scripts that build the models
test/         node suites: precision, flight, networking
```

`window.orbit` exposes the whole simulation for measurement from the console. It is
deliberate, not leftover debugging.
