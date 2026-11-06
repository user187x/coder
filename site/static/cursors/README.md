# Dashboard cursors

Browser copies of the Borealis cursor theme (`Borealis-cursors`, an X11 Xcursor theme). Browsers cannot load
Xcursor files, so `scripts/build-cursors.py` writes each CSS cursor keyword's 32 px image, a 64 px copy for
high-density screens, and the hotspots in `cursors.json`. `site/vite.config.mts` reads `cursors.json` and
rewrites every `cursor:` declaration to its image, keeping the keyword as the fallback.

To change the theme, regenerate from the theme directory:

```sh
scripts/build-cursors.py path/to/Borealis-cursors
```

The theme shipped without a license file; confirm its terms before redistributing it outside this deployment.
