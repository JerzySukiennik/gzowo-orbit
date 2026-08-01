# Gzowo Orbit

Co-op game about a crew of astronauts exploring a 1:1 Solar System. Real radii, real
distances, real orbits, and no loading screens anywhere between the bridge and a
bootprint on Mars.

Built with three.js and Rapier, ES modules from a CDN, no build step. Desktop only.

## Running it

```bash
npm run serve
```

Then open <http://localhost:8310>. Never use `python3 -m http.server` for this project:
it sends no cache headers and the browser will happily serve you yesterday's ES modules.

```bash
npm test
```

Runs the precision acceptance test in Node - no browser, no dependencies.

## Why the code looks like this

**Positions are plain JavaScript numbers, which are float64.** At 1 AU a float32 has a
step of about 9 metres, so a ship built on `Float32Array` world coordinates shakes and
its terrain cracks. `src/shared/` is float64 throughout and imports neither three.js nor
Rapier, so the authoritative server in phase 6 can run the same code as the client.

**Nothing is stored in absolute coordinates.** Every moving thing carries a reference
frame - the body it belongs to - and a local offset. Mars travels 24 km/s; anything
anchored to the Sun is left behind within a frame.

**The scene is the world translated, never rotated.** World normals and scene normals
are therefore identical, which every shader relies on.

**Two content passes.** Anything whose *surface* is further than 10 000 km is pushed onto
a logarithmic shell and scaled by the same factor, so angular size is preserved exactly
and depth ordering stays monotonic. Closer than that, bodies are drawn at true scale in
the near pass. The test uses surface distance, not centre distance: a body with a
6371 km radius is never close by centre distance, and a centre-based test would push the
planet you are landing on into the compressed pass.

## Phase 0 measurements

| what | measured |
|------|----------|
| ship at 1 AU, 10 000 frames, float64 | 5.4e-9 m error |
| the same in float32 | 6764 m error |
| frame cost, planet filling the screen | 0.085 ms |
| frame cost, whole system compressed | 0.101 ms |
| draw calls | 5 |

`window.orbit` exposes the observer, body views and renderer for measurement from the
console. It is deliberate, not leftover debugging.

## Controls

WASD to move, R/F up and down, Q/E roll, mouse wheel for throttle, shift to boost.
1 Sun, 2 Earth, 3 Moon, 4 Mars.
