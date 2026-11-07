# Results: R12 to R14 walked on the workstation

Written 2026-10-29 by the workstation walk agent. One walk of repair stages R12 (boxes and the #301 crash), R14 (side
queue, bottom bar, table headers) and R13 (album, artist and discography pages) on the owner's machine: Fedora, KDE
Plasma on Wayland, the app's window at `devicePixelRatio` 2, 60 Hz, the session unlocked for the whole walk
(`LockedHint=no` at every check). No app code was changed. Everything below was watched on this machine unless a line
says it was reasoned.

## Setup

| | Tree | Commit | CDP | Profile |
|---|---|---|---|---|
| before | `.worktrees/repair-r11/feishin` | `f8790ef3` (R8 to R11 + the last workstation note) | 9341 | fresh, `~/.cache/feishin-walk-r12-r14-2026-10-29/cfg-before` |
| after | `.worktrees/repair-r13/feishin` | `ac0c028a` (R12 + R14 + R13) | 9342 | fresh, `.../cfg-after` |

- **Builds.** `pnpm run build` in each tree, one at a time, logs in the work dir: exit 0 and exit 0. Both trees were clean
  and on the stated HEAD before and after. No install, no typecheck run, no branch switched.
- **Data.** The VM's stand-ins only, through ssh forwards: the stand-in Navidrome (4533, behind a local cover proxy on 4534
  that gives each cover id its own colour, as the last walk did) and R11's PRIVATE stand-in (fake lb-bot 4907 behind the
  private scratch hub 4909), started with `~/standins/run/r11/stack-r11.sh fake` and `hub` and stopped at the end. Both
  profiles used the private hub 4909 for everything (Auto DJ included), so the shared hub 4899 and the shared app on 9222
  were never touched. The shared 4533, 4897, 4899 and 9222 were never restarted. The forwards were taken over by an ssh
  ControlMaster that was already running on this machine (not started by this walk); they were cancelled with
  `ssh -O cancel` at the end and no listener is left.
- **Passwords and tokens.** Read into the environment at run time by `sp.sh` / `ht.sh`; written nowhere. A grep of the
  work dir for each as a whole word: 0 files.
- **Window.** Sized only by the page's own `window.resizeTo` over CDP. Got exactly: 1440 x 900, 1280 x 600, 1100 x 800,
  1000 x 800, 800 x 600. **1920 x 1080 was asked and 1600 x 900 was got** (the screen's logical size), so every "1920"
  check of the brief ran at 1600.
- **Frames.** Every frame number is a real 60 Hz frame of this GPU. Three times the app's window stopped getting frames
  (rAF 0 in 500 ms: another window covered it). Each time the app was stopped and launched again (its new window comes up
  on top; no KWin call) and the run was redone; no number below comes from a run without frames.
- **Audio.** Muted from the bar for the whole walk. Playback stayed local; no `cast-*` device was touched.
- **Profile edits.** Scratch profiles only: Settings > artist and album background images toggled for the two band modes,
  Cover colours mode light and back to dark for the underline, "Toggle queue" bound to Ctrl+Shift+Y in the after profile.
  The stand-in's ratings and favourites changed by the Popular check were put back and read back (below).

### KDE config

`sha256sum ~/.config/kwinrc ~/.config/kwinoutputconfig.json ~/.config/kscreen/*` before (14:16, taken by the first,
stopped attempt, kept as this walk's baseline with a read-only copy of `kwinoutputconfig.json`) and after (16:54):
**identical** (`kwinrc` `21474a50...6f52e7`, `kwinoutputconfig.json` `e4389b21...6f52e7`); the two copies of
`kwinoutputconfig.json` do not differ. `~/.config/kscreen/` does not exist. Nothing ran nested.sh, a compositor,
dbus-run-session, kwin.sh, raise.sh, a KWin script, `org.kde.KWin`, kscreen-doctor or kwriteconfig.

## The numbers, before and after

| What | before `f8790ef3` | after `ac0c028a` |
|---|---|---|
| Clear the queue with a song playing (error pages) | **9 of 10** (and 4 of 4 in a rerun) | 0 of 10 |
| Next x5, 400 ms apart, 10 rounds | 0 of 10 | 0 of 10 |
| Auto DJ end of queue (Short Three, Autoplay on) | **7 of 10** | 0 of 10 |
| A Next onto an Auto DJ song with no cover | **10 of 10** qualifying rounds (12 run) | 0 of 15 qualifying (24 run); the empty-cover icon shows |
| Cover cross-fade on a new album's Play | old cover at opacity 1 under the new one for 19 frames while it fades 0 to 1 (2 of 4 plays; the other 2 covers were cached, no fade) | the same, 17 to 18 frames (3 of 4 plays) |
| Gaps box top after Request, top under the bar (1440 x 900) | stays at 27 (bar bottom 147) | one move 574 to 446 in 17 frames, 284 ms, p50 16.6, p95 18.6, max 18.6 ms; top 155 |
| The same at 800 x 600 | stays at 31 | 17 frames, 284 ms, p95 18.0; top 155 |
| The same, queue docked open at 1440 | stays at 27 | 17 frames, p95 17.5; top 155 |
| Missing album box after Download, top under the bar | stays at 70 (1440), -80 (800) | top 155 at both (368 to 283; 635 to 400) |
| Gaps box refusal | sentence at the box's bottom, 232 px under Request, left 276 vs the button's 334; no Search again | 12 px under Request, same left (334; 182 at 800); Search again on its centre line, 12 px right |
| Missing album refusal | no sentence in the page; a toast at (605, 765) | "Could not resolve album" 6 px under Download, same left (340; 188 at 800) |
| Show / Hide queue button centres (1600 x 900) | no Hide button in the header | both (1570, 110); panel width 360 every time |
| Up next / Related switch | 34 px, 13 px type | 28 px, 12.5 px type |
| Queue header 1440 x 900, Autoplay off / on / off | 134 / 158 / 134 | 140 / 140 / 140 |
| Queue header 1280 x 600 | 80 | **92** |
| Queue list height 1280 x 600, lyrics open / folded | 179 / 299 | 167 / 287 |
| Heart centre x, 6 titles (5 to 98 chars, two Japanese), at 1100 / 1440 / 1600 | 212 to 544 by title | **274** for every title at every width |
| Play random | a transport button | More menu first row, once, at 1600, 1000 and 800 |
| Sorted bar, TITLE | 86 px (the column) | 32.3 px (the word) |
| Sorted bar, rating star | top 269.5 vs the star's bottom 271.5 (2 px through it), 34 px wide | top 272, 0.5 px under, 13 px wide |
| Album About, long (Signal Fires), folded | 65.1 px (3 lines), the label "ABOUT" is the toggle, tags in a column beside | 116.1 px (5 whole lines), an arrow at the cut, tags and links under |
| Album About open | 1 frame, +755.9 px | 27 frames, 450 ms, p50 16.6, p95 17.5, max 17.9 ms, largest step 62.3 px |
| Album About close (arrow at 400) | 1 frame | 27 frames, 457 ms, p95 18.0, max 23.3 ms; scroll 695 to 200, the arrow ends at 299 |
| Album About, reduced motion (CDP media emulation) | 1 frame | 1 frame |
| Gaps box, largest one-frame step, folded > tracks | 37.8 px, and it is the LAST frame (the snap) | 28.1 px (2nd frame); last step 0.5 |
| tracks > folded | -37.7 px, last frame | -27.9; last -0.5 |
| Fill gaps > sources | grow 60.4 px; inner view swaps 550 px inside the clip | grow 60.3 px; inner view swaps 578 px inside the clip (no change) |
| Request > active / active > done / done > gone | -43.6 / -25.4 / -17.3 (first frame) | -43.6 / -25.2 / -11.8; last steps 0.5 to 0.6 |
| Hero band end vs hero bottom (artist / album / discography), both modes | 418 / 412 / 288 vs 354 / 348 / 224 | at the hero's bottom on all three, both modes, at 1440, 1100 and 800 |
| Largest colour step, hero bottom -40 to +120 px, image mode, album / artist | 20 at y 412 / 5 at 418 | 2 / 2 |
| Bar vs hero (R9 check, largest channel diff) | 0 to 1, but **19** on the artist in image mode | 1 everywhere |
| Popular columns | 28 40 404 120(play count) 52 32 | 28 40 396 84(rating) 32(heart) 52 32 |
| Artist sections | popular, favorite-songs, about | popular, about |
| `main` nodes, The Long Players, Popular "Yours" (5 rows), fresh arrival | n/a | 347 (R10 limit 356) |
| Discography edges vs artist sections, 1440 / 1100 / 800 | 248-1064 / 248-1040 / 96-740 vs 280-1032 / 280-1008 / 128-708 | equal to the artist's at all three |
| Album > artist push, main thread, median of 10 [min, max] | 243.5 [214, 266] ms | 272.5 [264, 288] ms |
| Script / RecalcStyle / Layout | 86.5 / 39 / 13 | 85 / 49.5 / 13 |
| First release tile, DOM nodes after arrival, worst frame | 145 ms, 279, 50.1 ms | 138.5 ms, 257, 50 ms |
| Wheel scroll, album (4 runs), p50 / p95 / max | 16.7 / 16.7-16.8 / 16.8-33.4 | 16.7 / 16.7-16.8 / 16.8-33.4 |
| Wheel scroll, artist (4 runs), p50 / p95 / max | 16.7 / 16.7-16.8 / 16.8-17.4 | 16.7 / 16.7-16.8 / 16.8-16.9 |

## Per item

### R12

1. **The #301 crash (B-229, B-210).** R12's own `crash.mjs` (copied from the VM, adapted to 9341/9342 and `resizeTo`),
   clicks only, the bar's cover shown (the sidebar cover put away by its own button). Counts above. A check added here:
   on the before build the error page was not there before Clear and was there after it (4 of 4), so it is Clear that
   crashes. On the after build every path ended on the right queue position (Next x5: 2 to 8 of 28 each time). The
   no-cover Next qualifies only when Auto DJ's next song has no cover id, so the after build was run for 24 rounds to get
   15 qualifying ones. The cross-fade: a rAF sampler over the bar's `<img>` stack while an album's Play was confirmed
   after a reload. Both builds keep the old image (class `under`, opacity 1.00) for the whole fade of the new one
   (opacity 0, 0.21, 0.42 ... 1.00 over about 270 ms) and drop it in the next frame. A Next onto a prefetched cover swaps
   with no fade in both builds (fade only when the cover is not in the session cache).
2. **B-236.** Cases A (top in view) and B (top under the bar) on both boxes at 1440 x 900 and 800 x 600, B again with the
   queue open. A never moves (top 171). B lands once on bar + 8 = 155; the motion's path at 1440 was 559.5, 539, 520 ...
   446.5, 446 (17 frames, largest 20.5 px in a frame). A wheel during the motion (case D, 240 px down as soon as the
   motion's first write lands): at 1440 the motion wrote once (574) and the wheel then carried the page to 814 with no
   further write, so the wheel wins; at 800 the wheel arrived before the first write (810, no write). "Queue open" at
   800 x 600 is the folded rail (below 1180 the open panel is an overlay); there the result is the same as closed.
3. **B-238.** `grefuse` / `drefuse` one-shot refusals, card #2 picked on the gaps box. Positions above. After Search again
   the box went searching, then back to the cards, the refusal gone, and a second Request reached `active`. On the album
   box the second Download reached fill/active. Shot `r12-after-b238-gap-refused-1440x900` read back: the sentence in
   lb-bot's words under the pressed button, Search again beside it.

### R14

4. **B-250.** Sequences rail, header, bar icon, bar icon, rail, header at 1600 x 900 and rail, header, bar icon x2, rail,
   bar icon at 1100 x 800 (`walk.mjs queue` from the VM). Every step: one state (`rightExpanded`), the rail's and the
   header's labels "Show queue" / "Hide queue" follow it, and the bar icon, the rail and the header button draw the same
   icon pair (panel-open arrow when hidden, panel-close arrow when shown; compared by path). At 1100 the overlay's Hide
   sits at (1026, 110) beside the rail (1070, 110), and `rightExpanded` stays false. The hotkey (bound for this walk):
   two presses hid and showed the docked panel at 1440 and opened and closed the overlay at 1100. Before: no header
   button, the rail says "View queue" and is gone while the panel is open.
5. **B-251.** Heights above. The two VM trade-offs, judged on this display (shots
   `r14-{before,after}-queue-header-1440x900-lyrics-open*.png`, `-1280x600-*`):
   - **12 px taller at 1280 x 600** (80 to 92): it reads fine. The one-row short header gains the 32 px Hide button and
     loses 12 px of list (167 instead of 179 with lyrics open); in this window that is a quarter of a row, not a row.
   - **The 18 px blank line with Autoplay off**: it shows. At 1440 there is an empty band between the Autoplay row and
     the switch, about twice the gap the before build has there, and it stays the same with Autoplay on. It does not
     jump any more (140 / 140 / 140, where before was 134 / 158 / 134), but read alone it looks like a missing line.
   - No characters row on this stand-in (the private hub has no AudioMuse), so the switch could not be set beside them.
6. **B-252.** More menu items at 1600, 1000 and 800: Play random first, once; the rest unchanged (Sleep timer, Equalizer,
   Lyrics, Cast to a TV (DLNA), Playback options, Auto DJ, Stop playback); no row depends on the width. The row opened the
   modal "Play random | Songs | Albums | How many songs? | From year | To year | Genre". `git diff master HEAD` on
   `center-controls.tsx`: 2 insertions, 22 deletions, all of them the Play random button, its import and the comment.
7. **B-253.** The heart's centre for the bar's own song, the stand-in's longest real title ("Marste Holglassglass 1", 22
   characters), the owner's two Japanese titles, a 35-character Japanese and Latin title and a 98-character one, written
   into the title node. After: 274 for every title at 1100, 1440 and 1600; every line one 18 to 19 px line, the full text
   in `title`. Note: the stand-in's longest real title is now cut with an ellipsis ("Marste Holglassglas...",
   `r14-after-bar-22chars`); the stand-in has no Japanese titles of its own.
8. **B-249.** Tracks at 1440 x 900 with the queue open and the default Filters panel, sorted by Name and by Rating
   (the sort menu), dark and light washes (Cover colours mode). Numbers above; the bar colour is rgb(166, 236, 174) on
   dark and rgb(1, 84, 28) on light in both builds, and the geometry is the same on both washes. Icon and word centres
   265 / 265 in both builds. An album's table (Two Disc Set, also sorted by Duration and Name) and a playlist's
   (R1 colour walk) draw no sorted bar at all, in either build; their icons and words share a centre (486, 371).
   Crop `r14-{before,after}-hdr-star-{dark,light}-1440`.

### R13

9. **B-243.** Signal Fires on the fake's long About (`meta=long`; the hub caches an album's About, so an album never
   opened before was used). Numbers above, from a rAF sampler (box height, section top, arrow top each frame). Undertow's
   About (the short text, 95 px) shows whole with no arrow and no reserved space (box = text height). The artist page's
   About could not be made to fold: the fake's artist About is at most 98 px (5.4 lines) even at 800 wide, and the fold
   needs a whole sixth line; shots `r13-after-artist-HollowOrchard-about` (1440) and `-about-800`.
10. **B-244.** R13's `gapsnap2.mjs` (a ResizeObserver per painted frame) plus a rAF frame-interval recorder. Numbers above.
    On this GPU the before build already moved in frames (17 frames for folded > tracks), so the VM's 58 / 66 / 206 px
    single-frame jumps were not reproduced; what the owner saw is the snap at the end: before, the largest step of a fold
    is its last frame (37.8 px), after, the last step is 0.5 px. Fill gaps > sources is the same in both builds (the grow
    tweens, the inner view swaps inside its clip). Durations follow the shared tokens (`FOLD_EASING`, 300 ms below
    240 px, 450 ms above): the About's 596 px took 450 ms, the gaps box's 179 px about 250 to 280 ms (the tail under
    0.5 px is not counted), its 417 px about 400 to 460 ms.
11. **B-237.** DOM band ends and pixel samples above (column at x = main's right - 36, clear of text, from hero bottom
    - 40 to + 120). In the cover-wash mode the before build's band edge is a soft gradient on this stand-in (step 2 to
    3); the hard edges were in the image mode. After: the band ends at the hero's bottom in both modes on all three pages.
12. **B-245 / B-246.** On "The Long Players", Popular "Yours":
    - Mouse: the 4th star of "Hits Flag 8 1" and of "Live Plain 1 1" (the bar's song, paused). At +150 ms and +1.6 s the
      rating reads 4, the five rows keep their order and tops (402, 458, 514, 570, 626), focus is in the row.
    - Keyboard: Enter on the heart: favourited at +150 ms, focus stays on the heart. Space on the 4-star input: cleared,
      focus stays on it. A mouse click on the heart: un-favourited, focus on the heart.
    - The change shows in the bar (4 stars, filled heart), on the album page ("Live Plain 1", the song's row heart filled;
      the album table has no rating column on this stand-in) and in the Library's Songs list (Tracks, Filters > Artists
      "The Long Players", sorted by Rating: the row first, 4 stars and the heart).
    - Restored and read back: both songs unrated and not favourites.
    - Sections: popular, about on every artist walked (The Long Players, Hollow Orchard, Glasszen Marverglass). The
      stand-in has at most 2 favourite songs per artist, so "an artist with many favourites" could not be compared.
    - Nodes: 347 on a fresh arrival (Yours, 5 rows); 383 after an edit, see B-265.
13. **B-247 / B-248.** Edges above; at 1100 with the queue overlay open the page under it keeps 280-1008 (the overlay covers
    688-1048, as before). No Play or Shuffle in the after hero. The stand-in's longest artist name is "Glasszen
    Marverglass", 20 characters: 299 px at 29 px type, not truncated in either build, in a 640 px row (468 at 800).
14. **Speed.** `push.mjs` from the last walk (hero artist link of "Hits Flag 4", the app's Back), Popular on "Everyone",
    both backgrounds off, queue docked. The after build is not faster here: 272.5 against 243.5 ms of main thread
    (+12 %), almost all RecalcStyle (+10.5 ms); first tile 138.5 against 145 ms, 22 fewer nodes. A first after run with the
    bar holding a The Long Players song gave 289 ms. The VM's 1512 to 511 ms direction does not hold on this GPU. Wheel
    scroll stays inside R7's budget (p95 16.8 ms) on both pages in both builds.

### 15. Seen in passing

- Library > Tracks at 1440 x 900 with the queue open and the Filters panel open (the default): the Title column is one
  or two letters wide ("D...", "A..."), the Bitrate header is clipped to "'RA", and a rated row's four stars draw over its
  heart. Both builds for the squeeze and the clip (`r14-before-tracks-page`); the stars over the heart seen on the after
  build, the only one with a rated row on screen (`r13-after-popular-edit-library-songs`). New line B-264.
- After an edit from Popular, the edited row keeps its full Rating mounted (57 to 60 nodes against 21) after focus and
  pointer have left: `main` 383 nodes against 347 on a fresh arrival. New line B-265.
- Popular "Yours" reorders while the page is open when a play is counted: one Next in the bar moved "Live Plain 1 1"
  from third to fourth with nobody touching the page. New line B-266.
- A "Discard the current queue?" dialog asks before Popular's Play replaces the queue (expected, noted because a scripted
  click lands on it).

## Bugs found

| New | What |
|---|---|
| B-264 | Library Tracks with the queue and Filters open: Title one or two letters wide, Bitrate header clipped, stars over the heart |
| B-265 | Popular: an edited row keeps its full Rating mounted until the page is left (+36 nodes, 383 against R10's 356) |
| B-266 | Popular "Yours" reorders live when a play is counted |

## Key screenshots

In `~/.cache/feishin-walk-r12-r14-2026-10-29/shots/` (not in the repo), read back during the walk:
`r12-{before,after}-b236-gap-{A,B}-{1440x900,800x600}`, `r12-after-b236-gap-D-*`, `r12-{before,after}-b236-album-B-*`,
`r12-{before,after}-b238-{gap,album}-refused-*`, `r12-after-b238-gap-second-*`,
`r14-{before,after}-queue-header-{1440x900,1280x600}-lyrics-{open,closed}[-autoplay-on]`, `r14-{before,after}-more-1600`,
`r14-after-playrandom-modal`, `r14-{before,after}-bar-1440`, `r14-after-bar-22chars`,
`r14-{before,after}-hdr-{TITLE,star}-{dark,light}-1440`, `r14-{before,after}-hdr-{album-twodisc,playlist-r1}`,
`r13-{before,after}-about-SignalFires-{folded,open}-1440`, `r13-{before,after}-about-Undertow-*`,
`r13-{before,after}-gapsnap-1440`, `r13-{before,after}-{img,cw}-{album,artist,discography}-1440x900-{A,B}`,
`r13-{before,after}-cw-*-{1100x800,800x600}-A`, `r14-{before,after}-disc-1100-queue-open`,
`r13-{before,after}-disc-longname-{1440,800}`, `r13-after-popular-edited`, `r13-after-popular-edit-album-page`,
`r13-after-popular-edit-library-songs`, `r13-after-artist-HollowOrchard-about[-800]`, `r14-before-tracks-page`
(`r14-before-hdr-TITLE-light-1440` is in fact the star-sorted header: the before build's Title sort was not caught on the
light wash).

## Not verified

**Watched running, with limits:**

- 1920 wide: the screen gives 1600 x 900 at most; every 1920 check ran at 1600.
- The characters row beside the Up next / Related switch: the private hub has no AudioMuse stand-in, so it never showed.
- A station's line in the queue header and a real lb-bot refusal: the refusals are the stand-in's, in lb-bot's shape.
- An artist with many favourite songs (the stand-in has 2 at most), an artist About long enough to fold (the fake's is
  at most 5.4 lines), an album table with a rating column (none on this stand-in), a sorted bar on an album or playlist
  table (they draw none).
- The before build's hotkey and its Play random modal were not opened again; the Title underline on the light wash was
  measured on the after build only.
- Rows visible in the queue are compared by list height, not by row count: the queue's position differed between the
  two profiles, and caption rows change the count.

**Reasoned from code, not watched:**

- That the gaps box and the About use the same easing: read from `features/motion/grow.ts` (`FOLD_EASING`, 300 / 450 ms
  by a 240 px rule) used by `grow-box.tsx` and `clamp-fold.tsx`; the frame counts agree with it.
- That the after build's fade is skipped for a cached cover by design (`fade = !isInSessionCache` in `image.tsx`); both
  builds behave the same.
- That B-229 and B-210 share one cause: both paths went from failing to 0 on the after build here; the cause itself was
  measured on the VM, not here.
