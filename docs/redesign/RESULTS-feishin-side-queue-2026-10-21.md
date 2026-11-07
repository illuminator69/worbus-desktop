# Results: F4, the side queue

Plan: `PLAN-feishin-side-queue-2026-10-21.md` with its addendum (kept outside the repo, in the F4 context package). Branch `redesign/side-queue`, cut
from `origin/feat/redesign` at `a2094cf` (contains F1's `ae8e15f3`, F2's `c58c0b50` and F3's `6f048a23`). The harness checked out `redesign/shell`,
which lacks F3's merge commit, so the work is on a new branch cut from `origin/feat/redesign`. Written 2026-10-21 at the end of the branch.

One session ran the plan inline (`executing-plans`), Tasks 1 to 7 in order, one commit per task (Task 5 has two), plus one fix commit from the Task 7
sweep (reduced motion). One fresh whole-branch review follows; its findings, the fixes, the rulings and the deferred minors are appended at the end.

## Gates

| Check | Baseline (`a2094cf`) | Final |
|---|---|---|
| `tsc -p tsconfig.web.json` (TS6307 filtered) | clean | clean |
| `tsc -p tsconfig.node.json` | clean | clean |
| eslint `--max-warnings=0`, every changed TS/TSX file (25) | - | clean |
| stylelint `--max-warnings=0`, every changed CSS file (5) | - | clean |
| The 44 existing harnesses | 741 pass, 0 fail | 747 pass, 0 fail (`station-chips` 33 -> 39, the six toggle cases) |
| `queue-grouping.harness.ts` (new, Task 1) | - | 18 pass |
| `playing-from.harness.ts` (new, Task 2) | - | 13 pass |
| `group-row-index.harness.ts` (new, Task 5) | - | 5 pass |

47 harness files, 783 pass, 0 fail, run by hand (`node --test --test-reporter=tap <file>`, Node 22.22); CI does not run them. Every new harness was
seen to fail first (`ERR_MODULE_NOT_FOUND` for the three new modules; `does not provide an export named 'autoplayIsOn'` for the toggle cases).

**Install.** As F3 recorded: `pnpm install --frozen-lockfile` gets a 403 from the egress proxy on `codeload.github.com`. `node-mpv` and
`@electron/node-gyp` were cloned at their pinned commits and installed through a temporary, uncommitted `file:` override; `package.json`,
`pnpm-lock.yaml` and `pnpm-workspace.yaml` were restored byte for byte (`cmp` clean). A `pnpm exec ...` without the flag in the wrong place re-ran the
install, failed on the same 403 and removed `node-mpv` once; the workaround was repeated and the app was then started with
`./node_modules/.bin/electron-vite dev` directly. Commits ran `pnpm --config.verify-deps-before-run=false lint:staged`.

## Watched running

`electron-vite dev` under Xvfb (2600 x 1500 screen), driven over CDP with the package's `cdp.mjs`, `measure-queue.js` and `measure-layout.js`,
against the package's stand-in cover server behind a scratch front (`getUser.view`, empty Subsonic lists, `[]` for Navidrome's `/api/*`, a 404 for
`/api/song/<id>`: an empty answer there was merged into the playing song and blanked its id, name and duration). No hub, no station engine, no audio
(every play attempt errors and pauses). States were set through the stores via the dev handle (`window.__f2`, extended with the hub, station,
saved-queue and app stores), the station state re-asserted every 250 ms against the probe (addendum 24). Songs are generated (`Song N`, covers
`fixture:*`). Measurements at 1280 x 800 unless said.

### The header (Task 4)

| What | Seen |
|---|---|
| Rows at 360 px (album state) | Playing from block 54, status line 18, characters 34, Up next / Related 34, count line 36; header 236 px tall with its padding |
| `stickingOut` / `scrollsSideways` | none / false at panel 250, 300, 520 (1280 x 800), 360 (800 x 600, 1280 x 800, 2560 x 1440), 960 (2560 x 1440); no header row clipped |
| Count line | "49 songs, 2h 59m" at 360 and wider; "49 songs" at 250 and 300 (the length drops below a 280 px header content width) |
| Album, station bound | "Playing from / Lantern Season / Album · autoplay continues after it, Blend"; status "Hollow Orchard radio · Blend"; switch on; Blend selected |
| Mood mix, no station | "Relax - Folk / Mood mix · autoplay continues after it, <preferred>"; status "When this queue runs out, it carries on as a radio from its last tracks." |
| Stopped station (radio record, seed name "Hollow Orchard") | "Hollow Orchard radio / Station · stopped" (the hub's name wins over the seed's); switch off; characters at opacity .4; status "... · Autoplay is off. This queue stops at its end." |
| Another device | "Wren Songs / Playing on Pixel 8 · Blend"; count "31 songs, 1h 51m" from `remoteQueue` |
| Nothing playing | no Playing from block; switch off; characters dimmed; "0 songs, 0 min" |
| Fallback (no engine) | "Lantern Season / Album · Auto DJ"; status "Auto DJ"; no character row; the switch alone |
| Taps (state hold stopped first) | Discover: `bound.character` explore and the preference explore at once, status follows; switch off: `autoDJ` false, `bound.stopped` true; tap dimmed Familiar: autoplay on, bound close; switch off then on: restarts in the bound station's character |
| Dimming | samples every 25 ms: 1, .93, .65, .55, .44, .42, .4; reduced motion: .4 from the first sample |
| `...` menu | Play (shuffled), Go to current item, Create Playlist from queue, Table settings (save and restore hidden: the stand-in reports no server play queue); Table settings opens the `listConfigSettings` modal |
| Clear | opens the app's existing "Discard the current queue?"; Confirm empties it |
| Search | "Song 1" leaves Song 1 and 10 to 19; cleared, all rows return |
| Other surfaces | the Now Playing page keeps the old toolbar and the Off / Auto DJ chips |
| F3's shell | `measure-layout.js` after Tasks 4 and 7: cards 82 to 702, gaps 8 / 8 / 8 / 8 / 8, radius 10, no document scroll, no horizontal overflow, at every size above |

### The groups and the table (Task 5)

| What | Seen |
|---|---|
| Scratch proof before the queue used groups (groups of 5, reverted) | jump to Song 60 of 100: scrollTop 4590 and Song 60 at the centre; the same with the three table files stashed: 3732 (858 px = 13 rows short), a caption at the centre |
| Album 30, playing 3, rows 6 to 29 flagged | EARLIER, NOW PLAYING, QUEUED BY YOU 2, AUTOPLAY BLEND; the playing row centred on mount |
| Two skips | the NOW PLAYING caption stays at the same screen place with the song, playing row offset 0 each time; Queued by you 2 -> 1 -> gone |
| Regroup, row under fixed points (top + 100 and centre) | start Song 20 / Song 22 at scrollTop 1500; after a character tap (caption BLEND -> FAMILIAR), the switch off (-> OFF), a top-up of 5 flagged rows at the end, a reorder of row 36 to the end: Song 20 / Song 22 at 1500 every time |
| Go to current | hotkey ctrl+l from scrollTop 0: 3206, Song 50 centred (offset 0); the header's menu: the same |
| Arrow keys | ArrowDown from Song 49 to 55 across the NOW PLAYING, QUEUED BY YOU and AUTOPLAY captions and ArrowUp back: every step a song, fully in view |
| Selection | ctrl+a: 44 cells selected (11 rows x 4 columns), no caption; ctrl-click Song 49 and 51 across the Now playing caption, Delete: 80 -> 78, exactly those two gone |
| Search | captions still there at 100 ms (the 200 ms debounce), gone at 600 ms, back when cleared |
| Edge shapes | one song: NOW PLAYING; a stopped station with one kept row ahead: NOW PLAYING, QUEUED BY YOU 4, AUTOPLAY OFF, QUEUED BY YOU 6; empty: none; no station: EARLIER, NOW PLAYING, UP NEXT 7 |
| Remote 30, playing 2, served 5 to 29 | EARLIER, NOW PLAYING, QUEUED BY YOU 2, AUTOPLAY BLEND, Remote 2 centred; `remoteQueueIndex` 3: Queued by you 1, Remote 3 centred; back to local: the local groups |
| Captions' width | 0 to 360 of a 360 panel, the count's right edge at 346 (the board's 14 px); the same with duration moved to the first column |
| 5,000 songs, 120 scroll steps of 400 px (software rendering) | grouped: median 68 ms, p95 121, max 143; grouping off (a scratch flag, reverted): median 60, p95 123, max 139; jump to current: Song 2500 at offset 0 both ways |
| setQueue to paint, 5,000 songs | flagged tail: 403 ms grouped, 536 off; interleaved (about 2,500 runs after the playing row): 2370 grouped, 2768 off, so that cost is not the grouping's |

### The playing row and the captions (Task 6)

- Songs 48 px, captions 32 px (`rowHeights` [48], captions 32 each), the cover 40 x 40 in the playing row, no clipped cell content.
- The playing row: the accent container across all its cells, inset 4 px with radius 8; the equaliser glyph in its number cell. Glyph: paused no
  animation (bars at .55, 1, .75); the player status set to playing in the store: one animation per bar, moving; paused again: still; reduced motion:
  no animation while playing.
- A skip with follow-current off: scrollTop 400 kept, the row under the upper point (Song 9) kept; the Now playing caption moves 48 px down per skip.

**Contrast on rendered pixels**: text colour through a canvas, background from the screenshot inside each element's box, over `fixture:black`,
`fixture:grey25` and `fixture:split`, hues 40, 120 and 250 (`__coverWash.set({ hue, k: 1, meanL: 0.3 }, light)`), dark and light, autoplay on and off:
36 runs.

| Pair | Dark, lowest | Light, lowest |
|---|---|---|
| "Playing from" caption (on2) | 7.32 (grey25, h120) | 5.78 (black, h250) |
| Title (on) | 8.83 (grey25, h120) | 9.67 (black, h250) |
| Status line (on2) | 7.64 (grey25, h120) | 5.80 (black, h120) |
| Count line (on2) | 6.53 (split, h120) | 5.88 (black, h250) |
| Clear (on) | 7.78 (split, h120) | 9.82 (black, h40) |
| "Autoplay" label (on2) | 7.23 (grey25, h120) | 5.81 (black, h120) |
| Selected segment (accct on accc) | 6.17 (black, h120) | 8.01 (black, h40) |
| Unselected character | 6.26 (split, h120) | 7.82 (black, h40) |
| Unselected Up next / Related | 5.79 (split, h120) | 7.84 (black, h40) |
| Group captions (on2), lowest of the four | 6.81 (Earlier, split, h120) | 5.83 (Now playing, black, h250) |
| Caption trailing text (count, character) | 9.52 (black, h120) | 5.87 (black, h250) |
| Playing row title, artist, duration (accct on accc) | 6.17 (black, h120) | 8.01 (black, h40) |
| Glyph (non-text) | 6.17 | 8.01 |
| Switch thumb on its track (non-text), on / off | 6.17 / 5.18 | 8.01 / 4.68 |
| **Dimmed characters** (opacity .4 composited over the card) | **2.45** (split, h120) | **2.09** (black, h40) |
| **Switch track against the card** (non-text) | **1.29** (grey25, h120) | **1.00** (black, h120) |

Every text pair is 4.5 or more. The dimmed characters (expected, reported, not chased) and the switch's track against the card (the board's own
roles: `surf2` off, `accc` on) are under; the thumb against its track carries the state at 4.68 or more. **With `Cover colours` off** (default dark
theme): muted texts 6.77, the selected segment white on the primary 5.00, the switch track against the card 4.00; the playing row's title in the
primary on the tint measured 3.27 (3.64 on the plain row before F4), so the row's text now takes the foreground colour: 13.74.

### The sweep (Task 7)

- The board's four states, nothing playing and the fallback at 360 px (screenshots taken; compared with `QueueStates.jpg`). Differences: a muted
  status line under the title (kept from the chip row, addendum 9) that the board does not draw; the sentence is one line with an ellipsis where the
  board wraps it; no mood chips; hearts show only on hover or for favourites (the existing column) where the board draws one on every row; Autoplay
  off shows "Up next 2" where the board draws "Queued by you 2" (the plan's rule, addendum 21).
- Widths and windows: see the header table; 800 x 600 leaves about two and a half rows under the 236 px header.
- Beside F3's rail: hiding the panel shows the rail with "49 Up next"; showing it again restores the header and groups, **but the Up next / Related tab
  resets to Up next** (the tab state lives in the component that unmounts, as before F4).
- With the lyrics panel under it: header unchanged (236 px, nothing sticking out), 6 rows in view, "No lyrics found" in its own sub-panel.
- The vertical side-queue layout: the panel is 1024 x 320; nothing sticks out; **one song row in view** under the header.
- Keyboard: Tab from the header's start reaches the switch, the characters (one stop), Up next / Related (one stop), the search's text input, the
  search icon, `...`, Clear, then the table. Space toggles the switch both ways; ArrowRight inside the characters moves Blend -> Discover and taps it.
- Reduced motion: the dimming and the glyph stop (above). The sweep found Mantine's switch thumb slide (150 ms) and segment label colour fade (250 ms)
  running regardless; after the fix commit both are `transition: none` under reduced motion and the thumb has no in-between position. The search
  field's 0.3 s width transition is the existing `SearchInput` and still runs.

## Reasoned from code only (NOT VERIFIED)

- **The station engine's reply** to a character tap or the switch: rows swapped, the playing song uninterrupted, the hub's `stationEdits`. Watched
  only as far as the optimistic binding, the stored preference and the status line; the tap plan itself is the pure, tested `planChipTap`.
- **A real remote session**: the hub's `queueChanged`, a station driven by the phone (whose served ids are not this client's, so in reality its rows
  get no Autoplay group here, addendum 6.4); the remote groups above came from setting `served` by hand.
- **A real mouse drag** across a group header: not driven; reorders were made through the player store's `moveSelectedTo`.
- **The drawer and popover queues**: not opened (the player bar button tried was Play random); they still render the untouched
  `PlayQueueListControls` and `QueueSheetTabs`, which now take the `...` menu from the shared `QueueActionsMenu` with the same sections per tier.
- **Save to server / restore** in the new menu: hidden here (the stand-in has no server play queue); the items are the old ones, moved.
- The owner's own queues, saved-queue names and covers; audio; a real GPU (frame times above are software rendering); `prefers-color-scheme` changing
  while the app runs; light themes other than through the wash.

## Calls made beyond the plan

1. The dev handle also exposes `useAppStore` (panel width without a reload), beside the three stores addendum 25 names.
2. `servedIdsOf` in `station-store.ts`, shared by `readSnapshot` and `useQueueRows` (the plan asked for one helper).
3. A table prop `markActiveRow` (side queue only) carries `data-queue-active` and `data-queue-edge` onto the active row's cells.
4. The header turns off Mantine's switch and segment transitions under reduced motion (separate fix commit).
5. `QueueActionsMenu` comes with a `useQueueActions` hook and `queueTableConfig`, so the old toolbar's inline icons, its `...` menu and the new header
   share one set of handlers and one table-settings form.

## Rulings I made

In the section appended after the review, in order, each with its cost if wrong.

## Open for the owner

1. **Mood chips and "All"** (F5 and the hub's mood catalogue): not built; the header has no gap for them.
2. **The collapsed "Lyrics and waveform" bar**: not built; the existing sub-panels stay, and they still paint `--theme-colors-background-alternate`
   on top of the card (two translucent layers with the wash on).
3. **"Earlier"** (not on the board), **"Queued by you" only beside an autoplay group**, and **Autoplay off showing "Up next"** where the board draws
   "Queued by you".
4. **Two toolbars now**: the side panel has search as the expanding icon, Clear, and everything else (with Table settings) behind `...`; the drawer,
   popover and Now Playing page keep the old toolbar.
5. **Off moved from the chip row to the switch** in the side panel only; the other three queue surfaces still show Off as a chip.
6. **The hub's labels** still say Close, Balanced, Explore (both clients map them).
7. **Looks to overrule**: the playing row with `Cover colours` off (primary tint, foreground text); the dimmed characters at 2.09 to 2.45; the
   switch's track against the card at 1.00 to 1.29 (the board's roles); the status line under the title, which the board does not draw; the header's
   height (236 px) leaving about two rows at 800 x 600 and **one row in the vertical layout**; the Up next / Related tab resetting when the panel is
   hidden and shown; the `SearchInput` width animation under reduced motion; with follow-current off, a track change that adds or removes a caption
   above the view (the first skip adds "Earlier") moves the list by one caption; Table settings' row size and header switch do nothing in the grouped
   panel (rows are 48 px, no column header).
8. **Not verifiable here**: a real hub's station edits, a real mouse drag, a real remote session.

## Try this

- Panel 360 px, an album queue with a bound station: the four captions, the accent row; tap Discover, then the switch off and on.
- Panel 250 px: the count line drops the length; nothing sticks out.
- Scroll into the Autoplay group, tap a character: the list does not move.
- Skip a few songs with follow-current on: Now playing stays centred.
- Type in the queue's search: the captions go, and come back when cleared.
- Turn `Cover colours` off: the playing row becomes a primary tint with plain text.
- The vertical side-queue layout and an 800 x 600 window: how much queue is left under the header.

## The review (appended after the branch's last task)

One fresh reviewer (a separate agent on the most capable model, not the author) read the whole branch `a2094cf..639749e` with the plan, the addendum,
the plan's Review Focus and the ledger's rulings. It re-ran the web type-check, eslint on the 25 files and the four new or changed harnesses. Verdict:
ready to merge with fixes. No Critical finding; two Important; eight Minor.

| Finding | Graded | Outcome |
|---|---|---|
| The Ctrl+L show-playing hotkey found the row by the local player's song id (a song queued twice, or another device playing, lands elsewhere) | Important | **Fixed** (`fe629c3`): the active row's own id first, the song id as the fallback. Check: the playing song duplicated at row 5, ctrl+l: before scrollTop 32 with the playing row out of view, after 1744 with it centred (offset 0); a remote session after the fix: offset 0 |
| With the wash on, the playing row's opaque container hid its selection and hover (Delete could act on a selection you cannot see) | Important | **Fixed** (`dd18426`): selection and hover are mixed into the container, toward the window's `mid`. Pixel inside the row: plain (128, 64, 54), before the fix the same for selected and hovered, after (106, 50, 41) and (117, 57, 48). Text on the selected container 7.99 to 9.46 at hues 40, 120, 250 dark and light (a first attempt mixing toward the foreground measured 3.97 to 4.08 in dark and was replaced) |
| "Large" row size clipping two-line titles in the 48 px rows | Minor, regraded Important | **Did not reproduce**: 12 long titles, one line each (19 px), none past its row. Ruling below; the size and header options have no effect in the grouped panel |
| Nothing playing with Autoplay on shows the switch on | Minor | Ruling below (kept) |
| The other six | Minor | Deferred, listed below |

After the fixes: both type-checks clean, eslint and stylelint clean on the touched files, 47 harness files, 783 pass, 0 fail.

### Rulings I made (from the ledger, in order)

- Task 2: a blank or whitespace-only name, station name or source name counts as no title - a record can carry an empty string and the header must not draw an empty bold line - cost if wrong: a queue named with spaces shows no Playing from block
- Task 3: the selected-already guard lives inside toggleStationAutoplay (it recomputes selectedChip from the stores) rather than in the header component - one entry point, so any future caller gets the guard - cost if wrong: none visible; a caller that wanted a forced re-tap cannot get one through it
- Task 4: the dev handle (src/renderer/dev-handle.ts, dev-only, kept) also exposes useHubStore, useStationStore, useSavedQueuesStore (add. 25) and useAppStore (to set the panel width without a reload) - the states cannot be set otherwise without importing by URL - cost if wrong: four more dev-only entries on window.__f2
- Task 4: the count line drops the length below a 280 px header content width (a panel of about 308 px or less) with a CSS container query instead of a ResizeObserver tier; search stays the expanding icon, everything else is in the ... menu - no JS for a pure layout decision; measured nothing sticking out at 250, 300, 360, 520, 960 - cost if wrong: at 300 px the length is hidden though it might just fit
- Task 4: go to current in the header finds the playing row by id in the table's own rows (internalState.findItemIndex(playingRowId)) and scrolls to it; Task 5 makes the table's scrollToIndex group-aware so this stays correct with headers, and PlayQueue's own scrollToPlaying is added there for follow-current - cost if wrong: two call paths to the same scroll
- Task 4: the sentence under the title joins with " · " (the app's convention, as the status line) where the board writes " - ", and with Autoplay off and no station it shows only the kind word (the status line already says "Autoplay is off") - cost if wrong: a wording change in one function
- Task 4: the count line (search, ..., Clear) is shown only on the Up next tab, as the old toolbar was; on Related the header ends at the switch - cost if wrong: none for the queue; Related never had those controls
- Task 4: with Cover colours off the selected segment and the switch's on-track use the theme's primary-filled / primary-contrast pair (as the existing Switch does); with it on F2's accc / accct - cost if wrong: a colour pair in one CSS file
- Task 4: the Autoplay switch is Mantine's sm (its size vars are inline styles, so the board's 36 x 20 is not forced); its label is the board's small-caps "Autoplay" - cost if wrong: a 2 px difference in the switch width
- Task 5: onShowPlayingSong is not converted itself: it calls the handle's scrollToIndex, which now converts data to row index once (converting there too would add the headers twice); the plan's "three places" are the handle, the keyboard and scrollCellProps - cost if wrong: none found, the hotkey landed with offset 0
- Task 5: PlayQueue gets no scrollToPlaying() on its handle; the header's go to current (Task 4) already finds the playing row by id in the table's rows, and follow-current is an effect inside PlayQueue - one implementation instead of two - cost if wrong: a future caller wanting scrollToPlaying adds three lines
- Task 5: in grouped mode the store-driven scrolls (subscribeCurrentTrack, the initial setTimeout scroll and the AUTODJ_QUEUE_ADDED re-centre) are off; the effect keyed on the playing row id (and the grouping signature) scrolls only when the playing row changes, so a regroup alone (chip tap, top-up, reorder) never scrolls - plan 5.14 and 5.17 - cost if wrong: with follow-current on, a top-up no longer re-centres the playing row in the side panel (it still does on the other surfaces)
- Task 5: nothing playing (no playing row among the shown rows) draws no group header at all, not a lone "Up next" (add. 6.5 "no headers"); queueGroups itself keeps the plan's all-next rule - cost if wrong: a queue with no current song shows no caption
- Task 5: the served-id rule moved into station-store.ts servedIdsOf(state), used by readSnapshot and useQueueRows; remote rows never carry _stationId, so one expression (Boolean(_stationId) || served.has(id)) serves both - cost if wrong: none, readSnapshot's behaviour is unchanged
- Task 5: no scroll anchoring for a header appearing above the viewport; the three regroups the plan names (chip tap, top-up at the end, reorder below) were measured not to move the row under a fixed point; a regroup that inserts a header above the viewport (served ids arriving for rows above) would shift the view by one caption - cost if wrong: a one-caption jump in that rare case
- Task 6: the playing row's container is painted by a ::before layer on each cell of the active row (data-queue-active, data-queue-edge first/last/both for the 4 px insets and radius 8), behind a new table prop markActiveRow that only the side queue sets; the hover delegate is untouched - no row element exists - cost if wrong: a cell type that clips its own ::before would show a gap in the container
- Task 6: with Cover colours off the container is a 16 percent primary tint (color-mix over primary-filled) and the whole row's text takes the foreground colour; the title's primary on the tint measured 3.27:1 (3.64 on the plain row before F4), the foreground 13.74:1 (default dark theme) - cost if wrong: the side queue's playing title is no longer the primary colour with the wash off
- Task 6: the artist line in the playing row is accct at full strength, not the board's .85 opacity (the column's own classes are not reachable from the cell's CSS without coupling the two modules) - cost if wrong: the artist line reads as strong as the title
- Task 6: Mantine's dividers between unselected segments are turned off (withItemsBorders false) on both segmented controls; the board draws none - cost if wrong: none
- Task 7: the sweep found Mantine's switch thumb slide (150 ms) and segment label colour fade (250 ms) running under reduced motion; turned off in the header's own CSS in a separate fix commit; the existing SearchInput width transition (0.3 s) is left as it is (shared component, other surfaces) - cost if wrong: one CSS block
- Final: reviewer minor 6 regraded Important (side queue size large in 48 px rows) - large.js check did not fail: 12 two-line-capable long titles render one line, 19 px, none overflowing a 48 px row; the size and header options in Table settings simply have no effect in the grouped panel - cost if wrong: a setting that silently does nothing there (owner note)
- Final: reviewer minor 9 (nothing playing with autoDJ on shows the switch on and characters undimmed, where add. 6.5 says off and dimmed) - the switch shows this device's preference, which is what a tap would act on; forcing it off would show a state that is not stored - cost if wrong: an empty queue shows Autoplay on

### Deferred minors

- a track change with follow-current off can shift the list by one caption height (the first skip adds "Earlier" above; the last Queued-by-you row playing removes its caption), not only when served ids arrive (ruling 29 understates it)
- the dimming tween and the equaliser are gated on prefers-reduced-motion only, not on the app's Expressive motion switch (:root[data-motion='true'])
- the separators ", " and " · " in the count line and the Playing from sentence are outside t()
- arrow keys inside the character control send one chip tap per step (last one wins)
- useQueueRows runs (and subscribes to the station store) in the drawer, popover and Now Playing queues too, where grouping is off
- the playing row's "color: inherit" on every descendant gives a favourited heart an accct stroke over its primary fill
