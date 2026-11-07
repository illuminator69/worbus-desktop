# Results: F2, colour roles and the cover wash

Plan: `PLAN-feishin-colour-roles-2026-10-20.md` with its addendum (kept outside the repo, in the F2 context package). Branch
`redesign/colour-roles`, cut from `origin/feat/redesign` at `fe45ca6` (contains F1's `ae8e15f3`). Written 2026-10-20 at the end of the branch.

Tasks 1 to 5 were built by one implementer each and reviewed per task; Tasks 6 and 7 were built by the controller session (the owner
asked for that mid-run) and covered by one fresh whole-branch review at the end, whose fixes are the commit `fix(theme): address the
branch review`. One commit outside F2 rides on the branch at the owner's request: `fix(player): widen the seek track under the transport
buttons`.

## Gates

| Check | Baseline (`fe45ca6`) | Final |
|---|---|---|
| `tsc -p tsconfig.web.json` (TS6307 filtered) | clean | clean |
| `tsc -p tsconfig.node.json` | clean | clean |
| eslint / stylelint, `--max-warnings=0`, every changed file (28 TS, 17 CSS) | - | clean |
| The 36 existing harnesses (F1's `device-rows` 21, `device-arrivals` 18, `device-control-state` 7, `more-menu-items` 5, and 32 others) | 679 pass, 0 fail | 679 pass, 0 fail |
| `oklch.harness.ts` (new) | - | 6 pass |
| `cover-roles.harness.ts` (new) | - | 15 pass |
| `cover-seed.harness.ts` (new) | - | 10 pass |
| `cover-seed-cache.harness.ts` (new) | - | 4 pass |
| `apply-wash-vars.harness.ts` (new) | - | 3 pass |

41 harness files, 717 pass, 0 fail. Harnesses are run by hand (`node --test --test-reporter=tap <file>`); CI does not run them. Node here was
22.22 (type stripping on by default), not 24. Every new harness was seen to fail before its module existed.

## Watched running

`electron-vite dev` under Xvfb, driven over CDP, against a stand-in cover server (the package's `standin-server.mjs`) behind a small
scratch front that answers `getUser.view` and, for Task 6, a Navidrome album endpoint (`/api/album/alb-<cover>`) and empty list endpoints.
No music server, no hub, no real library. **Every cover was synthetic**: the package's cover script could not reach `musicbrainz.org`
(blocked here), so the set is the stand-in's fixtures (`black`, `grey25`, `white`, `split`, `red`, `green`, `blue`) plus twelve generated
images (pale cream, pale blue with a small orange sun, a black-and-white photo-like gradient, dull brown, night blue with a neon pink bar,
red field, forest, five-colour stripes, white with black type, mid grey-teal, black with a small gold emblem, a blurred sunset). Frames under
Xvfb arrive 25 to 130 ms apart, so timings below are coarse.

### The states of the plan's matrix

| State | What was seen |
|---|---|
| Nothing playing | `--wash-mid` `oklch(0.290 0.015 260)` (hue 260, `k` .22), dark, the artwork layer at opacity 0, the wash's `neutral` class |
| Cached cover | coloured in the same render (Task 3: three consumers all `resolved: true` from the first render, 0 loader starts) |
| Uncached cover | the old colours stay while it loads (about 260 ms here), then in-between values, none neutral; within 0.5% of the end by about 590 ms, exact by 710 ms. Task 4 measured the ease itself at about 304 ms on a quieter frame |
| Reduced motion | the same change snaps: two distinct values, old then new |
| Fast skip | five covers about 180 ms apart end on the fifth's colours (`oklch(0.29 0.07 354)`); no neutral frame on the way |
| Grey sleeve | the black-and-white cover gives `oklch(0.290 0.000 0)` |
| Failed, unserved or no-CORS cover | roles unchanged; the log has one `cover seed: loading { id }` then one `WARN cover seed: the cover did not load { id }`. No CORS: a second stand-in with `--no-cors` gives `null` and one warning |
| Light or dark from the cover | pale cream (meanL .934) gives a light window, night neon (.255) a dark one |
| Hysteresis | `fixture:green` (meanL .650, inside .62 to .74) stays dark when it follows a dark cover and stays light when it follows a light one |
| Cold start, cached last song | renderer reload with a document-start frame recorder: the first frame with app content already has the cover's `--wash-mid`; before it only the black `index.html` page shows (3 runs). With an empty queue, the first app frame is neutral |
| `Cover colours` off at runtime | no `--wash-*`, `--mantine-*` or cover-set `--theme-colors-*` key on `<html>`, no `data-cover-wash`, no `data-cover-wash-ease`, no wash layer; the accent `#0558fd` is back |
| Loader count | three concurrent requests plus one later for an uncached cover: one loader start. A cached cover: zero. After a reload: every seed answered from IndexedDB with no load (Task 3) |
| One structure | the marked wash node and its layers survive a cover change; a Settings scroll offset of 400 is still 400 after a seed lands; the album header's overlay is the same node before and after its seed lands |
| Remote SPA | the base commit's remote and the branch's remote, side by side in one headless Chromium with clean storage, dark and light: same 35 elements, same body colours, theme values equal except serialisation (`#0558fd` as `rgb(5, 88, 253)`); screenshots differ only in the 16 x 18 px animated spinner (dark), not at all (light) |
| Mobile layout (700 x 900) | album page and Settings readable in both modes |

### Contrast on rendered pixels

Probe elements styled with the app's own role variables (`--theme-colors-foreground`, `-foreground-muted`, `-primary`, `-surface`,
`-primary-filled` / `-primary-contrast`, `-background`, `-state-*`) were placed in the page at three heights (top, middle and bottom bands),
over the live wash, with the routed page hidden so each band reads the wash itself. For each of four artworks (solid black, solid 25% grey,
a black-over-white split, and the synthetic sunset) x hues 40, 120, 250 x dark and light, the background was read from the screenshot pixel
inside the probe (no glyph there) and the text colour through a canvas (the browser's clipped sRGB): 936 measurements.

| Pair | Dark, lowest | Light, lowest (60% white lift) | Light at the board's 55% lift |
|---|---|---|---|
| Text on a page band | 9.60 (sunset, h120, top) | 10.99 (black, h40, top) | 10.36 (black, h120, top) |
| Secondary on a page band | 8.05 (sunset, h120, top) | 6.54 (black, h120, top) | 6.15 (black, h120, top) |
| Accent text on a page band | 7.39 (sunset, h40, top) | 5.72 (black, h120, top) | 5.37 (black, h120, top) |
| Secondary on a raised row | 5.76 (sunset, h120, top) | 5.21 (black, h120, top) | 4.96 (black, h120, top) |
| Accent text on a raised row | 5.35 (sunset, h120, top) | 4.56 (black, h120, top) | **4.34** (black, h120, top) |
| Primary button label on the button | 11.49 (black, h40, top) | 9.20 (black, h120, top) | 9.20 (black, h120, top) |
| Body text on a popover (`mid`) | 12.77 (black, h120, top) | 14.17 (black, h40, top) | 14.17 (black, h40, top) |
| Warning on a page band | 6.28 (sunset, h120, top) | 4.79 (black, h40, top) | 4.55 (black, h40, top) |
| Error on a page band | 4.61 (sunset, h120, top) | 4.72 (black, h40, top) | **4.48** (black, h40, top) |
| Success on a page band | 5.68 (sunset, h120, top) | 4.69 (black, h40, top) | **4.45** (black, h40, top) |
| Warning on a raised row (report only) | 4.49 (sunset, h120, top) | 3.81 (black, h40, mid) | 3.63 |
| Error on a raised row (report only) | 3.30 (sunset, h120, top) | 3.76 (black, h40, mid) | 3.57 |
| Success on a raised row (report only) | 4.06 (sunset, h120, top) | 3.73 (black, h40, mid) | 3.55 |

With the board's 55% white lift, two light-mode pairs missed 4.5 over dark artwork (bold). The lever (addendum 6.1) was the light white
lift, moved to 60%, pinned by `lightWashOverBlackArtKeepsTextPassing` (it reads the CSS; it failed first with `bad on top over black, hue 0:
4.48`). After it, every pair the plan names is 4.5 or more, and the state colours pass on every band. On the raised surface the state
colours stay under 4.5 (dark error 3.30, light 3.73 to 3.81), as the addendum expected; they are reported, not chased. The popover row is
the opaque `mid`; the dropdown-type layers are a 15% raised tint over `mid` (see the sweep) and were not probed separately.

Rendered versus model (addendum 6.6): accent text is written as a gamut-reduced `rgb()` and matches the model exactly; fills are raw
`oklch()`, which Chromium clips. The largest gap is the dark accent fill at hue 250, rendered `159, 221, 255` against the model's
`186, 219, 254` (27 units); the button label's contrast moves by at most 1.0 (hue 40 dark: model 12.50, rendered 11.49). Nothing near
4.5 moves.

### The sweep

Every route below was opened with a dark cover (night neon) and a pale one (pale cream), screenshot at 1280 x 800, and scanned for any
visible element painted in the theme's own accent scale (`--mantine-color-primary-0..9`, Mantine's blue, `state-info`); the scanner was
checked by switching `Cover colours` off, where it flags the theme-blue Refresh button. Routes: Home, Favorites, Albums, Tracks, Album
Artists, Artists, Genres, Folders, Playlists, a playlist, an album (with stand-in data), an album artist, Search, Explore, Fresh,
Downloads, Radio, Saved Queues, Mixes, Listening, Wishlist, Library matches, Now playing, Settings. Without a library every page but the
album shows its empty or error state; that is what was swept. Widgets opened with real input: the Settings tabs, a Select dropdown, the
More menu, a tooltip, the command palette, a modal (create playlist), the queue's context menu, a toast, the full-screen player with the
More menu opened over it, the volume popover and device box (Task 5).

Found and fixed:

- The player bar's artist line (`c="primary"`, `--mantine-color-primary-text`) still wore the theme's blue: thirteen derived Mantine
  primary variables (text, anchor, filled and filled-hover, light, light-color, light-hover, outline, outline-hover) now follow the
  accent, the light variant on the accent container (`accc` / `accct`).
- Floating layers that paint `--theme-colors-surface` were see-through over the page, because that role is the 15% raised surface while
  the wash is on: the Select, Autocomplete, MultiSelect, TagsInput and ColorInput dropdowns, the Dialog, Tooltip, HoverCard and the toast.
  Each keeps its tint over the opaque `mid` while `data-cover-wash` is set.
- The only remaining hit is the accent picker's own swatch on Settings (the theme accent you chose; the control is disabled while the
  cover decides).
- The full-screen player keeps its `fast-average-color` backdrop (plan call 4); a menu opened over it is on top (the topmost element at
  its position) and opaque, so `.layout`'s `isolation: isolate` does not hide body-level layers.
- A second theme root (addendum 6.5): the renderer has one `MantineProvider` (`ThemedApp`); nothing else sets `forceColorScheme` or
  `data-mantine-color-scheme`. The components that paint `--theme-colors-background` opaque now paint `mid` (the modal, menus, command
  palette, context menu, device box), which is what the plan intends.

### Album and artist headers (Task 6)

With the stand-in's album endpoint: a red cover's album shows a red band (hue 26) over whatever the window wears; a pale cream album on a
dark window shows a dark band (lightness .36 to .29), grey because cream is under the chroma cutoff; an album whose cover does not load
shows no band (the window wash shows) and logs one warning; with `Cover colours` off the band is `fast-average-color`'s
`rgb(190, 20, 30)` as before, and a failing cover gives its old transparent fallback. The artist page could not be filled (the stand-in
has no artist endpoint): not watched with data. The dummy album page draws no band; the fork (lb-bot) pages were not opened.

### Seeds of the test covers, and verdicts

| Cover | hue | k | meanL | Mode | Verdict |
|---|---|---|---|---|---|
| fixture black / grey25 / white / split | 0 | 0 | .000 / .371 / 1.000 / .500 | dark / dark / light / dark | right: no colour, a grey window |
| fixture red / green / blue | 26.8 / 148.7 / 265.3 | 1 | .542 / .650 / .459 | dark / previous / dark | right |
| red field | 26.2 | 1 | .511 | dark | right |
| forest | 144.9 | 1 | .365 | dark | right |
| sunset | 52.7 | 1 | .557 | dark | right (the orange, not the purple bottom) |
| night neon (dark blue, pink bar) | 353.6 | 1 | .255 | dark | right: the salient pink over the larger dull blue (the c x c weighting) |
| five-colour stripes | 28.4 | 1 | .619 | dark | acceptable: the most chromatic stripe (red-orange) wins |
| dull brown | 64.0 | 1 | .482 | dark | questionable: a dull cover gets full-chroma roles (k 1), so the window is more colourful than the sleeve |
| black and white photo | 0 | 0 | .572 | dark | right |
| black with a small gold emblem | 0 | 0 | .172 | dark | acceptable: the emblem is under 8% of the pixels, so grey |
| pale cream | 0 | 0 | .934 | light | open: a pale sleeve becomes a grey light window, not a cream one |
| pale blue with a small orange sun | 0 | 0 | .909 | light | open: same, and the small vivid sun is lost |
| mid grey-teal | 0 | 0 | .752 | light | open: the tint is under the .04 chroma cutoff |
| white with black type | 0 | 0 | .945 | light | right |

No constant was changed: the covers are synthetic, and the open verdicts (pale sleeves and dull sleeves) are exactly what the owner's own
covers should decide. `SEED_SCHEMA` stays 1.

## Reasoned from code only (NOT VERIFIED)

- **The owner's own covers and their verdict**, including on light pages: not available here.
- **Library routes with real data**: swept as empty or error states only; the artist header with data.
- **The hub's remote song**: `useRemoteAwarePlayerSong` gives a hub track `imageId = resolved?.imageId ?? track.id` and no `imageUrl`; the
  wash builds its URL with the same arguments as the player bar's `ItemImage` (type `table`), so it gets the same URL. Not watched.
- **Other server types** (from code, Task 3): generic Subsonic has no cover id when a song has no art, and the placeholder id
  `2a96cbd8b46e442fc41c2b86b821562f` returns no URL; Jellyfin returns no id without a Primary image tag, and its cover is fetched by
  `new Image()` without the `Authorization` header, so it works only where the server serves images without auth and with CORS.
  **Navidrome** sets `imageId` to the song id for every song (`navidrome-normalize.ts`, `imageId: id`), so a song without art gets
  Navidrome's own placeholder image and the window takes its colour (most likely grey). Open item, by the owner's decision (below).
- **A full Electron relaunch** for the cold start: watched as renderer reloads (stores rehydrate, `localStorage` and IndexedDB read
  again); the main process was not restarted.
- **Windows and macOS title bars**: only the Linux window bar was seen (both title-bar containers get the same rule).
- **A real GPU**: the scroll cost was measured under software rendering (Task 5: Settings scroll 33 frames in 1.5 s without
  `will-change`, 92 with it, the same as with the wash off).
- **The colour picker dropdown fix**: the same rule as the Select, Tooltip and toast fixes, which were watched; the picker itself was not
  opened (the accent picker is disabled while the cover decides).
- `prefers-color-scheme` changing while the app runs; the side-drawer queue (not mounted anywhere in this build).

## Calls made beyond the plan

1. `"allowImportingTsExtensions": true` in `tsconfig.web.json` (addendum 5.4), so pure modules import siblings as `./oklch.ts`.
2. The state colours are OKLCH constants converted once from the board's HSL, with the addendum's band-passing steps (dark error
   `hsl(4 86% 75%)`, light warning `hsl(32 90% 25%)`, error `hsl(4 70% 36%)`, success `hsl(150 60% 23%)`); they differ from the board.
3. **Light white lift 60%, not the board's 55%** (measured, above); pinned by a harness case that reads the CSS.
4. `cover_seed_last` means the last seed the **window** showed: only `useCoverWash` writes it (a header seed or a discarded slow load
   cannot), and with nothing playing it is the neutral seed.
5. The 300 ms ease is gated on a second attribute, `data-cover-wash-ease`, set two frames after the wash first applies: without it a cold
   start eased in from the registered properties' neutral initial values (seen: the first app frame was near neutral and reached the
   cover at about 500 ms). Switching `Cover colours` on at runtime now snaps instead of easing.
6. Until the player store has hydrated (from IndexedDB), "no song" is "not known yet", not "nothing playing", so a cold start keeps the
   last seed.
7. The wash's artwork crossfade uses two always-rendered layers (one structure); `will-change: transform` on the wash (the plan's remedy)
   after the scroll trace; the bar's own `transition` is off while the wash is on (it trailed the window by about 400 ms).
8. The `--mantine-*` keys point at the `--theme-colors-*` ones so they ease together; thirteen derived Mantine primary keys added (sweep).
9. Floating layers that paint the surface role stay opaque while the wash is on (sweep).
10. The header overlay keeps a colour as `background-color` and puts only the cover gradient into `background-image`, so the off state is
    the old shape for every caller, custom themes included. With the wash on, a custom theme whose `overlay-subheader` is a plain colour
    (every built-in one is a gradient) shows the window wash instead of the header band.
11. The dummy album page keeps `useFastAverageColor` (it draws no band; the colour only held its header skeleton) and skips it while the
    wash is on, so a failed cover cannot hold the skeleton.
12. Fork (lb-bot) album pages key their header seed by the public Cover Art Archive URL (`external:<url>`): no credential, no
    per-request token.
13. The dev-only handle (`window.__f2`, and the plan's `window.__coverWash.set(seed, light)`) lives in `src/renderer/dev-handle.ts`,
    loaded with a dynamic `import()` behind `import.meta.env.DEV`, so a production build carries none of it. Kept, since the plan's
    measurement uses it.
14. No next-song prefetch (the design block mentions it; no task asks for it). Loads are shared per cover, not serialised globally.
15. `App` now waits for one IndexedDB read (the seeds) before the first render, in the web build too.

## Open for the owner

- **Tune on your own covers**: pale sleeves (grey now), dull sleeves (full chroma now), small vivid details on pale fields. Any constant
  change needs a harness case and a `SEED_SCHEMA` bump.
- **Navidrome songs without art** take the colour of Navidrome's placeholder image. The one-line fix, if wanted: in the Navidrome song
  normalizer, `imageId: item.hasCoverArt ? id : null` (it changes every Navidrome surface, not only F2, so it was left alone).
- The route sweep on real data, the hub's remote song, Windows and macOS title bars, a real GPU.
- The accent text (gamut-reduced) and accent fills (clipped) can differ by up to 27 channel units at some hues; `washVars` could emit the
  reduced colour for fills too if you prefer one look.
- Commits carry the container's git author identity (`Claude <noreply@anthropic.com>`, as F1's did); the messages carry no attribution.

## Try this

1. Play an album with a dark cover, then one with a pale cover: the window turns light; Settings, a menu and a Select stay readable.
2. Quit with a song queued and start again: the first frame is that cover's colours. Clear the queue, restart: neutral.
3. Open an album with a cover unlike the playing one: its header band is its own hue over the window's wash.
4. Turn `Cover colours` off in Settings: the old theme is back at once, with no leftover tint.
5. Skip quickly through five tracks: it ends on the fifth's colours, no grey flash between.
6. With a light window over a dark-art cover, read accent text on a hovered row near the top of the page (the 4.56 case).
