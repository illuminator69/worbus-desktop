# Results: the repair stack (R2 to R6) on the workstation's GPU

The walk that the five VM notes left for this machine: frames on the real GPU, base against tip, and a check that nothing
regressed. Written 2026-10-28. No app code was changed; the only commit is this note.

| | Commit | Worktree |
|---|---|---|
| BASE | `2302d69a` (R1, what the owner runs) | `.worktrees/colour-ease/feishin`, `fix/colour-ease-2026-10-27` |
| TIP | `5ed51b53` (R2 to R6 stacked) | `.worktrees/repair-r6/feishin`, `fix/narrow-windows-2026-10-28` |

Budget (audit R7): per gesture, on a production build on this workstation, p95 frame <= 17 ms and no frame over 50 ms during a
300 ms motion, warm route to content <= 300 ms.

## Instrument, and the one thing that limits it

- Fedora 44, KDE Plasma on Wayland, Electron 43.7.0 (Chromium 150) on native Wayland (`--ozone-platform=wayland`), GPU
  compositing and GPU rasterisation enabled, ANGLE over OpenGL ES 3.2 on the AMD Radeon (Cezanne/Renoir) iGPU, Mesa 26.2.2
  (`raw/gpu-base.json`). eDP 1920 x 1080 at 60 Hz, KDE scale 1.2, `devicePixelRatio` 2 (the app disables
  `WaylandFractionalScaleV1`, A-12). Window 1440 x 900 CSS, frameless with the in-app Windows-style bar (the owner's setting),
  sized and kept above by a one-shot KWin script scoped to the test instance's pid.
- Builds: `pnpm build` in each worktree (both exit 0), run with `electron .` on its own scratch profile
  (`~/.cache/feishin-repair-walk-2026-10-28/cfg-base`, `cfg-tip`), CDP on 9331 / 9332. One Feishin window at a time.
- Data: the VM's stand-in Navidrome (through an ssh tunnel, behind R1's local cover proxy, which answers each cover with a solid
  colour so a song change really changes the colours) and the VM's scratch hub (tunnelled). The stand-in's fake lb-bot reaches
  the app through the scratch hub. Nothing real was touched.
- **The owner's session was locked for the whole walk** (`loginctl` `LockedHint=yes`, screen saver active for 3 h 15 min when the
  walk began, and `locked=yes` was logged before every scenario). A locked KWin sends a Wayland window no frame callbacks, so the
  app got **zero frames**: the audit's frame guard cannot help, nothing covers the window, the lock does. Unlocking needs the
  owner. Two alternatives were tried and dropped: X11 through Xwayland (Xwayland fakes a 1 Hz vblank for a window that is not
  shown) and a nested KWin on its virtual backend (no EGL there, so it composited in software, and at device scale 1).
- **What was measured instead:** the same Wayland path with `--disable-gpu-vsync --disable-frame-rate-limit`. Chromium then
  produces frames on its own clock, either about 58 Hz (17.3 ms) or uncapped, still rasterised and composited on this GPU, but
  not presented by KWin. The frame timestamps of each run were put on a simulated display clock (`tools/summ.py`): a tick shows a
  new frame if one landed in it; the tick is the run's median frame interval when Chromium ran at 17.3 ms, 16.67 ms when it ran
  uncapped. So:
  - **worst frame** = the longest gap between two rAF callbacks (a stall a 60 Hz screen would show as missed vsyncs): valid;
  - **p95** = 95th percentile of the displayed-frame intervals on that clock, judged against one tick (16.7 or 17.3 ms);
  - **missed** = ticks without a new frame in the gesture window; 1 to 4 over a long window with no frame over 25 ms is clock
    drift, not a stall;
  - **main-thread ms and style ms** (CDP `Performance.getMetrics`, TaskDuration and RecalcStyleDuration) are higher than a 60 Hz
    run would give during animations, because uncapped frames recalculate more often. Compare them base against tip only, never
    with the audit or R1.
- Gesture window: content time + 300 ms for pushes; 400 ms for toggles and colour changes; 600 ms for a carousel flip; the whole
  2.5 s for scrolls.
- Navigation by real mouse events (`Input.dispatchMouseEvent`) on the link, chip or button; the app's Back button for Back.
  **Albums > album uses the app's router** (`navigator.push` taken from React Router's context, a PUSH with a fresh key): "Hits
  Flag 4" is far down an 8,742-album A to Z grid. `location.hash` was never assigned.
- Content marker: the route's hash plus, for the artist page, the first `[data-release]` tile on screen; the album page, its
  "Hits Flag 4" heading; Albums and Home, an album tile; the Library, an artist row.

## Results (10 runs per push, warm, medians; worst run in brackets)

Columns: missed ticks / worst frame median (max of the 10) / p95 / time to content / main-thread ms / style ms / DOM nodes in `main`.

| Gesture | BASE | R7 | TIP | R7 |
|---|---|---|---|---|
| Home > Library (click) | 3 / 51.5 (51.8) / 50 / 65 / 487 / 92 / 173 | FAIL | 3 / 51.5 (51.7) / 50 / 65 / 488 / 94 / 173 | FAIL (p95, max) |
| Library > Albums (chip) | 6 / 85.7 (102.7) / 42 / 249 / 560 / 154 / 528 | FAIL | 6 / 85.8 (103.3) / 42 / 262 / 518 / 110 / 528 | FAIL (p95, max) |
| Albums > "Hits Flag 4" (router) | 7 / 102.7 (103.3) / 100 / 102 / 490 / 119 / 420 | FAIL | 6.5 / 85.6 (85.9) / 83 / 89 / 478 / 89 / 401 | FAIL (p95, max) |
| **album > artist page** (click) | **42 / 441.3 (458.8) / 433 / 581 / 1073 / 268 / 5694** | FAIL (all three) | **12.5 / 119.9 (120.8) / 92 / 272 / 539 / 119 / 1218** | FAIL (p95, max); content PASS |
| Back to the album | 10.5 / 126.8 (144.7) / 133 / 175 / 561 / 113 / 420 | FAIL | 5 / 64.8 (65.0) / 67 / 84 / 406 / 45 / 401 | FAIL (p95, max) |
| Back to Albums | 5.5 / 85.7 (103.1) / 42 / 245 / 510 / 143 / 528 | FAIL | 5 / 68.5 (85.9) / 50 / 239 / 455 / 111 / 528 | FAIL (p95, max) |
| to Home (click) | 7 / 81.4 (94.9) / 83 / 169 / 498 / 108 / 608 | FAIL | 7 / 82.8 (98.5) / 83 / 162 / 488 / 121 / 608 | FAIL (p95, max) |

Every warm route reaches content within 300 ms on the tip (10 of 10 runs each); on the base the artist page never does (0 of
10, median 581 ms). First visits after a launch (one run each, the stand-in's data still to fetch through the tunnel): content in
433 / 551 / 354 / 771 / 154 / 240 / 169 ms on the base and 434 / 532 / 347 / **427** / 85 / 257 / 157 ms on the tip; the
artist page's worst frame on a first visit is 460 ms on the base and 71 ms on the tip.

**Toggles and the carousel** (sidebar: 2 collapses and 2 expands on Tracks and on Albums; queue: 4 toggles per page, the 1st and
3rd open it; carousel: 10 flips of Home's "Recently added"):

| Gesture | BASE: missed / worst (max) / p95 / main / style | R7 | TIP: same | R7 |
|---|---|---|---|---|
| Sidebar collapse, Tracks | 0 / 18.8 (19.8) / 17 / 435 / 122 | PASS | 0 / 17.2 (17.4) / 17 / 414 / 120 | PASS |
| Sidebar expand, Tracks | 0.5 / 22.8 (27.7) / 16.7 / 634 / 180 | PASS | 1 / 28.1 (30.2) / 16.7 / 664 / 190 | PASS |
| Sidebar collapse, Albums | 0.5 / 23.1 (28.5) / 16.7 / 538 / 142 | PASS | 1 / 23.1 (29.2) / 25 / 526 / 138 | FAIL (p95: one of two runs) |
| Sidebar expand, Albums | 4 / 31.6 (32.6) / 33.3 / 539 / 136 | FAIL (p95) | 2.5 / 30.9 (33.1) / 33.3 / 547 / 131 | FAIL (p95) |
| Queue **open**, Tracks / Albums (runs 1 and 3) | worst 72.0, 34.4 / 42.1, 39.7 | FAIL | worst 63.6, 37.4 / 63.0, 30.3 | FAIL (max 64, p95) |
| Queue close, Tracks / Albums | worst <= 17.8, 0 missed | PASS | worst <= 18.4, 0 missed | PASS |
| Carousel flip | 0 / 17.2 (17.6) / 16.7 / 560 / 41.5 | PASS | 0 / 17.6 (17.7) / 16.7 / 484 / 20.5 | PASS |

**Colour change** (the bar's Next and Previous alternating, a real cover colour change each time: 12 of 12 song changes and 12 of
12 wash changes per build), 4 per page; R1's budget was "no frame over 33 ms, at most 1 dropped frame":

| Page | BASE: missed / worst (max) / main / style | R7 | TIP | R7 |
|---|---|---|---|---|
| Home | 0.5 / 20.6 (37.9) / 442 / 54 | PASS | 0 / 17.6 (32.6) / 327 / 95 | PASS |
| Tracks | 0 / 17.9 (34.5) / 421 / 86 | PASS | 0 / 17.5 (17.5) / 301 / 110 | PASS |
| *The Long Players* | **7 / 95.5 (117.0)** / 487 / 66 | FAIL | 0 / 17.6 (18.1) / 323 / 90 | PASS |

R2 to R6 did not undo R1: the tip stays within R1's budget on all three pages (one Home frame at 32.6 ms). The base fails on the
artist page because the queue is that artist's songs, so a song change re-renders the full discography's tiles (R1's own walk
used a playlist of other artists and did not see this).

**Scroll**, 2.5 s at 2.4 px/ms (40 px per 60 Hz frame, time-based so the uncapped clock does not change the speed), 2 runs:

| Page | BASE: missed / worst / p95 / main | TIP | Both |
|---|---|---|---|
| Tracks (6,000 px) | 0 / 17.3 / 16.7 / 2544 | 0 / 17.6 / 16.7 / 2523 | PASS |
| *The Long Players* | 1 / 30.2 (39.3) / 16.7 / 2555 (6,000 px of page) | 4 / 18.1 / 16.7 / 752 (the page ends at 2,141 px) | PASS |
| Home (2,043 px) | 3 / 17.8 / 16.7 / 793 | 3 / 20.5 (23.2) / 16.7 / 649 | PASS |

## Narrow and short windows

**Real resizes.** The KWin script resized the real window for the first steps of each run and then stopped taking effect (under
the lock KWin kept a pending size the client never acknowledged; the script itself ran). One run per build of the steps that did
apply, queue open on Tracks:

| Step | BASE: missed / worst / p95 / main / style | TIP | TIP layout after |
|---|---|---|---|
| 1440 > 1240 | 1 / 21.8 / 16.7 / 275 / 62 | 1 / 21.1 / 16.7 / 281 / 49 | panel 360, page 616 |
| 1240 > 1120 (crosses 1180: the tip folds the queue) | 0 / 17.7 / 17.3 / 53 / 10 | 1 / 24.6 / 16.7 / 424 / 124 | rail 44, page 812 |
| 1120 > 1240 (the tip unfolds it) | 1 / 17.5 / 16.7 / 313 / 76 | **4 / 51.5 / 33.3 / 561 / 182** | panel 360, page 616 |

**Emulated sizes** (CDP `setDeviceMetricsOverride` at scale 2, which fires a real `resize`; 3 rounds, medians, worst in brackets):

| Step | BASE | R7 | TIP | R7 |
|---|---|---|---|---|
| 1440 > 1240 | 1 / 20.7 (22.5) / 16.7 | PASS | 0 / 17.8 (22.4) / 17.3 | PASS |
| 1240 > 1120, queue folds | 0 / 17.7 (27.8) / 17.3 | PASS | 1 / 24.2 (32.0) / 16.7 | PASS |
| 1120 > 1240, queue unfolds | 1 / 17.7 (18.3) / 16.7 | PASS | **7 / 51.4 (51.5) / 33.3** | FAIL (max, p95) |
| 1240 > 960 | 1 / 34.6 (34.8) / 17.3 | PASS | 2 / 34.6 (34.7) / 16.7 | PASS |
| 960 > 860, the tip folds the sidebar to its 80 px rail | 0 / 17.7 (33.9) / 17.3 | PASS | 3 / 34.7 (34.8) / 33.3 | FAIL (p95) |
| 860 > 960, sidebar back | 0 / 25.7 (27.7) / 17.3 | PASS | 1 / 34.4 (34.6) / 16.7 | PASS |
| 960 > 1440, queue back | 4 / 51.1 (68.3) / 16.7 | FAIL (max) | 7 / 68.7 (69.1) / 33.3 | FAIL (max, p95) |

The fold itself is within budget; unfolding the queue panel is not (51 ms at 1240, 69 ms from 960 to 1440), and folding the
sidebar shows three two-tick frames. Main-thread work per fold step is 400 to 600 ms on the tip against 50 to 320 on the base:
the tip re-lays out a wider page and runs the 300 ms grid tween.

**Queue rows** (list height / 48 px, queue open):

| Window | BASE | TIP, lyrics strip folded | TIP, strip open |
|---|---|---|---|
| 1440 x 900 | 2.23 (107 px under the lyrics split) | 9.94 | 3.94 |
| 1280 x 600 | under one (the list box is 0 to 7 px) | **6.23** | 3.31 |
| 1100 x 700 | 0.15 (7 px) | queue folded to its rail | (overlay not opened) |

The tip's rows match R6's VM figures exactly (6.23 / 3.31 at 1280 x 600, 9.94 / 3.94 at 1440 x 900).

## Arrivals on Back (tip, plus the base for contrast)

`animationstart` of `arrive-*` animations under `[data-arrive]`, counted for 3 s after each step, on a fresh launch:

| Step | BASE | TIP |
|---|---|---|
| Home > Library (first visit, click) | 14 | 14 |
| type "moon" in Find an artist | 1 | 1 |
| open the first artist (first visit) | 3 | 3 |
| **Back to the Library with the term** | **14** | **0** |
| **Back to Home** | **29** | **0** |
| Home > Library again by click (a new entry) | 14 | 14 |

R4 holds on this machine: Back starts no arrivals, first visits and new entries still arrive. (Image fade-ins are counted
apart and are not arrivals.)

## Where the tip still fails, and what dominates

1. **Every ordinary push misses frames, on both builds, by the same amount.** Home > Library, Library > Albums, to Home and Back
   to Albums cost the same on base and tip (worst frame 51 to 86 ms, 3 to 7 missed ticks): they are older than R2 to R6 (the
   audit found the control dropping 4 to 7 frames on these too). A trace of each tip push (`results/traces/` in the work folder,
   summarised by `tools/tsum2.py`) shows one long task of 50 to 85 ms right after the click: script (React's render and commit of
   the incoming page and the teardown of the outgoing one) holding a major GC of 16 to 32 ms, with style recalculation and
   layout each under 20 ms. Over the 1.5 s after a push the main thread spends 180 to 630 ms in script, 36 to 96 ms in style, 19
   to 42 ms in layout. The source-mapped CPU profiles name OverlayScrollbars (70 ms self on the artist push), the item table's
   pane sync and width tracking (`use-table-pane-sync.ts`, `use-container-width-tracking.ts`), and React itself; no single app
   component stands out.
2. **The artist page push** is the stack's big win (worst frame 441 > 120 ms, missed 42 > 12.5, content 581 > 272 ms, main
   thread 1073 > 539 ms, `main` nodes 5,694 > 1,218) but still misses the frame budget: its worst frame is the same click-handler
   task, plus the page's own mount of 36 tiles and the About column.
3. **Back to the album** halves (127 > 65 ms) with R4's arrivals gone, still over 50.
4. **Opening the queue panel** (63 ms frames) and **unfolding it on a widen** (51 to 69 ms) exceed 50 ms; closing it and the
   fold itself do not.
5. **Sidebar expand on Albums** and the **sidebar fold** show two-tick frames (p95 33 ms), no frame over 35 ms.

What passes: the carousel flip, every scroll, every colour change, sidebar on Tracks, closing the queue, folding the queue, and
content within 300 ms on every warm route.

## Screenshots (1440 x 900, production, scale 2)

In `.superpowers/sdd/workstation-walk-2026-10-28/shots/` (git-ignored): `tip-artist-top.png`, `tip-album-top.png`,
`tip-player-bar.png`, and the same three of the base for comparison. Read back: the artist page shows the round image, the 54 px
title, the labelled action row and Popular releases above the fold; the album page its first track row above the fold; the bar
its seek row under the transport.

## Raw data and tools

`.superpowers/sdd/workstation-walk-2026-10-28/`: `raw/*.jsonl` (one line per run, with every frame interval), `raw/*-log.txt`
(times and the lock state per scenario), `profiles/*.cpuprofile` (album > artist, Albums > album, to Home, each build),
`tools/` (`walk.mjs`, `narrow.mjs`, `narrow2.mjs`, `arrivals.mjs`, `summ.py`, `agg.py`, `cdp.mjs`, `kwin.sh` and the rest). The
Chrome traces (about 750 MB) stay in `~/.cache/feishin-repair-walk-2026-10-28/results/traces/`.

## Not verified

- **Frames presented by KWin at 60 Hz.** The session was locked throughout; every frame number above comes from Chromium's own
  clock with vsync off, rendered on this GPU but not presented. Worst frames are valid stalls; p95 and missed ticks are on a
  simulated clock; main-thread and style ms are inflated during animations. A repeat with the screen unlocked (no flags) is the
  check the R7 budget really asks for.
- Real window resizes beyond the first steps (the rest were emulated sizes); the folded queue's overlay at 800 and 1100.
- The owner's real library, covers and long albums ("Hits Flag 4" has one track); real audio (the stand-in's streams do not
  decode; "Playback was paused due to an error" toasts appear at launch).
- Dev mode (`pnpm dev`), not run. Windows and macOS.
- The owner's own build and profile: not touched.
