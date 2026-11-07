# Results: R9, the sticky bar on the album and artist pages, and the multi-disc pinned rows

Plan: `PLAN-feishin-sticky-headers-2026-10-28.md` (outside the repo, in the umbrella's `navi-connect/`). Branch
`fix/sticky-headers-2026-10-28`, local only, never pushed to GitHub. Written 2026-10-28 by the lane's fix agent, after the
review's fixes and the walk on the sandbox VM.

**Base.** Cut from the repair stack's tip `fe25fe05` (R8 runs in parallel; this branch is rebased onto R8's final tip before
R10). Eight commits on top: three by the implementer, five by the fix agent.

| Commit | What |
|---|---|
| `720ad81f` | The bar's opacity follows the hero title (`headerBarProgress`, 64 px), not `scrollTop > 200` (B-220) |
| `0d64a7fb` | The pinned header and disc row are placed against the block they are fixed to, across the table (B-221) |
| `0be1fb1b` | The hero band's 64 px tail fades out instead of ending in an edge across the About text (B-216) |
| `a2ebbbe7` | Review M-2: the page arrival fills `backwards`, so it holds no transform on `<main>` when it ends (B-221's cause) |
| `51ef3d86` | Review M-3, M-4, M-5: pinned rows placed in a layout effect, once a frame, and on the table's own resize |
| `5fb5bbf8` | Review M-5, M-6: the bar re-measures on the page's and the hero's resize, from the host's own viewport |
| `aab55c53` | Review I-1: the bar has the hero's colour at its spot, the pinned rows the page's (B-216) |
| `09302c97` | Two source guards: the arrival's fill, the pinned rows placed before paint |

## What changed

- **The bar fades with the title (B-220).** On the album and artist pages the bar's background, play button and name take
  their opacity from how far the hero's `h1` has passed under it, over 64 px of scroll, written to `--bar-progress` once a frame
  (no React state). Under 1 the bar takes no pointer. Under reduced motion it is a step. Other pages keep the old offset.
- **The bar is the hero continued (B-216, review I-1).** At full opacity the bar draws what the hero drew at that spot: a copy
  of the window's cover wash lined up with the real one (`WashUnderlay`, its viewport corner in `--wash-x` / `--wash-y`), the
  page card's translucent surface, then the hero's own band, which the route hands the bar (`band`), laid out against the hero.
  So it follows the album and artist background settings (the colour band or the blurred image). Before, the bar painted
  `--theme-colors-background` with the band squeezed into its own 65 px: a grey slab on the artist page (the owner's 04).
- **The pinned rows take the page's colour.** The pinned table header and disc row draw the same wash underlay and card
  surface (no band: by the time they pin, the hero has gone), instead of `--theme-colors-background`.
- **The pinned rows sit whole under the bar (B-221).** The cause: the page arrival's `both` fill left an identity transform on
  `<main>` for the page's life, which made `<main>` the containing block of the `position: fixed` rows, so viewport numbers
  landed 82 px low and 248 px right. Fixed twice over: the arrival now fills `backwards` (nothing held once its 220 ms are
  over), and the rows are placed against whatever block they are fixed to (still needed during those 220 ms).
- **Placement.** Both pinned rows share one hook: placed in a layout effect (no frame at the static spot), then at most once a
  frame on scroll, resize, an arrival ending, and a `ResizeObserver` on the table (the queue opening, the sidebar folding).
  Unchanged values are not written again.
- **The band's tail** fades out over its last 64 px instead of ending in a hard edge across the About text and chips.
- With the cover wash off, nothing in the colour part changes: the page's background is then the theme background, which the
  bar and the rows already had.

## Gates

Run on the workstation at `09302c97` (the tip).

| Gate | Command | Result |
|---|---|---|
| tsc, renderer and main | both configs, `--composite false`, TS6307 filtered | no output |
| eslint, stylelint | `--max-warnings=0` on each commit's changed files | exit 0 |
| Harnesses | `node --test $(git ls-files 'src/**/*.harness.ts')` | 82 files, 1033 pass, 0 fail |
| Web build | `pnpm build:web` | exit 0 |
| Remote build | `pnpm build:remote` | exit 0 |
| Production build on the VM | `pnpm build` in `~/src/feishin-r9`, at `fe25fe05` and at `aab55c53` | exit 0, exit 0 |
| commitlint | `--from fe25fe05` | clean |
| Em dash | added lines in `fe25fe05..HEAD` | 0 |

Harness count: 1015 at `fe25fe05`; the implementer added 16 (`header-bar-progress.harness.ts` 9, `sticky-offset.harness.ts` 7),
the fix agent 2 (the source guards, the first watched failing with the old `both` fill). The walk's "after" build is `aab55c53`;
`09302c97` adds only the harness cases, so the runtime is the same.

## Watched running on the VM

**VM numbers, not the owner's.** Sandbox VM, production builds of `fe25fe05` (before) and `aab55c53` (after) from the worktree
`~/src/feishin-r9`, own profile copy `~/standins/run/r9/cfgprod` (cover wash on; the artist background setting on, the album one
off), CDP 9233, launched with `--disable-gpu-vsync --disable-frame-rate-limit` both times because the GNOME session was locked
(frames flow uncapped: frame counts and dropped frames are only comparable between these two runs). Window 1440 x 900 or 800 x
600 by CDP emulation, the Windows-style in-app bar unless stated. Stand-in Navidrome and scratch hub only. Navigation by clicking
links (Home, search results, the app's Back and Forward buttons); the push measurement is the audit's `run.mjs`, which uses
`location.hash` by design. Every scroll step waited 2 s before reading. Scripts and raw output: `~/standins/run/r9/` on the VM
(`walk2.mjs`, `colour.mjs` + `sample.py`, `rec.mjs`, `queue.mjs`, `filter.mjs`, `barstyle.mjs`, `scrollpin.mjs`,
`firstframe.mjs`). Screenshots, read back: the ledger folder's `shots/` (`repair-r9-before-*`, `repair-r9-after-*`).

Test album: **"Two Disc Set"** by "R9 Disc Band" (2 discs x 14 tracks, made in the stand-in by the implementer, see the end).
Artist: **"The Long Players"** (62 albums). Short pages: "Short Three" (3 tracks) and the "R9 Disc Band" artist (2 albums).

### The bar's opacity per 20 px of scroll (B-220)

| Page, size | Before (`fe25fe05`) | After (`aab55c53`) |
|---|---|---|
| Artist, 1440 x 900 | 0 at 0 to 200, **1 at 220** | 0, 0.31, 0.63, 0.94 at 0, 20, 40, 60; 1 from 80 |
| Album, 1440 x 900 | 0 at 0 to 200, **1 at 220** | 0, 0.31, 0.63, 0.94; 1 from 80 |
| Album, 800 x 600 | 0 at 0 to 240, **1 at 300** | 0, 0.31, 0.63, 0.94; 1 from 80 |

Before, the hero's title had passed under the bar by scroll 37 to 53 and the bar landed on the hero's buttons and rows in one
step at 200 to 300. After, pointer events are `none` at every partial step, `auto` at 1. Seen in the shot at 40 px
(`after-r9artist-fade-...-y40`): the bar's name and the hero's name are both partly visible as one fades in over the other, which
is the plan's cross-fade.

### The bar's colour against the hero's (B-216, review I-1)

Cover wash on. The hero at scroll 0 against the bar at progress 1, same pixels, three rows inside the bar (y 88, 114, 143) and
four columns clear of text (x 700, 900, 1100, 1300), largest channel difference:

| Page | Before | After |
|---|---|---|
| Album "Two Disc Set" (colour band), 1440 x 900 | 14 (hero rgb(37,63,105), bar rgb(29,54,93) at x 1100, y 88) | **1** |
| Artist "The Long Players" (blurred artist image), 1440 x 900 | **86** (hero rgb(101,121,151), bar rgb(48,54,65) at x 1100, y 88) | **1** |
| Album, 800 x 600 (x 450, 650, 720, 732) | not measured | **1** |

The before artist bar is the owner's 04 almost to the unit: rgb(46,56,69) there, rgb(47,54,65) here, a grey slab over a blue
page. After, the bar is the hero's top continued; on the album page that means a visible step between the bar (the hero's top
colour) and the page under it, which is what "the hero continuing" draws.

### The pinned rows (B-221, and their colour)

| | Before | After |
|---|---|---|
| 1440 x 900, scroll 300 to 1000 | header 229..270, Disc row 270..311, both 524..1600 (table 276..1352) | header **147..188**, Disc row **188..229**, both **276..1352** |
| 800 x 600, scroll 700 to 900 | 229..270 / 270..311, 220..808 (table 124..712) | **147..188 / 188..229, 124..712** |
| Disc 2 takes over | at 900 | at 900 |
| Queue open, scroll 700 | header 229..270, 524..1284 (table 276..1036) | **147..188, 276..1036** |
| Queue closed again, no scroll | header 524..1427 against the table's 276..1352 (stale) | **276..1352** (the table's ResizeObserver) |
| Row colour against the page under it (rows hidden, same scroll), max channel difference | 30 (row rgb(21,43,78), page rgb(39,66,108)) | **1** |
| First frame of a newly pinned row (2 px a frame across the pin point, 81 frames, run twice) | not measured | header first at scroll 284 at 147 / 276..1352, Disc row at 286 at 188; **0 frames misplaced** |

### Review Focus

| # | Item | Seen |
|---|---|---|
| 1 | Every window-bar style, queue open or closed | After, album at scroll 700: Windows and macOS: bar 82..147, header 147..188, Disc row 188..229; Native and Web (hidden): bar 52..117, header 117..158, Disc row 158..199. The bar's bottom and the header's top agree in all four. The style was switched in Settings (renderer only; the Native frame itself needs a restart and was not restarted). Queue: see the table above. Before: only the Windows style was measured |
| 2 | A short page | After, the "R9 Disc Band" artist at 1440 x 900 scrolls 209 and reaches 1 at 80. Made shorter by taller windows: 1440 x 1060 scrolls 49, the bar stops at 0.77; 1440 x 1100 scrolls 9, 0.14; 1440 x 1130 cannot scroll, 0. Pointer `none` at each partial value; the actions sit below the bar's bottom. Before at 1440 x 900: 0 until 200, 1 at the 209 end |
| 3 | Fast scroll, then Back and Forward | Artist page, six scroll steps 30 ms apart to 600, an album opened by its link, then the app's Back button: the restored page showed the bar 0 then **1 in one step** (no value between) at 361 ms, 244 ms on a second Back; Forward to the album: 0. Before: the same shape at 492 and 301 ms |
| 4 | A filter that empties disc 1 | "Disc 2 Song" typed in Search tracks: the album drops its disc groups while a term is set, so no disc row pins; the header pins at 147..188 across 276..1352 (before: 229..270 across 524..1600) |
| 5 | The trigger is the hero's title | By code: the bar reads the `data-hero-title` `h1` inside the route's hero, no pixel offset. Not walked against R10's layout (it does not exist yet) |

### The page arrival unchanged (review M-2)

Per frame for 2.5 s after the click, `<main>`'s `getAnimations()` and computed transform:

| | Before | After |
|---|---|---|
| Push (Home to album, a link) | page-push running 150 to 368 ms; then a **finished** page-push stays in `getAnimations()` and transform `matrix(1, 0, 0, 1, 0, 0)` for the page's life | page-push running 425 to 647 ms (same 18 px slide and fade); then **no animation and transform `none`** |
| Back (the app's button) | page-pop, then held as above | page-pop 141 to 385 ms, then none |
| Reduced motion, push | no animation, transform `none` | no animation, transform `none` |
| Arrivals per navigation | 1 | 1 |

The start time differs because the album's data loaded at a different moment, not because of the change.

### Frames (VM numbers)

The audit's push (`run.mjs push`, 10 rounds), medians:

| Step | Before, run 1 | Before, run 2 | After |
|---|---|---|---|
| albums to album: TaskDuration / Script / ttc | 518 / 167 / 137 ms | 519.5 / 163.5 / 136 ms | 516 / 172 / 137.5 ms |
| album to artist: TaskDuration / Script / ttc | 651.5 / 230 / 343.5 ms | 733.5 / 246.5 / 335.5 ms | 785.5 / 254.5 / 349.5 ms |
| p95 frame, frames over 25 ms | 17.7 to 17.9, 3 | | 17.7 to 18.0, 3 |

The two before runs differ by 82 ms on the artist push; the after run is 52 ms above the higher one, inside that spread.

Scrolling over the pinned two-disc table (6 px a frame for 2 s, rows pinned, four runs), main-thread task time per frame: before
2.17, 1.14, 2.07, 1.33 ms; after (a fresh launch) 1.97, 1.27, 2.01, 1.40 ms; after with the wash underlays hidden by an injected
style, 2.01, 1.25, 2.06, 1.21 ms. No frame over 25 ms in any run, p95 17.5 to 18.0. An earlier after run late in a long session
read 2.54, 1.71, 2.44, 1.79; the relaunch matched the before numbers, so that run is not quoted as the cost.

## Watched vs reasoned from code

- **Watched:** everything in the tables above, on the VM.
- **From code only:** the cover wash off (the bar and the rows keep the theme background, as the page has); the album
  background setting on (the bar then draws the album's blurred image, the same element as the hero); light mode (the wash copy
  includes the light veil, not sampled); Review Focus 5.

## Not verified

- The owner's GPU: the extra wash copies (one in the bar, one in each pinned row, each with the 40 px blurred artwork) cost
  nothing measurable on the VM's main thread; their GPU raster cost on the owner's machine is not measured.
- The real macOS and Linux bars, and a restarted Native frame: only the renderer's layout under each style was measured.
- The real library, and covers other than the stand-in's one placeholder disc and the artist placeholder star.
- The light theme and the cover wash off: not measured (reasoned from code above).
- Frames at 60 Hz: the session was locked, the runs are uncapped.

## Found in passing

- Back to the artist page restores the scroll to 600 and, about 250 ms later, moves it to 846, in both builds. Not this lane's
  (the scroll store); recorded in the backlog.

## The stand-in album this lane added

`~/standins/run/r9/make_multidisc.py` wrote "R9 Disc Band" ("Two Disc Set", TPOS 1/2 and 2/2, 14 tracks each; "Short Three", 3
tracks) under `~/standins/nd3k/music/09000 R9 Disc Band/` on the VM, then a Subsonic `startScan` on the stand-in Navidrome
(127.0.0.1:4533). To remove it: delete that folder and start a scan on the stand-in again. The real Navidrome was never touched.
