# Results: R10, the owned artist page laid out like Spotify's

Plan: `PLAN-feishin-artist-page-like-spotify-2026-10-28.md` (outside the repo, in the umbrella's `navi-connect/`). Branch
`fix/artist-page-like-spotify-2026-10-28`, local only, never pushed to GitHub. Written 2026-10-28 by the lane's fix agent,
after the review's fixes and the walk on the sandbox VM.

**Base.** Cut from R8's final tip `f4ec3482`, then rebased by the controller onto R9's final tip `03b81960` (clean). Fifteen
commits on top of R9: four by the implementer, eleven by the fix agent (the review's findings).

| Commit | What |
|---|---|
| `223b5158` | A compact track list of its own for Popular and the favourite songs (B-218) |
| `50a82353` | Discography as one header, one chip row and one row of tiles; Appears on its own row (B-219) |
| `496c8a59` | The page in Spotify's order, one column; lb-bot's Members and Related rows gone; Related artists last (B-217) |
| `f1ecfe17` | The lists read the playing song's id only |
| `67330ccf` | Review M1: Popular releases leaves out the kinds switched off in Settings |
| `29212800` | Review I1: the title is plain text, so a double-click plays instead of opening the album |
| `e110d1fc` | Review I2: a row drags its song to the queue or a playlist |
| `6a3f2837` | Review M3: a row takes focus, Enter plays from it, Enter on a control inside is kept from the page hotkey |
| `43cc616e` | Review M2: the biography waits for `getArtistInfo2` instead of swapping under the reader |
| `bb853ca7` | Review M4: an empty "Yours" or "Rating" list says so in one line |
| `0b5be47d` | Review M5: "Show all" under an unfolded list opens the full top-songs / favourite-songs page |
| `65f132a5` | Review M6: dead and duplicate strings removed |
| `8f7abca7` | Review M7: the chip row fades where chips are cut off |
| `788bb003` | Review M8: a comment corrected |
| `01b43fbc` | Review M9: the genre chips are a labelled group |

## What changed

- **One column in Spotify's order**: the hero and R9's bar, Popular, the favourite songs, Discography (chips and one row),
  Appears on, About, Related artists. The F7 side column is gone. lb-bot's Members and Related rows are gone; its links join
  About's links row.
- **Popular and the favourite songs** are a compact list of their own (`ArtistTrackList`): number (equaliser on the playing
  row, play button on hover), 40 px cover, title (second line with the other artists only when someone else is credited), the
  play count when above 0, duration, row menu. Five rows, "See more" ten, then "Show less" and "Show all" (the full page).
  Nothing is read from the Songs library's table settings. The Everyone / Yours and Favourite / Rating switches stay as two
  chips beside the title; an empty list under them says "No plays yet" / "No rated songs".
- **Discography**: "Popular releases", then one chip per release kind present in Settings' order (switched-off kinds left
  out, single and EP as one "Singles and EPs" chip), one row of tiles, the chip kept per history entry. Popular releases
  draws only from kinds that have a chip.
- **About**: Navidrome's biography (skeleton until `getArtistInfo2` settles, then its text, else `getArtist`'s; lb-bot's
  only when Navidrome has neither), genres as chips, the links row; collapsed to 124 px with the toggle when it overflows.
- **Settings' artist sections**: each switch still hides its section; **the order setting no longer reorders the page**
  (it has one order). The Settings control still drags.

## Gates

Run on the workstation at `01b43fbc` (the rebased tip).

| Gate | Command | Result |
|---|---|---|
| tsc, renderer and main | both configs, `--composite false`, TS6307 filtered | no output |
| eslint, stylelint | `--max-warnings=0` on each commit's changed files | exit 0 |
| Harnesses | `node --test $(git ls-files 'src/**/*.harness.ts')` | 84 files, 1058 pass, 0 fail (R9's 1045 + 13) |
| Web build | `pnpm build:web` | exit 0 |
| Remote build | `pnpm build:remote` | exit 0 |
| Production build on the VM | `pnpm build` in `~/src/feishin-r10`, at `03b81960` and at `01b43fbc` | exit 0, exit 0 |
| commitlint | `--from f4ec3482` (R9's commits and R10's) | exit 0 |
| Em dash | added lines | 0 |

## Watched running on the VM

Production builds, before = `03b81960` (R8 + R9), after = `01b43fbc`, in a worktree `~/src/feishin-r10` on a copied scratch
profile (fresh hub device id) on CDP 9250, against the stand-in Navidrome, the fake lb-bot and the scratch hub. Sizes are
CDP emulations at dpr 1. **The session was locked** (`LockedHint=yes`), so every run is `valid: false` and no frame number
(dropped frames, worst frame, rAF time to content) is quoted. These are VM numbers, not the owner's machine.

### The album to artist push (The Long Players, 62 owned, 320 releases in the fake lb-bot), 1440 x 900

`artist-push.mjs`, 10 rounds after a warm-up, median [min, max]:

| Metric | Before `03b81960` | After `01b43fbc` |
|---|---|---|
| TaskDuration ms | 480 [434, 505] | 308.5 [256, 326] |
| ScriptDuration ms | 228 [200, 241] | 154.5 [144, 177] |
| RecalcStyleDuration ms | 82 [78, 86] | 30 [27, 33] |
| LayoutDuration ms | 32 [30, 34] | 20.5 [17, 31] |
| First tile in the DOM, polled without rAF, ms | 327.5 [303, 346] | 174 [164, 183] |
| DOM nodes in `main` after arrival | 1231 | **356** (R2's limit 847) |
| Release tiles in `main` | 36 | 5 |
| First tile top px | 345 | 631 (Popular and the favourite songs now come first) |

`run.mjs push`, `album->artist` (10 rounds): TaskDuration 584 [509, 650] to 400.5 [368, 443]; ScriptDuration 243 to 166.5;
RecalcStyle 110 to 52.5; document `Nodes` 3261.5 to 2219.5. Its rAF-polled ttc is lock-distorted (3147.5 and 3138), not
compared. Raw lines: `vm/` in the lane's ledger folder.

### The page, top to bottom

Screenshots (ledger folder `shots/`): The Long Players and Ida Verrall (one album, never scanned by lb-bot) at 1440 x 900,
1100 x 700 with the queue, 800 x 600, before and after. Headings in page order, after, at 1440 x 900: Popular 233, Favorite
songs 357, Discography 478, About 861; page height 1119 (before 2865, with nine kind lines). Ida: Discography 230, About 613
(no Popular: the stand-in has no top songs for her). Neither stand-in artist has Appears on or similar artists, so those two
rows were not seen.

Read against the owner's Spotify shots (06 to 08): the Popular rows match 06 in order and columns (number, cover, title,
plays, duration, "See more" under the numbers); the Discography header, "Show all" at the right and the chip row match 07.
Differences, all by ruling: the second line shows only when another artist is credited (Spotify always prints it); the chips
have the app's 8 px radius, not Spotify's pills. The R9 hero band ends at about y 360 across Popular's first row (a colour
step behind the row), which is R9's band, not this lane's.

### Each review focus and finding, as seen

| What | Seen |
|---|---|
| Focus 1: the Songs library table with every column on (34 of 34; the profile already had 9) | Popular and the favourites laid out byte for byte the same (`snap-default.json` = `snap-cols.json`: columns `28px 40px 404px 120px 52px 32px`, one row each); the setting restored after |
| Focus 2: an artist with few releases | Ida: chips "Popular releases", "Albums" only, one tile, no empty header |
| Focus 3: narrow | Title column 720 px (1440), 380 (1100 with the queue open), 232 (800 x 600); the play count drops at a 496 px list (560 px viewport, title 280); at a 376 px list (440 viewport) the title keeps 176 px. The chip row scrolls sideways at 800 (scrollWidth 746 in 584) and never wraps |
| Focus 4: chips quickly, then Back | Four chip clicks back to back (Live, Albums, Compilations, Singles and EPs): one row of 5 tiles, all "Lost EP" / "Single", the last chip pressed. Live chosen, scrolled to 399 (the page's end), a tile opened, the app's Back button: Live pressed, scrollTop 399, same history key |
| Focus 5 and M2: a long HTML biography with a Last.fm anchor, and no text swap | This page's own responses rewritten through CDP Fetch: `getArtist` answering at once with a one-line text, `getArtistInfo2` 2.5 s late with six paragraphs and a "Read more on Last.fm" anchor. **Before**: the one-liner at 895 ms, replaced by the long text at 3393 ms (the swap). **After**: a skeleton from 887 ms, the long text at 3362 ms, the same at 10 s; the one-liner never painted. The anchor is stripped; the text collapses to 124 px of 422 and the toggle opens it to 422. A short About (Ida, 75 px) has no toggle |
| Fail-soft, lb-bot absent (the hub switched off in this profile, restored after) | No lb-bot wording or tile anywhere, no "Missing" tile, no "of 320 releases"; chips from Navidrome only (Long Players: five kind chips, not seven); About holds Settings' link icons only |
| I1, I2: drag a Popular row | A real CDP drag (intercepted `application/vnd.pdnd`): the row took `data-dragging`; onto the side queue's row the queue went 1 to 2 songs; onto the sidebar playlist "R1 colour walk" the Add to Playlist dialog opened with it chosen, ADD made it 30 to 31. Both removed again (queue 1, playlist 30) |
| M3: Enter on a focused row | A click on the row's duration focuses the `li`; Enter opened the app's "Discard the current queue?" confirmation (the play path); confirmed, the song played. Tab moves to the row's play button and Enter there plays too. No stand-in song on these artists has a second artist, so Enter on a second-line link was not tried |
| The playing row's equaliser (local) | The equaliser with `data-playing` on the row 336 ms (Enter) and 560 ms (play button) after the confirmation, back to still bars about 2 s later when the 1 s song ended |
| M4 | "Rating" with nothing rated: "No rated songs" under the switch. "No plays yet" was not reachable (Yours has plays) |
| M5 | Yours: 5 rows and "See more"; 10 rows with "Show less" and "Show all"; "Show all" opened `/top-songs` ("Top songs from The Long Players"); Back returned with the chip kept and the list folded again |
| M7: the chip row's edges at 800 x 600 | At scrollLeft 0 the trailing 32 px fade (last chip partly faded), at the end the leading one (first chip faded, trailing edge clear), from the row's scroll timeline; at 1440 the row fits and the trailing mask lies over empty space |

## Watched, against reasoned

- **Watched**: everything in the two tables above.
- **Reasoned, not watched**: the equaliser while another device plays (it follows the hub's now-playing id, read in code);
  Enter on a second-line artist link (the same row handler as the play button, which was watched); "No plays yet" (the same
  path as "No rated songs"); Appears on and Related artists (no stand-in data); the Discography row arriving once per history
  entry (R4's mechanism, unchanged).

## Not verified

- The owner's GPU, display and library (frames were not measured at all: the VM session was locked).
- That Settings' artist-section order no longer reorders the page: by design, said here; the control still drags.
- Review M10, left by ruling: the favourites header shows five skeleton rows while loading, then disappears for an artist
  with no favourites, which moves Discography up.
- The M2 cost: in production react-query retries a failing query three times, so a failing `getArtistInfo2` holds the
  biography skeleton for several seconds before `getArtist`'s text shows.
- B-230 (Back then a late scroll jump on the artist page): the Back test here ended at the page's maximum scroll, so it can
  neither show nor rule out that jump.

## Notes from the walk

- The app asks "Discard the current queue?" before a list replaces the queue; the walk confirmed it each time. Playing on the
  VM replaced the scratch hub's session queue (R8's 41-song scratch queue) with one song; that queue is still in the hub's
  saved queues.
- At 1440 x 900 the sidebar's Playlists section is squashed to about 20 px, so its playlist cannot be reached or dropped on;
  the drag test ran at 1440 x 1200. Same before and after (filed as a backlog line).
- Popular's covers come from `getTopSongs` and showed the placeholder on the stand-in, while the favourites' (native API)
  showed the album art for the same song.
