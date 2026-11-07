# Results: the side queue, the bottom bar and the table headers tidied (R14), walked on the VM

Written 2026-10-28 by R14's fix agent. Plan: `navi-connect/PLAN-feishin-queue-and-bar-tidy-2026-10-28.md`. Branch
`fix/queue-and-bar-tidy-2026-10-28`, rebased by the controller onto R12's tip `57d37c5c`. All numbers below are **VM
numbers** (the sandbox VM, nested, VirGL). The GNOME session was **locked**, so they are positions, sizes and counts, not
frame times. The owner's items are B-249 to B-253.

## Commits

| Commit | What |
|---|---|
| `13b665d3` | Task 1: the side queue's header gets a hide button that runs the same toggle as the rail, the bar icon and the hotkey; the Up next / Related switch drops to the characters' 28 px (B-250, B-251) |
| `f938acec` | Task 2: Play random moves from the transport into the More menu, first row; the song text block gets a fixed basis (B-252, B-253) |
| `f1efda72` | Task 3: a sorted column's bar is the label's width and sits under an icon, not across it (B-249) |
| `5b0510ad` | Review I1: the header's line under the title no longer comes and goes with the Autoplay switch (no status sentence, no "Auto DJ"; the sentence under the title keeps its line when empty) |
| `43dfcba8` | Review M2, M3, M4: the header's Hide button sits on the rail's Show button's centre; the rail uses the bar's panel icon pair; a dead re-export goes |
| `8028a2c0` | Review I2: the song text block is 160 px (shrinkable), not 45 % of the column |
| `0adca8db` | Review M1: table header icons centred again (Task 3 had raised every one about 2.5 px) |
| `a67a93ea` | The fold hook's comment no longer names the re-export M4 dropped |

`center-controls.tsx` is now `master`'s minus the Play random button: the one deliberate difference from `master` in that
file (R8 had reverted it to `master`).

## Gates (workstation, at `a67a93ea`)

- `node --test $(git ls-files 'src/**/*.harness.ts')`: 1132 tests, 1132 pass, 0 fail.
- `tsc --noEmit --composite false`: `tsconfig.web.json` 0 lines after filtering TS6307; `tsconfig.node.json` 0 lines.
- `eslint --max-warnings=0` and `stylelint --max-warnings=0` on every file changed since `57d37c5c`: exit 0.
- `pnpm build:web` exit 0, `pnpm build:remote` exit 0, `commitlint --from 57d37c5c`: exit 0.
- On the VM, `pnpm build` exit 0 in both walked trees.

## Setup

| | Tree | Commit | CDP | Profile |
|---|---|---|---|---|
| before | `~/src/feishin-r14-before` (a detached worktree made for this walk) | `57d37c5c` | 9282 | `~/standins/run/r14/cfgprod-before`, a copy of the after profile |
| after | `~/src/feishin-r14` (branch `tmp-r14`) | `a67a93ea` | 9281 | `~/standins/run/r14/cfgprod` |

- Production builds, one window at a time. The shared app on 9222, the stand-ins on 4533, 4897 and 4899, R12's 9271/9272
  and R13's 9291/9292 were never driven, restarted or stopped.
- The cover sits in the bar (the sidebar cover collapsed), as in the owner's shots.
- Window sizes are CDP emulation. Reduced motion was emulated for every queue run: in the locked session the shell grid's
  CSS transition stalls part way (the rail read x 1076 instead of 1234 until it ended).
- Navigation by clicking only. The scripts are in `~/standins/run/r14/` (`walk.mjs`, `hdr2.mjs`, `hotkey.mjs` and helpers),
  the shots in `~/standins/shots/repair-r14-{before,after}-*.png`.

## What was watched

### 1. The queue hidden and shown from each control (Review Focus 1)

Wide window, 1920 x 1080, sequence rail, header, bar icon, bar icon, rail, header:

| | Before | After |
|---|---|---|
| Rail button | "View queue", centre (1890, 110) | "Show queue", centre (1890, 110) |
| Header hide button | none (the header click fails) | "Hide queue", centre **(1890, 110)**, the rail's own centre |
| Every step | the rail and the bar icon agree with `sidebar.rightExpanded` | all four controls agree with `rightExpanded` at every step |
| Panel width each time it opens | 360 | 360 |

Folded window, 1100 x 800 (the queue folds below 1180): rail, header, bar icon, bar icon, rail, bar icon.

| | Before | After |
|---|---|---|
| Rail opens the overlay | yes; the rail keeps saying "View queue" | yes; the rail then says "Hide queue" |
| Header hide in the overlay | none | closes the overlay; `rightExpanded` stays false |
| Bar icon | opens and closes the overlay | the same |

The overlay's Hide button stands at (1026, 110), left of the rail that stays beside it at (1070, 110): the overlay panel
does not cover the rail.

**Keyboard shortcut.** "Toggle queue" ships unbound. Bound to Ctrl+Shift+Y in the after profile (then cleared again):
at 1280 two presses closed and reopened the panel (`rightExpanded` false then true); at 1100 they opened and closed the
overlay with `rightExpanded` untouched.

### 2. The heart's x (Review Focus 2)

Five real songs: the bar's current song (Orywytalsea 1) and four titles from the library's table chosen by length (7, 9,
14 and 15 characters; the stand-in library has no longer ones). Then the owner's two Japanese titles from his shots
(スカイライン, マージナル) and a 98-character Latin title. The titles were written into the bar's title node; the artist,
album and cover are the real song's.

| Window | Before: heart centre x | After: heart centre x |
|---|---|---|
| 1920 | 215 to 307 by song; 704 for the 98-character title | **274** for every title |
| 1440 | 215 to 307; 464 | **274** |
| 1100 | 215 to 307; 354 | **274** |

The before build puts スカイライン's heart at 220, which is the owner's 264 at his zoom (about 1.2: the cover is 72 px in
his shots and 60 here). After, every line is one 18 to 19 px line; the 98-character title is cut with an ellipsis and
carries its full text in `title`. The review fixes' first measurement gave the same 274 at 1280 and 1000; the block shrinks below that (254 at 900).

### 3. Play random in the More menu (Review Focus 3)

| | Before | After |
|---|---|---|
| More menu, 1920 and 1000 wide | Sleep timer, Equalizer, Lyrics, Cast to a TV (DLNA), Playback options, Auto DJ, Stop playback | **Play random**, then the same seven |
| Play random rows | 0 | 1 at both widths |
| Buttons on the transport row | 14 | 13 |

The menu has no rows that depend on the window width, so a narrow window cannot add a second Play random. The
implementer's walk saw the row open the same "Play random" modal; this walk did not open it again.

### 4. The header at 1280 x 600 with lyrics (Review Focus 4)

| | Before | After |
|---|---|---|
| Header height | 80 | **92** |
| List height, lyrics folded | 299 | 287 |
| Whole queue rows visible, lyrics folded | 5 | 5 |
| List height, lyrics open | 179 | 167 |
| Whole queue rows visible, lyrics open | 3 | 3 |

The short header never showed the status line, so its removal frees nothing here. The header is 12 px taller because the
new 32 px Hide button is the tallest item in its one-row header. The rows visible are the same. At full height the header
is 200 (before 212), because the status line is gone.

### 5. The sorted column's underline (Review Focus 5)

Tracks at 1280 x 768, queue panel open, dark and light washes (Settings, Cover colours mode):

| | Before | After |
|---|---|---|
| Sorted by Name: bar under TITLE | 55 px wide (the column) | **32.3 px**, the word's width |
| Sorted by Top rated: bar vs the star's box | bar top 2 px **above** the star's bottom (through it) | bar top 0.5 px **below** it, 13 px wide |
| Icon centres vs word centres | 265 vs 264.5 | 265 vs 264.5 |
| Bar colour, dark / light | rgb(193, 217, 255) / rgb(6, 62, 147) | the same |

An album's table (Aeae Ella Live) and a playlist's (R1 colour walk) have no sorted column; their icons sit 0.5 px from
the words' centre in both builds. Task 3 alone had raised every header icon about 2.5 px; review M1 undid that.

### 6. The Autoplay switch and the header's lines (review I1)

A titled saved queue with no kind ("R8 scratch queue"), 1280 x 768, Autoplay off, on, off: header **200 / 200 / 200**, the
list's top at y 282 each time. Before R14 the header was 212 with "Autoplay is off. This queue stops at its end." and
the sentence under the title appeared with the switch on. The empty sentence line keeps its 18 px.

## Screenshots, read back

- `repair-r14-{before,after}-queue-open-1920.png`, against the owner's `08`: the after header has the hide button at the top
  right and no "When this queue runs out..." or "Autoplay is off..." line; the switches are the same height.
- `repair-r14-{before,after}-bar-1920.png`, against `01`, `02`, `06`: same song, the heart 46 px further right after.
- `repair-r14-{before,after}-hdr-tracks-star{,-light}.png`, against `05`: before, the bar crosses the star's lower tips;
  after, it is a short bar under the star.
- `repair-r14-{before,after}-short-1280x600.png` and `-more-1920.png`.

## Not verified

- **The owner's GPU and library.** Everything above is on the VM's stand-in library.
- **A bound station's line live.** Starting a station replaces the scratch hub session's queue, which the shared 9222
  app and R13's walk mirror, so no station was started. The line is now the bound station's label alone
  (`panelLineIsTheBoundStationOnly`). It still appears on its own when autoplay binds a station at the queue's end.
- **A playing song.** Nothing was played, for the same reason (the session is shared). The bar shows the same layout
  paused.
- **Real long titles.** The library's longest is 15 characters; the long cases were written into the bar.
- The Hide button's tooltip text, and the pressed look of the bar icon (its label is a tooltip, not an attribute).

## Left open

- The 12 px the Hide button adds to the short header (1280 x 600), table above. A negative block margin would win it back
  but move the button off the rail's centre in that window.
- When Autoplay is off on a queue with no kind, the sentence line is an empty 18 px line.
- Under an icon the bar sits closer (0.5 px below its box) than under a word (on the text box's bottom).
