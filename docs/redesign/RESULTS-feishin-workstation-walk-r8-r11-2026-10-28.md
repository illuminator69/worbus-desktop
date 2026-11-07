# Results: R8 to R11 walked on the workstation

Written 2026-10-28 by the workstation walk agent. One walk of the four repair stages on the owner's machine (Fedora, KDE
Plasma on Wayland, eDP-1 1920 x 1080 at scale 1.2, 60 Hz), with the session unlocked, so frame times are real 60 Hz
frames. No app code was changed. Everything here was watched unless the section says it was reasoned.

## Setup

| | Tree | Commit | CDP | Profile |
|---|---|---|---|---|
| before | `.worktrees/repair-r6/feishin` | `fe25fe05` (the stack before R8) | 9331 | fresh, `~/.cache/feishin-walk-r8-r11-2026-10-28/cfg-before` |
| after | `.worktrees/repair-r11/feishin` | `49054590` (R8 + R9 + R10 + R11) | 9332 | fresh, `.../cfg-after` |

- **Builds.** `pnpm build` (electron-vite build, then the remote build) in each tree: exit 0 and exit 0. Both trees clean before
  and after; no install, no typecheck run.
- **Data.** The VM's stand-ins only, through an ssh tunnel this walk owned: the stand-in Navidrome (4533, behind the old walk's
  cover proxy on 4534, so covers differ by album), the shared scratch hub (4899) for R8 to R10 (its AudioMuse stand-in is what
  turns the autoplay characters on), and for R11 the private fake lb-bot (4907, `r11_gaps.py`) behind its private scratch hub
  (4909), started with `~/standins/run/r11/stack-r11.sh fake` and `hub` and stopped at the end. The shared 4533, 4897, 4899
  and 9222 were never restarted. Passwords and tokens were read into the environment only.
- **Window.** Electron's CDP has no `Browser.getWindowForTarget`, so `Browser.setWindowBounds` cannot be called; the window was
  sized by the page's own `window.resizeTo` through `Runtime.evaluate` (Electron resizes its window; no KWin call). Sizes got,
  as `innerWidth x innerHeight`: 1440 x 900, 1280 x 600, 1100 x 700, 800 x 600, each exactly as asked; `devicePixelRatio` 2.
  The in-app window bar is the Windows style (the Linux default in this fork).
- **Audio.** Both builds muted from the bar's volume button for the whole walk.
- **Playback.** Never transferred to a `cast-*` device. The after build's cast bridge did register the LAN speaker with the
  hubs and the bar showed a "Switch to" pill for it; nothing pressed it. One transfer was made, by its exact label, to the
  scratch client "R8 scratch Navic" (below).

### KDE config checksums

`sha256sum ~/.config/kwinrc ~/.config/kwinoutputconfig.json ~/.config/kscreen/*` before and after (`kscreen/` does not exist):

| File | Before | After |
|---|---|---|
| `kwinrc` | `21474a50...6f52e7` | `21474a50...6f52e7` (same) |
| `kwinoutputconfig.json` | `90897dd3...5a01d97` | `b23936b0...86518e3c15b` (**differs**) |

The one difference is a single value, the panel's `brightness` 0.6 to 0.35, written at 17:57:58. The walk never called KWin,
kscreen, kwriteconfig, a KWin script or anything about brightness (its old `kwin.sh` / `raise.sh` were not copied, and the
copied `cdp.mjs` had its KWin raise removed). The likeliest writer is the owner's brightness keys or Plasma's idle dimming; it
is reported here rather than reverted.

## The numbers, before and after

| What | Before `fe25fe05` | After `49054590` |
|---|---|---|
| Seek row track, 1440 x 900 | x 592 to 848 (256 px) | x 521 to 920 (399 px), upstream's |
| Autoplay characters: control / label / font | 34 / 28 px / 13 px | 28 / 22 px / 12.5 px |
| Side queue header, 1440 x 900 (autoplay off) | 134 to 202 px | 196 px |
| Song rows fully visible, lyrics open, 1440 x 900 | 4 (lyrics 329 px) | 4 plus 3 captions at 3/28 (lyrics area 155 px default) |
| Lyrics drag, frame p50 / p95 / max | no handle | 16.7 / 16.8 / 17.6 ms (150 px in 2 s); 16.7 / 16.7 / 16.8 (100 px) |
| Rail with the queue folded | "28, Up next", no song | next song's cover, title and artist |
| Bar opacity per 20 px of scroll, album | 0 to 220, 1 at 240 | 0, 0.31, 0.63, 0.94, 1 from 80 |
| Bar opacity per 20 px, artist | 0 to 200, 1 at 220 | the same steps as the album |
| Pinned header / Disc row, album 1440 x 900 | 229..270 / 270..311 across x 524..1600 | 147..188 / 188..229 across x 276..1352 (the table's) |
| Wheel scroll, album, p50 / p95 / max (4 runs, 1600 px) | 16.7 / 16.7-16.8 / 16.8-17.5, 0 over 25 ms | 16.7 / 16.7-16.8 / 16.8, 0 over 25 ms |
| Wheel scroll, album, main thread per gesture | 215 to 256 ms | 148 to 187 ms |
| Wheel scroll, artist, p50 / p95 / max | 16.7 / 16.7-16.8 / 16.8-33.3 (one 33 ms frame in 4 runs) | 16.7 / 16.7-16.8 / 16.8-20.2, 0 over 25 ms |
| Wheel scroll, artist, main thread per gesture | 572 to 623 ms (1600 px travelled) | 222 to 253 ms (398 px: the page is shorter) |
| Album to artist push, main thread (10 rounds, median [min, max]) | 411 [394, 491] ms | 224 [213, 237] ms |
| Script / RecalcStyle / Layout | 166 / 85.5 / 24.5 ms | 88.5 / 35.5 / 13.5 ms |
| First release tile in the DOM (polled, no rAF) | 256 [243, 351] ms | 141.5 [124, 162] ms |
| DOM nodes in `main` after arrival / release tiles | 1218 / 36 | 297 / 5 |
| Worst frame during the push | 116.7 ms (up to 200) | 50 ms |
| Artist page scroll height, 1440 x 900 | 2141 | 398 |

All numbers are the workstation's, at 60 Hz. The R9 budget (p95 17 ms) holds in both builds on both pages. The VM's push
figures were 480 to 308 ms and 1231 to 356 nodes; the workstation's are lower in both builds and the after page has fewer
nodes (297) because the stand-in's Popular list shows one row under "Everyone".

## Per item

### 1. R8 seek row

`git diff master HEAD` on the after tree for `center-controls.tsx`, `center-controls.module.css` and
`playerbar-slider.module.css`: 0 lines each; `seek-row.ts` and `seek-row.harness.ts` exist in neither. So the seek row files are
byte for byte `master`'s. `master` itself differs from `upstream/development` in two of them (42 and 145 diff lines); the R8
plan's default ruling (upstream means `master`) stands. On screen the after row is the slider under the six 36 px transport
buttons (x 614 to 870, unchanged) with the time columns at 573 and 844; the before row was 143 px narrower.

### 2. R8 side queue

- **Artist links, local queue.** The before build already opened the artist from a local row (a click on "R9 Disc Band" went
  to `5cRqXb5zyb2ByLDS82KnaI`): B-224 is about the mirrored queue only.
- **Artist links, remote queue.** The VM's R8 scratch client (`r8-hubclient.mjs`, copied, pointed at the tunnelled shared hub,
  40 songs with names and no ids, one constructed two-artist row) set its queue, and the after build transferred to it by the
  pill "Switch to R8 scratch Navic" (checked by its exact text). The side queue then drew 12 links: "Wywyaegar" to
  `5jh9QNI0...`, as the VM saw; the two-artist row drew two links, "Torri Zenbelel" to `5y3NIguw...` and "Ocean Sisters" to
  `2dn2hxSG...`, each opening its own artist. A double-click on a name only navigated: the client received no `jump` and the
  session stayed at index 7. Rows that have scrolled under the queue header are still in the DOM there; only rows inside the
  list's own box take the click.
- **Autoplay characters.** 28 px control, 22 px labels at 12.5 px, one line in 332 px at 1440 x 900 (before 34 / 28 / 13 px).
  Shots `r8-chips-before-1440`, `r8-queue-after-1440`.
- **Lyrics.** Default area 155 px at 1440 x 900 (ARIA 120 to 299), 120 px at 1280 x 600 (ARIA 120 to 153). Rows fully visible
  at the queue's position 3/28, where three captions show (Earlier, Now playing, Up next): 1440 x 900 closed 8, default 4 (two
  earlier songs, the playing one and one up next, a fifth cut), at the maximum 299 px 2; 1280 x 600 default 2 full rows and the
  playing row, no Up next row on screen. Before, with lyrics open at 1440 x 900: 4 rows, all earlier songs and the playing row
  cut (`r8-lyrics-before-1440`). The VM's "6 rows" was counted where only one caption shows; captions cost about two thirds of
  a row each, so the count depends on where the playing song sits.
- **Drag.** Real pointer drags on the 6 px handle (row-resize cursor): 150 px in 2 s, p50 16.7, p95 16.8, max 17.6 ms, 0 over
  25 ms; two more drags 16.7 / 16.8 / 16.8 and 16.7 / 16.7 / 16.8. Dragged to 199, the app relaunched: the setting read 199
  and the area was 199 px. A double-click set it back to `null`.

### 3. R8 rail "Up next"

Read from the rail, then the bar's Next pressed, then the title read:

| Case | Rail said | Then current |
|---|---|---|
| Queue order, twice | Disc 1 Song 4, Disc 1 Song 5 | 4/28, 5/28 |
| Shuffle on, three steps | Disc 2 Song 3, Disc 2 Song 2, Disc 2 Song 13 | 17/28, 16/28, 27/28 |
| Last song, repeat off | "End of queue", no cover | n/a |
| Last song, repeat-one | Disc 2 Song 14 (itself) | n/a |
| Last song, repeat-all | Disc 1 Song 1 | 1/28 |
| Last song, Autoplay switched on | "Up next: Score 10 1" within a second: Auto DJ appended 5 songs (the station start answered 503 and Auto DJ took over) | n/a |
| Remote session at index 7 | "Radio Lights 1, Echo Machines", the plan's index 8 | n/a |

The transient "Autoplay" label was not caught (the rail was read once a second; the VM's MutationObserver saw it for 117 ms).
Before: the rail read "28, Up next" and no song (`r8-rail-before-1440`, `r8-rail-after-1440`, `r8-rail-remote-after`).

### 4. R9 sticky bar (and B-235)

20 px steps, 350 ms each, at 1440 x 900, raw lines in `results/r9-{album,artist}-{before,after}.jsonl`:

- **Album "Two Disc Set"** (R9 Disc Band, 2 x 14 tracks): before the bar is 0 until 220 and 1 at 240; after 0, 0.3125, 0.625,
  0.9375, then 1 from 80, `pointer-events: none` while partial. Bar box 82..147 in both builds at every step.
- **Artist "The Long Players"**: before 0 until 200, 1 at 220; after the same four steps as the album.
- **Pinned rows**: before 229..270 and 270..311 across x 524..1600 against the table's 276..1352 (the owner's 05 reproduced,
  `r9-album-before-y300`); after 147..188 and 188..229 across 276..1352, "Disc 2" taking over at 900 in both.
- **Text under a non-opaque bar.** After, at 20, 40 and 60 px the hero's kicker ("ALBUM" at 114..132, then 94..112, then
  74..92) and the hero title sit inside the bar's box while the bar is at 0.31 to 0.94. At scroll 0 the kicker (134..152)
  already overlaps the bar's box by 13 px, at opacity 0 (invisible). From 80 px the bar is opaque and covers what is under it.
- **B-235 ruling, measured:** the bar's top is right (82, directly under the window bar and the nav row, the same in both
  builds, and the pinned header only exists from scroll 284). What the shots show is **the fade as designed**: for the first
  60 px the bar's play button and name fade in over the hero's kicker and title, so two titles are on screen at once
  (`r9-album-after-y40`, `r9-artist-after-y40`, `r9-b235-undertow-fade-overlap`). Whether that cross-fade is what the owner
  wants is the owner's call; nothing is placed wrong.
- **Wheel scrolling** (real `mouseWheel`, 16 ticks of 100 px down and up, 4 runs per page per build): the table above. No
  frame over 25 ms after; before had one 33 ms frame on the artist page in four runs.
- **Seen in passing:** on the artist page (both builds) the hero band ends in a hard 16-unit step at y 360: rgb(46,49,55)
  above, rgb(62,63,73) below, sampled at x 1360 clear of text. After R10 that edge crosses Popular's first row
  (`r9-artist-after-y0`). The album page has no step after R9 (before: 10 units at y 376). New bug, below.

### 5. R10 artist page

- **Order** at 1440 x 900, headings by page offset: Popular 315, Favorite songs 439, Discography 560, About 943. No "Members",
  no lb-bot "Related", no "Appears on" or "Related artists" (the stand-in has neither, so the last two were not seen). Before:
  Popular releases, nine kind lines and the side column with About, Members, Top songs, Favorite songs; page 2141 px of scroll.
- **Popular unaffected by the Songs library.** In the after profile the Songs table was set to 11 columns (Album Group and
  Image added to the 9), size Large, and the filter "Is favorited: Yes" (151 of 11,821 songs). Popular under "Everyone" (1
  row) and "Yours" (5 rows) laid out the same as with the defaults: grid `28px 40px 720px 120px 52px 32px`, the same cell x and
  widths, 350 px tall; the only difference was the hovered row's number cell. All three settings were restored afterwards
  (columns, size Default, filter None, display Table) and read back from the store.
- **Chips.** Four quick chip clicks (Live, Albums, Compilations, Singles and EPs): one row of 5 tiles, the last chip pressed.
  Live chosen, scrolled to 250, its owned tile opened, the app's Back: Live pressed, scrollTop 250, the same history key, still
  250 after 1.5 s (no late jump at this offset).
- **Narrow.** 1100 x 700 with the queue open (the overlay queue): Popular's title column 380 px, the chip row 746 px wide in
  732, no wrap. 800 x 600: title 232 px, the chip row 746 in 584, sideways, no wrap. Shots `r10-artist-after-1100q-*`,
  `r10-artist-after-800-*`, before pairs `r10-artist-before-*`.
- **Push**: the table above.

### 6. R11 boxes (private fake lb-bot)

**The gaps box, Hollow Orchard / Undertow (9 of 12):**

| Stage | Watched |
|---|---|
| folded | "3 tracks missing / Click to see which", Fill gaps, chevron; box 75 px |
| tracks | rows 10, 11, 12 Missing, "Measured against ... Undertow (12 tracks). Wrong edition?", Re-check, Open in lb-bot |
| searching | "Asking slskd which peers have these tracks (stand-in)" at once |
| choosing, safe | at 11.8 s: 3 cards, #1 Recommended preselected, "Request 3 tracks" 8 px under it; Search again and Pick the best source for me under the cards |
| a pick | card #2 tapped: its three files listed, the one visible Request under it |
| active | the fake received `fetch` with sourceId 1, peer harbourlight; 1 of 3 at 4.8 s, 2 of 3 at 7.8 s |
| done | at 12.7 s "In your library / 3 tracks added / 12 of 12"; gone at 18.8 s |
| none safe (`gsafe=0`) | 3 cards, none selected, 0 Request buttons that can be hit |
| cancelled | Cancel request: rows read Cancelled; the fake received `cancel` |
| failed (`gfill=fail`) | rows Downloaded / Failed / Failed at 6 s; the "Couldn't get these tracks" card with lb-bot's sentence, Search again and Dismiss only at **95.9 s** (B-233 reproduced) |
| multi-disc, Studio 1 | rows numbered 1-2 to 1-5, then 2-1 to 2-5 |
| context menu | on the artist page, right-click Undertow: "Find 3 missing tracks" opened the album with the box (on the failed card: this device's ledger row still held the failure) |

Not walked here (the VM walked them): noSources and Allow MP3, stalled, awaiting match, unreachable, a fill started on another
client, leaving mid-search.

**The missing album, Hollow Orchard / Low Country:** Find sources showed the stated wait, then at about 34 s four cards with #1
preselected and its file listing; card #2 tapped, "Download from here" under it. The fake received `sourceUsername`
harbourlight, `sourceFolder` `Music\Low Country (2013) [FLAC]`, `release_mbid` 8fa353f2..., `total_tracks` 8. The same box
then showed the steps; Cancel request posted `album/cancel` with that `release_mbid`. Before: the same search ends in a list
with one "Download" button at the very bottom, below the window (`r11-before-album-download-at-bottom`), and Undertow has no
gaps box at all (`r11-before-undertow`).

### 7. Other things an owner would see

- **The boxes collapse under the sticky bar after Request** (new bug). Requesting from a card below the fold turns the tall
  sources view into the much shorter active view while the scroll stays: the box's top lands under the bar. Measured: Undertow
  box top 53 and, in a second run, 78, against the bar's bottom 147 (the title, the source line, the bar and "0 of 3" hidden;
  only the steps from "Source chosen" down show, `r11-after-06-active`); Low Country box top 35 (112 px of it hidden,
  `r11-after-33-album-steps`). The done row then shows and folds away under the bar too.
- **A refused Request looks dead** (new bug). With cards on screen that lb-bot no longer holds (here because the stand-in was
  reset under the open box), Request got lb-bot's refusal "That source is no longer in the list. Search again.", which the
  box printed at y 1152, below the bottom of a 900 px window, under Search again and Pick the best source; nothing near the
  button changed (`r11-after-refused-request-offscreen`).
- **React error #301 reproduced** (B-229). On the after build at 1440 x 900, three times within five minutes: once on the bar's
  Next at 28/33 after switching Autoplay on at the end of the queue (Auto DJ appended 5) and off again with the queue folded,
  then twice more on a single Next right after the error page's Reload (29/33, 30/33). The page fell to "An error occurred"
  twice; the third time the error was logged with the page still up. Seventeen Next and Previous presses afterwards, with the
  queue open and folded, did not reproduce it. Production build, so the stack is React's internals only. Shot
  `r8-after-react301-crash`.

## Bugs found

| New | What |
|---|---|
| B-236 | lb-bot's boxes (album gaps box and missing album box): after Request the box shrinks to the active view and its top lands under the sticky bar (box top 35 to 78 against the bar's bottom 147) |
| B-237 | Artist page: the hero band ends in a hard 16-unit colour step at y 360, which now crosses Popular's first row (both builds) |
| B-238 | Gaps box: a refused Request shows lb-bot's sentence at the bottom of the box, off screen (y 1152 in a 900 px window); the press looks dead |

Evidence added to existing lines: B-229 (reproduced three times), B-233 (failed card at 95.9 s), B-235 (ruled: the fade as
designed, top correct).

## Key screenshots

In `~/.cache/feishin-walk-r8-r11-2026-10-28/shots/` (not in the repo), read back during the walk: `r9-album-{before,after}-y{0,20,40,60,80,300,700}`,
`r9-artist-{before,after}-y*`, `r9-b235-undertow-fade-overlap`, `r8-chips-before-1440`, `r8-queue-after-1440`,
`r8-lyrics-{before-1440,after-1440-default,after-1440-max,after-1280x600-default}`, `r8-rail-{before-1440,after-1440,remote-after}`,
`r8-remote-queue-after-active-navic`, `r8-after-react301-crash`, `r10-artist-{before,after}-{1440,1100q,800}-y*`,
`r10-songs-library-extra-cols-filter`, `r10-popular-after-*`, `r11-after-0{2,4,5,6,7,8}-*`, `r11-after-{10,13,17,21,24,30,31,32,33,34}-*`,
`r11-after-refused-request-offscreen`, `r11-before-undertow`, `r11-before-album-download-at-bottom`.

## Not verified

- **Watched vs reasoned.** Everything in the tables was watched on this machine. Reasoned only: that the cross-fade at 20 to 60
  px is the plan's intent (read from R9's plan and note, not asked of the owner).
- R11's noSources, stalled, awaiting match, unreachable and other-client stages, and leaving mid-search: walked on the VM, not
  here.
- The rail's transient "Autoplay" label (read once a second, never caught); a local two-artist row (the stand-in has none).
- "Appears on" and "Related artists" on the artist page: the stand-in artists have neither.
- The owner's library, the owner's eye, the light theme, the cover wash off, the macOS and Linux bars.
- The cause of the #301 crash; whether the before build has it (not tried there).
- Frames at other window sizes than 1440 x 900; the lyrics drag at 1280 x 600.
- Mid-walk the before window stopped getting frames (another window covered it; the walk may not raise windows). Those runs
  were thrown away and redone after relaunching the build, which put its window on top; every number above is from a run
  whose frames flowed.
