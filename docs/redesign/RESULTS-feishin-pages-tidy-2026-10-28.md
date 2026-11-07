# Results: the album, artist and discography pages tidied (R13), walked on the VM

Written 2026-10-29 by R13's fix agent.

- **Plan:** `navi-connect/PLAN-feishin-pages-tidy-2026-10-28.md`.
- **Branch:** `fix/pages-tidy-2026-10-28`, rebased by the controller onto R14's tip `1becdd74`.
- **The owner's items:** B-237 and B-243 to B-248.
- **Every number below is a VM number** (the sandbox VM, nested, VirGL). The GNOME session was locked and the app ran
  with frames forced (`--disable-gpu-vsync --disable-frame-rate-limit`). So positions, sizes, node counts and per-frame
  steps are good evidence; frame times are not.

## Commits

| Commit | What |
|---|---|
| `a00b36cd` | Task 1: the album About folds like the artist's (a shared `ClampFold`, arrow at the cut, fold motion) (B-243) |
| `93786f87` | Task 2: the gaps box folds on the app's motion and nothing inside it snaps (B-244) |
| `11aa2038` | Task 3: Popular shows rating and heart instead of the play count; the Favourite songs section and its switch go (settings v42 migration); a hero's band ends with the hero (B-237, B-245, B-246) |
| `8e794302` | Task 4: the discography page uses the artist page's margins and drops Play and Shuffle (B-247, B-248) |
| `86a8e6b7` | Review I1: the album's tags and links sit under a five-line About, not beside it |
| `60a3d3b5` | Review M1: the fold cuts on the text's own line boxes and folds only when a whole sixth line exists |
| `5ef919e2` | Review M3: closing an About moves the page only when the arrow would pass under the bar |
| `218e0e23` | Review M7: a harness pins `FOLD_EASING`, `GROW_MS` and `GROW_MS_TALL` to global.css |
| `b113e496` | Review M4: the shared Rating takes `busy` (inputs kept during a save); the heart ignores a press instead of being disabled |
| `0ffd1670` | Review M10: Popular's heart and stars name their song |
| `0ea3c6c0` | M3 follow-up ruling: closing from deep in a long About settles the About's top under the bar, so the folded lines show |
| `064008fb` | Ruling M5: a rated Popular row draws its stars as one element until it is pointed at or focused |
| `79507ae0` | Ruling M9: a short hero's band ends with the hero (the overlay's 200 px floor is lifted for hero bands) |

## Gates (workstation, at `79507ae0`)

- Harnesses (`node --test` over every `src/**/*.harness.ts`): 1151 tests, 1151 pass, 0 fail. The count was 1148 at the
  rebased `0ffd1670`.
- `tsc --noEmit --composite false`: `tsconfig.web.json` gives 0 lines after filtering TS6307; `tsconfig.node.json` gives
  0 lines.
- `eslint --max-warnings=0` and `stylelint --max-warnings=0` on every file changed since `1becdd74`: exit 0.
- `pnpm build:web` 0, `pnpm build:remote` 0, `commitlint --from 1becdd74` 0. On the VM, `pnpm build` 0 in both trees.
- Added lines contain no em dash, and no commit carries attribution.

## Setup

| | Tree | Commit | CDP | Profile |
|---|---|---|---|---|
| before | `~/src/feishin-r13-before` (a detached worktree made for this walk) | `1becdd74` (R14's tip) | 9292 | `~/standins/run/r13/cfg-base` |
| after | `~/src/feishin-r13` (`tmp-r13`) | `0ea3c6c0`, then `064008fb`, then `79507ae0` | 9291 | `~/standins/run/r13/cfg-after` |

- Production builds, one window at a time.
- lb-bot came from R11's private fake on 4907 behind the private hub on 4909/4908. All three were stopped at the end.
- The shared app on 9222 and the stand-ins on 4533, 4897 and 4899 were never driven, restarted or stopped. Neither were
  R12's 9271/9272 or R14's 9281/9282.
- Window sizes are CDP emulation; the side queue is open at 1440 and 1920.
- Navigation was by clicking only: the search palette, the hero's artist link, the discography link, row menus.
- Scripts: `~/standins/run/r13/fx-*.mjs`, `p2-pages.sh`, `gapsnap2.mjs`. Shots:
  `~/standins/shots/repair-r13-p2-*.png` and `repair-r13-fix-*.png`.
- Data:
  - Album "Undertow" (Hollow Orchard), with the fake's long lb-bot About: two paragraphs, 31 lines.
  - Album "Hits Flag 4" and its artist "The Long Players".
  - A not-owned album ("Lost Album 13") reached from the discography.
- Stand-in edits: every rating and favourite the walk changed was put back. Read back last: "Live Tagged 5 1" favourited
  and unrated, and Popular's five "Yours" rows unrated.

## What was watched

### 1. The album About (Review Focus 1, B-243, I1, M1, M3)

Album "Undertow", side queue open:

| | Before 1440 | After 1440 | After 1920 |
|---|---|---|---|
| Layout | About 276–704 beside tags 736–1036 | About, then tags under it, all 276–1036 | the same, 276–1516 |
| Folded text | 65 px (3 lines, CSS clamp) | 116.1 px = 5 whole lines (line 5 bottom 113.8, line 6 top 118.4), 0 sliced | 116.1 px |
| Toggle | the label "ABOUT" | an arrow at 498, under the cut | arrow at 462 |
| Tags / links | 354–466, right column | genres 566, tags 600, links 636–654 | 530 / 564 / 600–618 |
| Open | one frame, +755.7 px (no motion) | 67 frames over 422 ms, largest step 64.6 px | 68 frames, 426 ms |
| Close, arrow pressed at 400 (text top above the window) | one frame | the About's top settles at 155 (bar 147 + 8); arrow ends at 299, the folded lines visible | the same: top 155, arrow 299 |
| Close, arrow staying in view (1920, arrow at 920) | (no case) | (no case) | scroll unchanged (138 → 138); the arrow rises to 324 |
| Reduced motion | (no motion) | open and close in 1 frame; the close's scroll is applied at once | the same |

- A short About ("Lantern Season", 4 lines) shows whole, with no arrow and no clamp. The tags start 16 px under it.
- The owner's shot 01 complaint does not occur after the fix: no empty band beside the folded text, whatever the tag
  count.
- lb-bot's About on the not-owned album: 5 lines shown of 26, 0 sliced, folded at 119.3 px. Open and close are in motion
  (122 and 93 painted frames). Closing at the page's bottom moves scrollTop only because the browser clamps it to the
  shorter page.

### 2. The gaps box through its stages (Review Focus 2, B-244)

Undertow at 1440, private fake. The figure is the largest single-frame step of the box's outer height.

| Change | Before | After |
|---|---|---|
| T1 folded > tracks | 58.5 px in one frame | 17.8 px; 49 frames; last step 0.5 |
| T2 tracks > folded | -66 px in one frame | -10.5 px; last step -0.5 |
| T3 Fill gaps > sources | outer 29.9, but the visible surface jumps 578 | the surface is the tweening element, 51.6 (the inner view swaps inside its clip) |
| T4 Request > active | -19.8 | -37.3, last step -0.5 |
| T5 active > done | goes through `absent`; -206 px in one frame | `done` directly; -25.4, last step -0.6 |
| T6 done > gone | -9.6 / -14.4 | -10.7, last step -0.5 |

### 3. Popular rating and heart (Review Focus 3, B-245, M4, M10)

- **Before:** Popular has a play-count column ("6") and no rating or heart.
- **After:** columns `28 40 396 84 32 52 32` px at 1440 (the number, cover, title, rating, heart, duration and menu).
  The controls are labelled with the song's name: "Rate Live Tagged 5 1 3 stars", "No rating for Live Tagged 5 1",
  "Remove Live Tagged 5 1 from Favorites".
- **Keyboard, Space on the 3-star input:** the rating becomes 3. Focus stays on that input at +150 ms and +1.6 s. The bar
  (holding the same song, paused) shows 3.
- **Keyboard, Enter on the heart:** the song is un-favourited. Focus stays on the heart at +150 ms and +1.6 s. The bar's
  heart empties. Popular keeps its row in place (1 row before and after).
- **The album page** ("Go to Album" from the row's menu, album "Live Tagged 5"): the song's row shows the heart empty.
  Its table has no rating column on this stand-in, so the rating could not be seen there.
- **Not seen:** the Library list was not checked.
- **The album table's heart by keyboard** (Hits Flag 4, Enter twice): focus stays on the button on both builds, so
  Chromium did not drop focus from the transiently disabled heart. The table has no rating column here, so the table half
  of M4 was not exercised.
- **A stand-in fact:** on this server, a song leaves Popular "Everyone" once it is un-favourited. This shows on the next
  arrival, never under the pointer.

### 4. Favourite songs removed, old settings (Review Focus 4, B-246)

| | Before | After |
|---|---|---|
| Sections on "The Long Players" | popular, favorite-songs, about | popular, about (Discography between them) |

The old-settings check:

1. Copied the after profile.
2. Wrote the old shape into its stored settings: version 41, `artistItems` = favoriteSongs (on, first), similarArtists
   (off), topSongs, biography, recentAlbums.
3. Reloaded.

On reload the store migrated to version 42. The result was `similarArtists` (still off), `topSongs`, `biography`,
`recentAlbums`, in that order. The artist page showed Popular, Discography and About: no Favourite songs, no Related
artists (still switched off), no error page, no console errors.

### 5. The discography page (Review Focus 5, B-247, B-248, M9)

| Width | Artist page sections | Discography before (controls, tiles) | Discography after |
|---|---|---|---|
| 1440 (queue open) | 280–1032 | 248 to 248–1064 (the main's edges) | 280, 280–1032 |
| 1100 | 280–1008 | 248 to 248–1040 | 280, 280–1008 |
| 800 | 128–708 | 96 to 96–740 | 128, 128–708 |

- Hero buttons: before Play and Shuffle; after none.
- The title is 267 px wide with a scroll width of 267, so it is not truncated.
- The stand-in has no long artist name, so "a long name has the row" was not tested.
- **The band (M9):** it ended at 288 before and 282 after Task 4, against a hero ending at 224. Upstream's 200 px floor
  carried it 58 px across the search and chips row. After `79507ae0` it ends at 224 in both modes and at all three
  widths.
- At 1100 the side queue was in R14's folded rail form (main 248–1040), not the open panel. The panel open at 1100 was
  not walked.

### 6. The bands (B-237)

| | Mode | Before | After |
|---|---|---|---|
| Artist page | artist image | the shade ends at 418; hero 354; Popular's first row at 402 sits on the edge | stack, image and shade end at 354; Popular title 373 |
| Artist page | cover wash (artist image off, the owner's mode) | overlay ends at 418 | ends at 354 |
| Album page | both modes | 412 against a hero of 348 | 348 |
| 800 x 600 | | the artist's band ends at 472 against hero 408 and first row 456 | 408 |

- **R9's bar against the hero** (the R9 method: a shot at scroll 0 against a shot at scroll 420, 12 points in the bar's
  right part): the largest channel difference is 1 on the album and artist pages, in both modes, before and after.

### 7. Node counts and the push (R10's limit 356, ruling M5)

**M5:** "The Long Players", Popular on "Yours" (five rows), nothing hovered:

| | `main *` nodes |
|---|---|
| Unrated | 344–348 |
| Five rated, at `0ea3c6c0` | **524–528** (five Mantine Ratings, ~36 nodes each) |
| Five rated, after `064008fb` | **349** |

- Each rated row draws its stars as one masked element (1 node). It is the same 63 x 11 box as the xs Rating, so hovering
  moves nothing. The label reads "Live Plain 2 1, rated 3 stars".
- Pixel compare of the one element against the real stars (4x zoom): mean channel difference 8.6. The visible
  difference is the 0.5 px foreground rim Mantine draws round a filled star, which the mask does not.

**Album > artist push**, clicking the hero's artist link and back by the app's back button, 10 rounds after a warm-up,
1440 x 900, frames forced. These are medians:

| | TaskDuration | Script | Style | Layout | ttc (poll) | `main *` nodes |
|---|---|---|---|---|---|---|
| Before (Popular "Everyone", 1 row) | 1512 ms | 155 | 260 | 20 | 183 ms | 283 |
| After (the same) | 511 ms | 139 | 98 | 22 | 197 ms | 264 |
| After, Popular "Yours" (5 rows, unrated) | 582 ms | 172 | 114 | 37 | 289 ms | 344 |

TaskDuration is not comparable to R10's numbers: frames are forced and uncapped, and the two profiles differ (queue,
playing song). Only the before/after pair from one boot means anything.

## Not verified

- The owner's GPU and library: this is the VM and a generated stand-in library with one cover for every album.
- Frame smoothness: the session was locked.
- A Popular edit reaching the Library list; the album table's rating column (absent on this stand-in's album table).
- The discography page at 1100 with the side queue's panel open (it was the folded rail).
- An artist with a name long enough to fill the discography row.
- The R10 push on the owner's machine.

## Notes for the owner

- **M2:** the About now folds at 5 lines on every page.
  - The artist page used to show about 7 lines folded (124 px of 18 px lines); it now folds shorter, at 90 px.
  - lb-bot's About on the not-owned album page (it used to show 360 px) and on the `mb:` artist page (180 px) folds at the
    same 5 lines.
  - A text of 5 lines or fewer shows whole with no arrow.
- **M8:** B-246 deleted upstream lines: the `version <= 23` settings migration block, `ArtistItem.FAVORITE_SONGS`, its zod
  value and the settings row. The next upstream merge that touches them will conflict there.
  - The upstream full "favourite songs" route (its route, headers and sort slice) was kept, unlinked.
- **The close rule (M3 follow-up):**
  - If the arrow stays on screen through the close, nothing scrolls.
  - If it would rise past the bar, the About's section (label first) settles 8 px under the bar with the fold, and the
    folded lines are what shows.
- **The new constants and fallbacks:**
  - The one-element stars use Mantine's rating yellow (`--mantine-color-yellow-5`, which the Rating resolved to here).
  - A hero band's floor is gone. The bar's band (with its 64 px tail) and an unmeasured band keep upstream's 200 px floor.
