# Results: R15 walked on the workstation

Written 2026-10-29 by the workstation walk agent. One walk of repair round R15 (the queue header's blank line, the
Tracks table, Popular holding still) on the owner's machine: Fedora, KDE Plasma on Wayland, the app's window at
`devicePixelRatio` 2, real 60 Hz frames, the session unlocked at every check (`LockedHint=no`). No app code was changed.
Everything below was watched on this machine unless a line says it was reasoned.

## Setup

| | Tree | Commit | CDP | Profile |
|---|---|---|---|---|
| before | `.worktrees/repair-r13/feishin` | `1365f12c` | 9351 | fresh, `~/.cache/feishin-walk-r15-2026-10-29/cfg-before` |
| after | `.worktrees/repair-r15/feishin` | `996a0187` | 9352 | fresh, `.../cfg-after` |

- **Builds.** `pnpm run build` in each tree, one at a time, logs `logs/build-{before,after}.log` in the work dir: exit 0
  and exit 0. Both trees clean and on the stated HEAD before and after. No install, no typecheck, no branch switched.
- **Data.** The VM's stand-in Navidrome (4533) through an `ssh -N -L` forward (local 14533, `ControlMaster=no`, its own
  pid, stopped at the end). **The hub was a private copy, not the shared scratch hub 4899**: with any hub, a local play
  either claims the session's empty active slot or is routed to the active device (`publishQueue` /
  `routeLocalPlayToRemote` in `use-hub.tsx`), so every queue this walk had to make would have replaced the shared
  session's queue, which the brief forbids. A private hub (VM loopback 4919, the same hub code, state = a copy of the
  shared hub's state taken at start, `AUDIOMUSE_URL` = the shared stand-in AudioMuse 4880, no lb-bot) was started for
  each build with the same copy, so both builds adopted the same orphaned session ("R8 scratch queue", 2 / 40). Its
  token was random, handed over ssh stdin and never written to a file. Stopped at the end; its state copy and logs stay
  in `~/standins/run/ws-r15/` on the VM. The shared 4533, 4880, 4897, 4899 and 9222 were never restarted, and nothing
  touched the shared session. No remote device was active on the hub, so a remote device's queue was not observed.
- **Passwords and tokens.** Read into the environment at run time (`tools/sp.sh`, `tools/ht2.sh`); written nowhere
  outside the two scratch profiles (the app's own storage). Grep of the work dir outside the profiles for the password
  and for each hub token as a value: 0.
- **Window.** Sized only by the page's own `window.resizeTo` over CDP. Got exactly 1440 x 900, 1100 x 700, 800 x 600,
  1600 x 900 and 480 x 600; a 300 x 300 request gave 480 x 300, so 480 is the narrowest the window allows. dpr 2.
- **Frames.** Every frame number is a real 60 Hz frame. Twice the window stopped getting frames (rAF 0 in 500 ms:
  another window covered it; Mantine's transitions then stall, which left a half-open "Discard the current queue?"
  dialog and made Popular's Play do nothing). Each time the app was stopped and launched again (its new window comes up
  on top; no KWin call) and the affected step was redone; no number below comes from a run without frames.
- **Audio.** Muted from the bar in both profiles. Playback stayed local; no `cast-*` device was touched.

### KDE config

`sha256sum ~/.config/kwinrc ~/.config/kwinoutputconfig.json ~/.config/kscreen/*` at 18:42 and at the end, with read-only
copies of `kwinoutputconfig.json` both times: `kwinrc` identical (`21474a50...6f52e7`); `kwinoutputconfig.json`
differs in one key only, `"brightness": 0.6` to `0.5` (file written by KDE at 18:44, a brightness change);
`~/.config/kscreen/` does not exist. Nothing ran nested.sh, a compositor, dbus-run-session, kwin.sh, raise.sh, a KWin
script, `org.kde.KWin`, kscreen-doctor or kwriteconfig.

## Before and after

| What | before `1365f12c` | after `996a0187` |
|---|---|---|
| Header, no kind (R8 scratch queue), engine, Autoplay off / on / off | 200 / 200 / 200; line 3 a zero-width space, "autoplay continues after it, Blend" when on | **182 / 182 / 182**, no third line; list top 282 to 264 |
| Header, a saved "Queue" record with no title (6 songs), engine | 178 / 178 / 178, no "Playing from" | 178 / 178 / 178, the same |
| Header, album (Hits Flag 4, 1 song), engine | 178 / 140 / 140, back to 178 at 60.2 s | 178 / 140 / 140, back to 178 at 60.2 s |
| Header, playlist (R1 colour walk), Auto DJ mode | 162 x 3, "Playlist" / "Playlist · Auto DJ" / "Playlist" | 162 x 3, "Playlist" throughout |
| Header, playlist, engine | 200 x 3, "Playlist · autoplay continues after it, Blend" when on | 200 x 3, "Playlist" throughout |
| Tracks 1440, queue docked, Filters open: widths | 20 102 34 102 102 68 34 20 34 (516) | 24 200 40 40 40 40 40 24 80 (528 for 516) |
| same: Title text | "A..." | "Aeae Lothy 1" whole (118 px) |
| same: Bitrate header | 18 of a 34 px label shown ("'RA") | "BI..." (ellipsis) |
| same: stars of a rated row | 1015.5 to 1078.5 over the heart (1010 to 1030), past their cell, overflow visible | 1004.5 to 1067.5 in their cell (996 to 1076, clipped), heart 972 to 996 |
| Tracks sideways scroll, 1440 / 1100 / 800 / 1600 (queue rail below 1180) | 0 / **16** / 0 / **10** px | 12 / 36 / 156 / 0 px |
| Tracks Title, 1100 / 800 / 1600 | 98 / 67 / 134 | 200 / 172 / 200 |
| Tracks + Artist + Play Count, Title 1440 / 1100 / 800 / 1600 | 80 / 76 / 53 / 106, scroll 0 / 19 / 0 / 14 | 200 / 200 / 172 / 200, scroll 92 / 116 / 236 / 0 |
| Shift+wheel frames, 1440 (3 runs of 20 ticks) | no scroll there | p50 16.7, p95 16.7 to 16.8, max 16.8 (12 px and 92 px) |
| Album drag +160 in that crowded table | 80 to 67 shown (saved 240) | 40 to 200 shown (saved 1497) |
| then a drag -120 | 67 to 16 (saved 10) | 200 to 80 (saved 597) |
| Click on the handle (twice, after each drag) | no change | no change |
| Widest table here (1292 px: 1600, queue hidden, Filters folded), Album vs Artist | n/a | saved 597: 333 vs 167 (2.0x); saved 1497: **551 vs 110 (5.0x)** |
| Playlist table, Title 1440 / 1100 / 800 / 480 | 186 / 180 / 147 / 109, no scroll | 200 at all four, no scroll |
| Now Playing page, sideways overflow 1440 / 1100 / 800 / 480 | 0 / 0 / 1 / 4 px | 0 / 0 / 2 / 3 px |
| Full-screen queue 1440 / 1100 / 800 / 480 (688 / 518 / 368 / 480 px) | no scroll | no scroll |
| Album table (Hits Flag 4) | 62 / 498 / 125 / 75 at 1440, the same at all sizes | identical |
| Popular `main` nodes: arrival / rows 2 and 5 rated with the mouse and left / Tab through and left | 331 / 403 / 511 | 331 / **333** / **333** |
| Frames until a left row is one element (rAF) | never (stays a Rating) | the third frame, 29 ms |
| Popular "Yours" order, three counted plays (sampled every 500 ms, about 27 s) | moved at 3.7 s, 14.2 s and 24.8 s (Live Plain 2 1 fifth to first) | held |
| A visit after three plays elsewhere: rows drawn, later reorder | 375 ms, none in 4 s | 389 ms, none in 4 s |
| Album > artist push, main thread, median of 10 [min, max] | 257.5 [242, 271] ms | 258.0 [236, 264] ms |
| Script / RecalcStyle / Layout, first tile, nodes, worst frame | 83 / 43 / 17, 153.5 ms, 334, 50.0 ms | 86 / 42 / 16.5, 151.5 ms, 334, 50.1 ms |
| Wheel, artist page, 4 runs, p50 / p95 / max | 16.7 / 16.7 to 16.8 / 16.8 to 17.6 | 16.7 / 16.7 to 16.8 / 16.8 to 17.5 |
| Wheel, Tracks, 4 runs | 16.7 / 16.7 to 16.8 / 16.8 | 16.7 / 16.7 to 16.8 / 16.8 (one 33.3 ms frame in run 1) |

## Per item

### 1. The queue header (B-251's clause, B-268)

`[data-queue-header]` at 1440 x 900, panel docked, Autoplay clicked off, on, off with real mouse events, 3 s apart; a
clip shot of the panel at each step (`hdr-*`). Heights in the table. With my own eye:
- **No kind:** the after reads complete. Title, then the characters row, then the switch; nothing reads as missing
  (pair `cmp-hdr-nokind-{0,1,2}`). The before's empty band under "R8 scratch queue" is gone.
- **Playlist:** "Playlist" under the title in every state; the Auto DJ state is told by the switch only.
- **Album and the untitled "Queue" record:** no "Playing from" block on either build, so the top line is the Autoplay
  switch and the Hide button alone on the right with nothing on the left (`r15-after-hdr-album-0`). It reads bare, not
  broken; it was the same before.
- **B-268 traced:** the app log shows `POST /sonic/station/start -> 503` from the stand-in AudioMuse the moment Autoplay
  goes on with an album queue at its end (`remaining: 0`), then "Station engine unavailable, using Auto DJ". That latches
  Auto DJ mode, which has no characters row: 178 to 140, the list moves up 38 px. Off does not undo the latch; the next
  station probe (60 s later, "Only a probe that says available ends a 503 latch") does, and the row comes back by itself
  at 60.2 s with nobody touching the page, moving the list down 38 px. Identical on both builds. A queue with songs left
  (R8 scratch, 38 left; the playlist) never called `start`, so its row stayed.
- A remote device's queue and a bound station's line: not reached (no active remote device; `start` always 503 here).

### 2. Library Tracks (B-264, B-267)

Library > Tracks, the Filters panel open (the default), the queue docked at 1440 and 1600 and the rail at 1100 and 800
(B-207's fold below 1180). Numbers in the table, per column in `results/tracks*-{before,after}-*.json`.
- **Sideways scroll:** Shift+wheel moved the rows 12 / 36 / 156 px (after); every header cell's x moved by exactly the
  rows' `scrollLeft` at every size; the autoFit container stayed 516 / 492 / 344 (no growth). The scrollbar is an overlay
  thumb (0 px reserved); dragging it 150 px gave `scrollLeft` 6 (default columns, 12 to scroll) and 45 (extra columns),
  the Year header at the x of its cell (886, 887).
- **Selection:** a row selected, then scrolled 12 px: its nine cells' x equal the header cells' x before (548 ...) and
  after the scroll (536 ...).
- **The before also scrolled:** at 1100 (16 px) and 1600 (10 px) with default columns, and 19 / 14 px with extra
  columns. The slivers predate R15.
- **Rated rows** ("Is rated: Yes", put back to None): after, the stars sit inside their cell; at rest the fifth star of
  each rated row is cut at the table's right edge by the 12 px overflow (`cmp-tracks-rated-1440`).
- **Bitrate** reads "BI..." at every width in the after build, also in the 1292 px table: its label needs about 66 px
  and its share never reaches it.

### 3. Column resize (I1)

In the crowded state with 11 columns (after): the drag ends where it let go (40 to 200, 200 to 80, 80 to 200), and a
plain click on the handle changes nothing. The review's "about 5x its share" is measured, not only reasoned: after one
+160 drag in the crowded table (saved 1497), the widest table this screen allows (1292 px) gives Album 551 px against
110 for Artist and Genre (5.0x; they were equal before the drag) while Title stays at 200. A drag in a table that fits
lands exactly (551 to 202 saved 302), which is how it was put back. Before: the same drags made Album narrower (67, then
16, saved 240 and 10), and a drag on the 16 px column grabbed the header for a column move instead (Artist moved after
Bitrate in that profile; the width was put back to 300 in the table settings).

### 4. Other tables (I2)

Playlist (docked queue), Now Playing page, the full-screen player's queue (its list button), and an album's table, at
1440, 1100, 800 and 480. Only the Now Playing page overflows, by 2 to 4 px at 800 and 480, and it does on the before
build too (1 and 4 px), so it is not R15's. The playlist's Title is 200 at every width after (109 at 480 before).

### 5. Popular stars (B-265, I3, I4)

The Long Players, "Yours", five rows, 1440 x 900.
- **Mouse:** rated rows 2 and 5 (third star), pointer to the sidebar: after 367 to 332, 368 to 333 nodes (R10's 356),
  `document.activeElement` still the clicked `<li>` (not `:focus-visible`). Before 367 to 367, 403 to 403.
- **Within frames:** a rAF probe from just before the pointer left: Rating, Rating, then the one element from the third
  frame (29 ms). Box identical, (809, 536.5) 63 x 11.
- **Pixels at the swap:** a CDP screencast over the leave caught no frame without stars. But the two drawings differ:
  the Rating draws the filled stars with a pale outline that the one-element stars do not have (gold pixels in a 2x crop
  293 against 492; `cmp-swap-after`, and with keyboard focus `cmp-starlook-after`). So the swap is visible as a small
  change of the stars' look, not as a flicker. The same change happens on pointing at a row since R13's M5. New line B-269.
- **Keyboard:** Tab from the Yours chip runs row by row; a row draws its Rating only while it holds the focus. Arrow
  keys move between stars without rating; Space on the second star rated it with the focus on that star in every
  sample through the save and after; Tab on returned it to one element. 335 nodes with three rows rated.
- **Window switch (I4):** with a star focused, the app's own minimize: the star got `blur` with `relatedTarget` null and
  `document.hasFocus()` false; the Rating stayed, and after `Page.bringToFront` the window had the focus back on the same
  star. On the before build the same minimize fired no blur at all. A real Alt-Tab was not sent (no KWin, no input
  injection outside the app). Opening DevTools docked in the same window is the one case that drops the star: blur with
  `hasFocus()` true, the Rating unmounts, focus on `body` (a developer action, noted only).

### 6. Popular order (B-266, M1)

- Three Plays of row 5's own button (each ran on, the queue reached 57): after the order held for the whole sampling;
  before it moved three times (table).
- A favourite on Score 4 1: the heart changed in place, the order did not.
- Everyone, then Yours: the new order (Live Plain 6 1 fifth to second). A new visit (Home, then the artist) and Back:
  the new order, chip still Yours.
- M1: three plays of Hits Flag 8 away from the artist, then the artist through the bar's link, sampled every 50 ms: an
  empty list at 332 ms, the rows at 389 ms already in the new order, no change for the rest of 4 s (before 375 ms). The
  cached-then-reordered arrival did not happen on this loopback stand-in.
- Ratings and favourites put back with the keyboard and the heart, then read back on a fresh visit on the before build:
  all five Yours rows unrated, none a favourite.

### 7. Speed

`push.mjs` (Hits Flag 4's artist link, the app's Back, 10 rounds after a warm-up), Popular on Yours, queue docked,
backgrounds at their defaults; `wheel.mjs` 16 ticks down and up. No difference beyond noise: 258.0 against 257.5 ms of
main thread, the same 334 nodes, first tile 151.5 against 153.5 ms. Wheel scroll stays at p95 16.8 ms or under on both
pages in both builds. These are the workstation's numbers.

### 8. Seen in passing

- The Now Playing page keeps the chip row "Off Familiar Blend Discover" and the sentence
  "Autoplay is off. This queue stops at its end." that the side queue's header dropped (R14, R15). Both builds; by
  design per the header's comment, but it reads as two answers to one question from page to page (`r15-after-nowplaying-800x600`).
  New line B-270.
- Clicking the bar's cover at its centre moves the cover into the left sidebar (the hover button); the full-screen player
  opens from the cover's corner. Not a regression; noted because it is easy to hit.

## Bugs found

| Line | What |
|---|---|
| B-269 (new, low) | Popular: the Rating and the one-element stars draw filled stars differently (outline vs none), so a row visibly changes its stars when pointed at and when left |
| B-270 (new, low) | The Now Playing page still carries the autoplay status sentence and chip row that the side queue's header dropped |
| B-268 (evidence) | The cause is the stand-in AudioMuse's 503 on `station/start` latching Auto DJ; the row comes back by itself 60 s later on the next probe, moving the list under the user |

## B-267, judged on this display

The 12 px sliver alone is hardly noticed, but what it does is: at rest it cuts the fifth star of every rated row, and
scrolled it cuts the row numbers. The cells at the 40 px floor read wrong here: Album shows two clipped fragments per
row ("Wys / Live", "Elco / EP", "Posu / EP"), Genre "Jaz", "Indi / Roc", "Aml", with no ellipsis while their headers do
ellipsize, so the table looks broken rather than narrow. Before R15 the same columns had room and the damage was on
Title instead. My call for the owner: ellipsize the cells (cheap, consistent with the headers), and consider letting a
table that overflows by less than one floor shrink the floors to fit (the review's option (b)) so no 12 px scrollbar
appears for one sliver.

## Key screenshots

In `~/.cache/feishin-walk-r15-2026-10-29/shots/` (not in the repo), read back during the walk:
`cmp-hdr-nokind-{0,1,2}`, `cmp-hdr-playlist-autodj-on`, `cmp-after-hdr-album`, `r15-{before,after}-hdr-*`,
`cmp-tracks-1440-full`, `cmp-tracks-rated-1440`, `cmp-after-tracks-1440` (12 px scrolled vs not),
`r15-{before,after}-tracks*-{1440x900,1100x700,800x600,1600x900}[-scrolled]`, `r15-after-tracks11-wide-1600-afterdrag`
(Album at 551 px), `r15-after-sel-tracks-1440[-scrolled]`, `r15-{before,after}-{playlist,nowplaying,album}-*`,
`r15-{before,after}-fullscreen-*`, `cmp-swap-after`, `swap-after-2-*`, `cmp-starlook-after`.

## Not verified

**Watched running, with limits:**
- A remote device's queue in the header and a bound station's line: no active remote device, and `start` always
  answered 503 from the stand-in AudioMuse.
- 1920 wide: the screen gives 1600 x 900 at most. At 1100 and 800 the queue is the rail, not docked (B-207's fold).
- A real Alt-Tab; the window was deactivated by the app's minimize. The before build's minimize fired no blur.
- The hub was a private copy of the scratch hub, not the shared one (see Setup); the hub code and data were the same.
- The swap's pixels were caught by a CDP screencast, which sends frames only when something changes (5 to 7 frames over
  the leave), so a one-frame blank between them is excluded by the rAF probe, not by the screencast.

**Reasoned from code, not watched:**
- That every local play with a hub enabled would have replaced the shared session (read in `use-hub.tsx`).
- That B-268 happens with a real AudioMuse only when `station/start` fails; with a healthy one the row should stay.
- M1 on a slow server, and the floors with a larger font or `lg` / `xl` padding (unchanged from the VM note).

**Left behind:** the stand-in's play counts went up during the walk and stay up. Scratch profile edits not put back
exactly: after, Album's saved width 302 instead of 300; before, the disabled Artist column moved after Bitrate.
