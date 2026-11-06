# Offline DOOM

Typing `doom` at the announcement panel's prompt plays DOOM in the panel, in place of its terminal (`DoomScreen`);
closing the panel ends the game. Everything it needs is served from here, so it runs without network access. Music is
off (`-nomusic`, as in the engine's own page): its software synthesizer runs on the page's thread and starves the game.

| File | What | Source | License |
|---|---|---|---|
| `index.html`, `default.cfg` | The launcher and the game's settings | This repository; `default.cfg` is the engine's, with mouse grab on and turning on the arrow keys | GPL-2.0 (from the engine) |
| `websockets-doom.js`, `websockets-doom.wasm` | Chocolate Doom compiled to WebAssembly | [cloudflare/doom-wasm](https://github.com/cloudflare/doom-wasm) at `65e0d3ae2ffa604155eebd96ed40da6567bd08f4` | GPL-2.0, `ENGINE-COPYING.md` |
| `freedoom1.wad` | Freedoom Phase 1, original levels, art and sound | [Freedoom 0.13.0](https://github.com/freedoom/freedoom/releases/tag/v0.13.0) | BSD-style, `FREEDOOM-COPYING.txt` |

No id Software game data is included. The engine's corresponding source is the commit above; `scripts/build-doom.sh`
rebuilds it in the pinned Emscripten image, without the engine's debug-only `SAFE_HEAP` and stack checks (under this
Emscripten they abort it with an alignment fault), and fetches Freedoom, checking every download against its SHA-256.

## Controls

Move with W, A, S and D. Turn with the mouse or the arrow keys. Fire with Space or the mouse button, use with E, run
with Shift. Esc opens the game's menu. Click the game to capture the mouse; Esc releases it. **Exit DOOM**, or Quit Game
in the menu, returns to the terminal.
