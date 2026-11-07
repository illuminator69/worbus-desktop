# Results: F5, the motion kit and Home

Plan: `PLAN-feishin-home-and-motion-2026-10-21.md` with its addendum `01-ADDENDUM-baseline-and-cloud.md` and the per-task addenda (kept outside the
repo, in the F5 context package). Branch `redesign/home-and-motion`, cut from `origin/feat/redesign` at `22d169f` (the F4 merge, PR #7; it contains
F1's `ae8e15f3`, F2's `c58c0b50` and F3's `6f048a23`). Written 2026-10-21 at the end of the branch.

One session ran the plan inline (`executing-plans`), Tasks 1 to 9 in order, one commit per task, plus one fix commit from the Task 9 sweep
(`b0c773c`). One fresh whole-branch review follows; its findings, the fixes, the rulings and the deferred minors are appended at the end.

## Gates

| Check | Baseline (`22d169f`) | Final |
|---|---|---|
| `tsc -p tsconfig.web.json` (TS6307 filtered) | clean | clean |
| `tsc -p tsconfig.node.json` | clean | clean |
| eslint `--max-warnings=0`, every changed TS/TSX file (50) | - | clean |
| stylelint `--max-warnings=0`, every changed CSS file (13) | - | clean |
| `pnpm build:web` / `pnpm build:remote` | - | exit 0 / exit 0 (after Tasks 2, 3 and 9) |
| The 47 existing harnesses | 783 pass, 0 fail | 783 pass, 0 fail |
| `arrival.harness.ts` (new, Task 1) | - | 5 pass |
| `nav-direction.harness.ts` (new, Task 1) | - | 3 pass |
| `tint-hues.harness.ts` (new, Task 1; one case added in Task 3) | - | 5 pass |
| `home-items-migration.harness.ts` (new, Task 5) | - | 8 pass |
| `mood-parse.harness.ts` (new, Task 7; one case from the review) | - | 9 pass |
| `mood-mix.harness.ts` (new, Task 7; the stripe check widened in Task 8; two cases from the review) | - | 14 pass |
| `shown-stack.harness.ts` (new, the review) | - | 5 pass |

54 harness files, 832 pass, 0 fail after the review's fixes (53 and 824 at Task 9), run by hand (`node --test --test-reporter=tap <file>`, Node 22.22); CI does not run them. Every new harness was
seen to fail first with `ERR_MODULE_NOT_FOUND` before its module existed. `tileColors` prints its worst case: 4.50:1 (hue 220 to 90, the light end
at h220 s58 l43).

**Install.** Not re-run: `package.json`, `pnpm-lock.yaml` and `pnpm-workspace.yaml` are unchanged since F3, whose override install (with `node-mpv`)
is in place. Every pnpm command ran with `--config.verify-deps-before-run=false`, and the app was started with `./node_modules/.bin/electron-vite dev`.

## Watched running

`electron-vite dev` under Xvfb (2600 x 1500 screen, an 885 x 900 window), driven over CDP with the package's `cdp.mjs`, `motion-frames.js`,
`measure-home.js` and `measure-layout.js`, against the package's stand-in (`--albums 60 --songs 2000 --playlists 12 --missing 0.3 --hub-port 4790`,
its mood routes copied from the hub's code). States were set through the stand-in's `/__mode` switches, `store_settings` seeds before launch, and
the stores via the dev handle (`window.__f2`, extended in Task 5 with `queryClient` and `useMixesStore`). Frames are software rendering: they are
quoted for shape and order, never as the owner's speed; Home's mount blocks the main thread for 400 ms or more here, so early frames are sparse.

### The kit (Tasks 1 and 2)

| What | Seen |
|---|---|
| Page push (a Link to Home) | `main[data-nav=forward]`: 0 ms opacity 0.00 x 18, 83 ms 0.80 / 3.7, 567 ms 1.00 / 0 (final code); Task 2's run: 233 ms 1.00 / 0; `getAnimations()` page-push 220 ms |
| Page pop (`history.back`) | `data-nav=back`: 0 ms 0.00 / -18, 133 ms 0.80 / -3.7, done by 700 ms; at the final code the frames resumed at 400 ms (mount) and read 0.80 / -3.7 at 483 ms |
| A hash change with no router index (Settings by `location.hash`) | `data-nav=none`: the fade only, page-fade 220 ms |
| Sidebar minimise / expand (grid track) | 240 -> 196.7 -> 150.5 -> 110.9 -> 88 px over about 300 ms; expand 88 -> 108.6 -> 155.1 -> 195.4 -> 228.1 -> 240 |
| Queue close / open (third track) | 368 -> 325 -> 145 -> 77 -> 52 (the rail); open 52 -> 363 -> 368 |
| Reduced motion (`--media reduced`) | push and pop opacity 1, translate 0 in the first matching frame; every grid toggle one value; sidebar crossfade (a launch with the emulation on): opacity 1.00 throughout, against a normal launch's 1.00+0.00 ... 0.54+0.46 ... 0.00+1.00 |
| Old profile, `general.expressiveMotion: true`, version 37 | loads to Home, no `data-motion` attribute; one console error, `<motion.div> is unrecognized`, from `sidebar-playlist-list.tsx:797` (`component="motion.div"`), present at the base and not touched here |
| F3's shell (`measure-layout.js`) | queue open and closed at 800 x 600: identical to the base CSS hot-swapped in; at 800, 1100, 1280, 2560 in every Home state: gaps 8 / 8 / 8 / 8 / 8, no document scroll, no horizontal overflow |

### Covers (Task 3), covers held 800 ms by the stand-in

| What | Seen |
|---|---|
| A cell scrolled into view | the tint 1.00 from 0 ms; Task 3's run: the image at 1050 ms, opacity 0.00, 0.21, 0.59, 0.79 ... 1.00 at 1317 ms (about 267 ms), the tint fading out in step; at the final code 0.59 at 900, 0.94 at 1000, 1.00 at 1100 ms |
| The same cover a second time (Albums again) | the image at opacity 1.00 in its first frame (the stand-in sends no `Cache-Control`, so the tint holds while it is fetched again) |
| A recycled cell (3000 px away and back) | a new element, opacity 1.00 in its first frame |
| The player bar's cover changing (mediaNext twice) | tint 0.00 throughout; the old image decoded at 1.00 until the new one lands, both mounted while the new one fades 0 -> 1, the old one unmounted about 50 ms after |
| Reduced motion | the image at 1.00 in one frame, the tint gone in the same frame |
| Side queue rows (48 x 48) | the placeholder's radius 5 px = the image's |
| Neighbouring ids | al-15 and al-16 got hues 352 and 349, so checked: 3 of 59 adjacent pairs within 10 degrees (55 of 1000 over al-1 to al-1001), the rate random hues give; kept |

### Tiles (Task 4)

| What | Seen |
|---|---|
| Home arriving, a shelf of 8 (2200 x 1100, time = the arrival clock) | delays 0, 30, 60, 90, 120, 150, 150, 150 ms; at 150 ms tiles 1, 2, 5, 6: 0.97/0.3, 0.93/0.6, 0.44/4.5, 0.00/8.0; at 317 ms 1.00, 1.00, 0.99, 0.98/0.2; all 1.00/0 by 390 ms. Order and shape as `spec/home-board.md`'s table |
| The replay guard (`watch` / `late(900)`) | 0 late after: paging every shelf twice, `queryClient.invalidateQueries()` of everything, scrolling Home 400 px at a time, scrolling the Albums grid 30 steps and the side queue's table; the stand-in has no 5,000-row table (its song list is empty) |
| Skeletons | a cold load with `/api/album` held 2.5 s and 3 s: the skeleton grids carry no `data-arrive`; each real shelf arrives when it lands (13.2 s and 13.9 s into the load, its first tile's rise at t=0) |
| Scratch proof (reverted) | `useArrival` on the virtualised Albums grid's cells: 30 steps of 400 px to the end and back added 0 new `[data-arrive]` |
| Reduced | no `[data-arrive]`, no animation, opacity 1. Caveat: a first run that clicked in the same tick the emulation started still stamped `data-arrive` (motion's `useReducedMotion` reads a value its media listener updates a step later); nothing moved, because the CSS is gated too. With 300 ms between the emulation and the click: none |

### Home (Tasks 5 and 6)

| What | Seen |
|---|---|
| Title | "Home", Bricolage Grotesque 30 px, top 130, above the first block |
| Old default profile (version 37, feature on + single, recentlyReleased off) | version 38; recentlyAdded, fresh, mixes, rediscovery, recentlyPlayed, mostPlayed, random, recentlyReleased (off), similarArtists, playlists, genres; the feature carousel off |
| Customised `[mostPlayed, recentlyAdded (off), genres]`, feature on + multiple | those three in that order, then fresh, mixes, rediscovery, similarArtists; the feature carousel stays on |
| Settings import of an export written at version 37 | lands migrated: the new order, the feature off |
| Settings > Home page configuration | the eleven rows with the new labels; Home follows the stored order |
| No lb-bot, and lb-bot with nothing fresh | Fresh, Your mixes, Rediscover and Artists you might like take no height and no gap (recentlyAdded -> recentlyPlayed 32 px, one gap); no heading |
| Fresh with seeded lb-bot data | Owned / Not owned at left 8, top 8, 11 px 700, padding 2 px 7 px, radius 5 |
| A seeded mix | "Your mixes" with one tile; none -> gone |
| Continue listening | 60 px cards; columns by the page's width: page 176 or 492 -> 1, 656 or 792 -> 2, 972, 1936, 2252 -> 3; the live queue first; nothing sticking out; with 12 queues 2 or 3 displayed and Tab skips the rest; the ellipsis and a right-click give Resume, Preview queue, Save as playlist, Remove from history; a click and Enter resume through the app's own "Discard the current queue?" |

### Moods (Tasks 7 and 8)

| What | Seen |
|---|---|
| The main client (`window.api.mood`) | ok: 13 moods, 10 home with 4 tiles; relax/acoustic 300 ids; unknown mood or variant: unknown 404; `absent`: absent; `down`: unavailable 503; `list-503`: list unavailable; `analysis-off`: catalogue with `available` false; hub switched off: unavailable 0. The stand-in saw `Bearer tok` |
| A draw (relax/acoustic) | missing 0: ready 50 in 64 lookups; 0.7: ready 50 in 192 (125 not found); 0.95: short 14 in 288; 1: empty in 288; list 503: unavailable, 0 lookups; aborted: AbortError; no artist twice within 4; the longest song drawn 471 s (missing 0) and 477 s (missing 0.7), under the 480 s limit |
| Chips | ten, in the hub's order, 30 px; the row scrolls sideways at page widths 492 and 792, not at 972 and wider; absent when mood search is absent, the hub is off or the server is not Navidrome (Continue at 197 with no chips, 251 with) |
| First frame of a launch | with a stored catalogue the chips are first seen in the same MutationObserver callback as the title; `down`: still there; `absent`: shown from the copy, then removed and the copy cleared; with no copy they came 403 ms after the title |
| The fold (select, then clear) | mood 0 -> 80 -> 527 -> 585 -> 591 px by about 450 ms; shelves 2483 -> 2262 -> 651 -> 173 -> 10 -> 0 by 600 ms; clear the reverse; the chips' top 193 throughout; reduced: one value from the first frame |
| Shelves across a mood | a carousel paged to page 2 and the page scrolled 300 px: both kept after select and clear |
| Tiles | relax/acoustic, relax/mellow-beats, relax/piano-jazz, relax/indie, arriving; each mood's tiles arrive once when it opens (after `b0c773c`, also when switching straight from one mood to another) |
| The preview | building (8 skeleton rows) then ready at 2.5 s with `list-slow`; "Relax mix, 50 songs, 4 h 24 min, from your library"; Play these queues the same 50 names in the same order; the saved queue is radio-kind with the tile's title as `sourceName`, and shows under "Saved from these mixes"; short, empty and unavailable read as the contract says, each with Retry |
| The tile's play button tapped twice | `aria-busy` at the second tap; one `POST /sonic/mood/list`; one queue |
| Saved from these mixes | radio-kind records named after a tile kept; a renamed one and a playlist called "Soul" dropped |
| The catalogue failing while a mood is selected | `down`: the chip stays, the body says mood search is not available, Retry restores the tiles; `absent`: the chips, the selection and the body go and the shelves open (54 px less at the top) |
| Keyboard | chips are a group of buttons; Enter selects; "Clear mood" first while selected; then tile, its play button, the next tile; 2 px rings; Escape from the preview returns focus to the tile |

### Contrast on rendered pixels (Task 9)

Hues 40, 120, 250, dark and light, over `fixture:black`, `fixture:grey25`, `fixture:split` and a generated cover (`al-17`), and with `Cover colours`
off; background from a screenshot pixel inside the element away from glyphs, text colour through a canvas.

Two full runs: the first before the badge fix, the second after it (`frames/t9-contrast.txt` in the session's scratchpad holds the second). The
lowest of each, Cover colours on (all 24 configurations) and off:

| Text | Run 1, wash | Run 2, wash | Off |
|---|---|---|---|
| Chip (not selected) | 5.47 (al-17, h120 dark) | 6.59 (grey25, h250 dark) | 14.96 |
| Chip (selected) | 6.17 | 6.17 (black, h120 dark) | 5.00 |
| Continue title / line / glyph | 11.13 / 6.94 / 6.94 | 11.45 / 6.94 / 6.94 (light mode) | 14.96 / 6.61 / 6.61 (Task 6's own run, another card: 14.09 / 6.23 / 6.23) |
| Owned / Not owned | 5.20 / **4.00** (black, h120 dark) | 6.17 / 15.87 (one transient row excluded, below) | 5.00 / 14.44 |
| Preview header | 8.52 (split, h120 light) | 8.52 | 6.61 |
| Mood tile title / second line (rendered, one run) | 5.44 / 4.62 at hue 40 | | the tile art is fixed; the harness proves every hue |

The chip numbers move between runs at the same configuration (the cause is not established; the chip is translucent); every reading is above 4.5.

**Finding, fixed in `b0c773c`:** Not owned measured 4.0:1 on a bright cover at hue 120 dark: its chip was 73% opaque (the wash bar is itself 94%
opaque and was mixed at 78%). At 90% it reads 15.87 or more. One later row (split, h250 light) read Owned 2.44 and Not owned 4.15; the same
configuration measured twice more read 8.09 and 15.99, so it was a transient (most likely the re-seeded Fresh row still rising when the shot was
taken).

## Reasoned from code only (NOT VERIFIED)

- **The real hub's mood routes**: their timing, the real lists and the final tile titles (the stand-in's catalogue is copied from the hub's code).
- **A real lb-bot**: Fresh and its badge were seeded through the query cache and the hub store; Artists you might like with data, Rediscover with a
  rediscovery playlist set; Discover's own skeleton row (`/explore` renders nothing against the stand-in).
- **The album detail page's push**: the stand-in serves no `GET /api/album/<id>`; the album list page stands in (the same `AnimatedPage`).
- **The command palette's group fold under reduced motion**: same `useReducedMotion` pattern as the sidebar, not opened.
- **A hash preview** (blurhash, thumbhash): Navidrome sends none; with a `hashUrl` the tint is not drawn and the preview shows as before.
- **The glassy-dark theme** on the tint (it carries `.hash`, so the 18 px radius applies) and on the Continue card's cover (the glassy image override
  is more specific and will round it).
- **A non-Navidrome server**: only the server type was switched in the store.
- **The OS reduced-motion setting** on Windows, macOS and the owner's Linux desktop (emulated here with `--media reduced`); a real GPU; the owner's
  library, saved queues and mixes; `prefers-color-scheme` changing while the app runs.
- **`MixPreview` on the mixes route** plays, then closes all modals, which would also close the app's "Discard the current queue?" confirm that
  playing opens; the mood preview had exactly that and now closes first. Not this plan's code, not tried there.

## Calls made beyond the plan

- **`homeItems` is taken whole by the persist merge** (`store/utils.ts`), like `columns`: lodash merges arrays index by index, so a stored list
  shorter than the new 11-row default came back with the default's tail appended (duplicates). Seen and fixed in Task 5.
- **`tileColors` checks both stripe hues on both ends**: the tile paints one stripe in its second hue over both ends (the board's CSS); the plan's
  harness text blends each end with the other's hue. Checking both covers both readings (Task 8).
- **The preview's Play these closes the modal before playing** (above).
- **`useArrival`'s `propsFor` is stable** (a `useCallback`), so the carousel and the cards can memoise on it (Task 4).
- **`Fold` takes a `name`** for its `data-fold` hook (Task 1).

## Open for the owner

1. **The chips on your hub**: they appear once F5 is merged and Feishin points at the NAS's dev hub, which has the routes. The 40 tile titles are
   the hub's and not final until the tiles' ear sheet is rated. Look at them there.
2. **The featured carousel**: switched off by the migration for profiles on the default pair (on, single); the Settings switch is still there.
3. **Expressive motion is gone**: no in-app switch, only the OS setting; the shell's tween is on for everyone; the Material overlays are not offered.
   Whether the OS setting reaches Electron on your Linux desktop is not verified.
4. **The song-relative queue chips** and mood as a station's source or the radio's filter: the hub side is built; each needs a Feishin task.
5. **The board's genre line on a mood tile** (the tile says "About 50 songs") and its right-aligned "because" lines on the shelves.
6. **Not built**: hover easing (120 ms), the tab motion (F6), "a box follows its content's height" (F7).
7. **Titles**: "Your mixes" against the board's "Your mix"; "Artists you might like".
8. **A mood tile opens a preview modal and its button plays**; Navic opens a page. Whether Feishin wants a page is yours to decide.
9. **The placeholder's tint comes from the image's id** (the item's name is not available to `ItemImage`).
10. **The mood tiles are darker than the board for hues about 25 to 205**: the board's own gradient gives white text 2.3 to 2.8:1 there; the
    harness forces 4.5, so the light end went below lightness 35 for hues 25 to 205 (and the dark end below 24 only at hue 90).
11. **Spacing at the top of Home**: the section heading's reason line sits under the title here (at the right on the board), Recently added's "See
    all", and the gaps between the title, the chips and the first block (a Stack gap and 24 px here, 8 px on the board).
12. Everything under NOT VERIFIED above.

## Try this

- Launch twice (the second launch has the stored catalogue): the chips are there with the title, nothing jumps.
- 1280 x 800, Home: click Relax; the shelves fold away and four tiles rise; click Relax again (or the x): the shelves come back where they were.
- Click a tile: the preview builds, then Play these; the queue is the rows you saw. Then look for the tile under "Saved from these mixes".
- Albums, then the back button: the page slides in from the left; a link slides it in from the right.
- Albums at any width, scroll fast: new covers fade in over a tint; ones you have seen show at once.
- Minimise the sidebar and open or close the queue: they tween now. With the OS's reduce-motion setting on, nothing moves.

## The review (appended after the branch's last task)

One fresh reviewer (a separate agent on the most capable model, not the author) read the whole branch `22d169f..6090c82` read-only, with the plan,
the addendum and the per-task addenda, the specs, the plan's Review Focus and the ledger's rulings. It re-ran both type-checks, eslint and stylelint
on every changed file and the six new harnesses, and checked the push gate's two greps. Verdict: ready to merge with fixes. No Critical finding;
one Important; fourteen Minor. Re-graded by what a person using the app gets, three of the Minors entered the fix pass with it; each fix has a test
seen failing first.

| Finding | Graded | Outcome |
|---|---|---|
| The tile's play button played a short mix silently, under a tile that says "About 50 songs" | Important | **Fixed** (`661c6e1`): `tilePlayResult` (red: no export, then green); a short mix plays with the line "Only N songs of this mix are in your library yet.". Watched: missing 0.95, the queue 12 -> 14 songs and that notice |
| Moods showed for a hub switched on but with no url or token (the stored copy, then "not available" everywhere) | Minor -> Important (the rule that an unconfigured hub renders nothing) | **Fixed** (`661c6e1`): `moodsShown` (red, then green). Watched: the token cleared with a stored copy: no chips; the token back: chips |
| The stored catalogue was used unparsed: a bad value would throw in render and take Home, the start page, to its error boundary, and survive while the hub is down | Minor -> Important | **Fixed** (`661c6e1`): `parseStoredMoodCatalogue` (red, then green). Watched: a launch with `{"version":"broken","available":true}` stored and the hub down: Home renders, no error boundary, no chips |
| Changing a cover twice before the second loads (skipping tracks fast) unmounted the only loaded image and left the frame empty | Minor -> Important (the flash Task 3 exists to prevent) | **Fixed** (`7040695`): the image kept underneath is the last one that loaded (`shown-stack.ts`, harness 5 cases, red then green). Watched: covers held 800 ms, two skips 300 ms apart: 101 frames, none without a visible decoded cover |
| The draw reads 64 + 7 x 32 = 288 ids at most, not the checklist's 64 + 8 x 32 | Minor | Ruling (below) |
| `homeMoods` drops a home mood with no tiles, so the body's empty sentence looked unreachable | Minor | Ruling (below) |
| The remaining ten | Minor | Deferred (below) |
| Results note: the longest song, the "Off" Continue column, the reduced-motion caveat | Minor | Corrected above |

After the fixes: both type-checks clean, eslint and stylelint clean on every changed file, 54 harness files 832 pass 0 fail, `pnpm build:web` and
`pnpm build:remote` exit 0.

### Rulings I made (from the ledger, in order)

1. `Fold` takes an optional `name` for its `data-fold` hook (Task 1).
2. `useNavDirection` records the history index on every location change, not only on mount, so a route kept mounted across a param change does not mislabel the next back (Task 1).
3. The one line that reads `performance.now()` in render to open the arrival window carries an eslint suppression: the window is the time of the first render with content, and an open window never moves (Task 1).
4. The new tokens sit in the existing `:root` block of `global.css` (Task 1).
5. The four overlays inline their plain transition; the two helpers and their boolean are gone (Task 2).
6. The player bar's cover keeps only its plain branch (Task 2).
7. The gated locals are renamed for what they mean now (`crossfade`, `animated`) (Task 2).
8. `motion-tokens.ts` keeps only `DURATION` and `EASING`, which two files still import (Task 2).
9. `--motion-duration`, `--motion-duration-long` and `--motion-ease` are unconditional; the existing reduced-motion rules stay (Task 2).
10. The placeholder carries `.hash` as well as `.tint`, so it gets every rule that rounds the hash preview (Task 3).
11. The shimmering `ImageLoader` and its CSS are deleted: nothing else imports them (Task 3).
12. Fade or not is decided once per request in a ref and copied into each shown image, so a cover on screen never takes the next request's decision (Task 3).
13. The old cover goes on the new one's `animationend`, or on its load when it has no animation; after the review, only once the new one has loaded (Task 3, then `7040695`).
14. `useArrival`'s `propsFor` is a stable callback, so the carousel can memoise on it (Task 4).
15. The arrival props reach `MemoizedCard` as one prop on its wrapper, computed once per page of cards (Task 4).
16. `homeItems` is taken whole by the persist merge, like `columns`: lodash merged arrays index by index and padded a short stored list with the new default's tail (Task 5).
17. The dev handle (dev builds only) gains `queryClient` and `useMixesStore` (Task 5).
18. The badge's copy is `common.owned` / `common.notOwned` (it shows on Discover's Fresh row too); its roles with the wash off are the primary fill for Owned and the translucent background for Not owned (Task 5).
19. The feature carousel and Continue listening sit in shelves too, so the empty-shelf rule covers every block (Task 5).
20. The top-left badge sits above the cover's image (`z-index` 2) (Task 5).
21. A Continue card is a box with two buttons side by side (the card, then its menu), not a button inside a button (Task 6).
22. The old card's third line (the source) is dropped: the board's card has one line under the title (Task 6).
23. The Continue card's surface is the theme's surface with the wash off and `surf2` with it; the cover's corners are squared (Task 6).
24. `tileColors` checks the plain end and the end under the stripe, with white and white at .88 (Task 7).
25. `arrangeMix` is first-fit: the next song is the first one whose artist is not among the previous three; when none is, the gap gives way (Task 7).
26. A draw stops looking songs up once it has 50 that fit, and an aborted draw stops at once (Task 7).
27. The catalogue's query is keyed by the hub's url; the stored copy is stale at once, so the hub is asked on mount; only a no-answer error is retried (Task 7).
28. `tileColors` checks both stripe hues on both ends: the tile paints one stripe in its second hue (the board), while the plan's text blends each end with the other end's (Task 8).
29. The mood section always renders the same tree, so the shelves never remount when the catalogue arrives or goes (Task 8).
30. Home's shelves have their own stack inside the mood section (Task 8).
31. The preview's Play these closes the modal first, then plays: playing opens the app's queue-replace confirm, which closing all modals afterwards cancelled (Task 8).
32. The tile's white ink and shadow are inline custom properties next to its computed gradient; the chips' mask uses an opaque theme role (Task 8).
33. A short preview shows its rows with Retry and Play these. (The tile's play button now says when a mix is short: the review.)
34. One fix commit from the sweep before the results commit (`b0c773c`) (Task 9).
35. The draw reads at most eight batches in all, 64 + 7 x 32 = 288 lookups: the bound holds; at depth 300 the last 12 candidates are never tried, so a borderline mix comes out short a little more often (the review).
36. A home mood with no tiles gets no chip; the body's empty sentence stays for a selected mood whose tiles go empty on a refetch (the review).
37. The lines the reviewer declined to judge, each ruled to stand: the commits' author is the environment's git identity (the gate checks message bodies; for the owner); settings version 38 may meet an upstream 38 (fork maintenance, as F3's 37); the clear chip inserted first shifts the chips (the plan's "clear chip first"); on the very first launch the chips arrive about 400 ms after the title (the plan accepts it); a list cell whose item changes shows the old cover until the new one loads (the plan's rule); the stored catalogue is one per profile, not per hub (for the owner); `RediscoveryRow` fetches the playlist list on Home (existing Discover code); with the wash off in a light theme Not owned is a light chip (contrast measured fine); moved English menu strings (as the addendum says); one song lookup per id (plan Call 10); Continue renders 12 cards and hides 9 (their covers do not load); `arrangeMix` first-fit (the hub caps 3 songs per artist); software frame timings.

### Deferred minors

- After Enter on "Clear mood" the focused button unmounts and focus falls to the page.
- A tile's play draw is not aborted when Home unmounts (a slow draw can start a mix after you left), and the tile body still opens the preview while the play button is busy.
- `BaseImage` could loop on its render-time updates if `src` were undefined while `imageRequest` yields an image (no caller does).
- glassy-dark: the tint keeps 18 px corners where the theme exempts the image (table cells, the player bar, sidebar rows).
- The page push's transform makes `main` the containing block for the tables' fixed headers for 220 ms; a back-navigation into a table whose header is already fixed could draw it offset that long (not watched).
- Clearing a mood and selecting the same one again does not replay its tiles' arrival.
- Copy: "Only 1 songs" at a count of 1; "4 h 24 min" is not localised; the card menu's "Queue actions" label is hard-coded English.
- The chips' mask fades the last 12% of the row even when nothing overflows.
- While an old cover is still the one shown, the top `<img>` already carries the new request's `id`.
