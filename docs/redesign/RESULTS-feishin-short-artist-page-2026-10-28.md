# Results: R2, the short artist page

Plan: `PLAN-feishin-short-artist-page-2026-10-28.md` (outside the repo, in the umbrella's `navi-connect/`). Branch
`fix/short-artist-page-2026-10-28`, local only, never pushed. Written 2026-10-28 on the workstation. This note has two halves.
The first half (this commit) is the gates. The second half, "Watched running on the VM", is Task 6, written after the walk.

**Base.** Cut from `fix/colour-ease-2026-10-27` at `2302d69a` (R1, what the owner runs). The branch has six commits on top.

| Commit | What |
|---|---|
| `64ad3a60` | The shelves core: `popularReleases`, `kindLines`, `ownedPlayIds`, pure, in `features/discography/artist-shelves.ts` |
| `21139c0c` | `LibraryHeader` gets an opt-in `hero` size (image, roundness, title size as CSS variables) |
| `5f4daec2` | Fix round for it: title tracking, kicker weight, square 8 px corner |
| `277a5ce9` | The discography on its own page, under a compact hero header |
| `4a6c4fd8` | One play model for both routes; fixes B-212 |
| `f097fde5` | The short artist page: Popular releases, a line per kind, the board's header and action row |

## What changed

- The owned artist page no longer mounts the whole discography. It shows one line of Popular releases and one line per release
  kind. Each line has a link to the full discography. Popular releases follow Navic's rule: most played first, then newest, then
  syncing, then missing albums.
- The full discography (filters, ownership, sort, Rescan, scan bar, MusicBrainz menu) moved, unchanged, to its own route
  `.../discography`, under a compact header whose title links back to the artist. The Rescan and MusicBrainz menu now live only there.
- The artist header follows the design board: a round 168 px image, a 54 px title, a kicker, a meta line, and a labelled action row
  (Play, Shuffle, Artist radio, View all tracks, then rating, favourite and more). The row is a shared `HeroActions` component, so the
  album page (R3) can reuse it.
- Play and Shuffle on the artist page queue all owned albums, newest first. On the discography page they queue the filtered view.
- B-212 is fixed in code: the "this artist's songs only" filter compares against the route id, so `/library/artists/:artistId` no
  longer filters every song out. It is read, not run yet.
- `kindSettings` is one mapping shared by the artist page's lines and the discography's sections. `getItemsPerRow` and
  `TILE_BREAKPOINTS` are exported from `discography.tsx` with no behaviour change.

## Gates

Run on the finished branch at `f097fde5` (before this note's commit).

| Gate | Command | Result |
|---|---|---|
| Web build | `pnpm build:web` | exit 0 |
| Remote build | `pnpm build:remote` | exit 0 |
| tsc, renderer | `tsc --noEmit -p tsconfig.web.json --composite false`, TS6307 filtered | no output |
| tsc, main | `tsc --noEmit -p tsconfig.node.json --composite false`, TS6307 filtered | no output |
| eslint | `--max-warnings=0` over the 17 changed ts/tsx files | exit 0 |
| stylelint | `--max-warnings=0` over the 4 changed CSS files | exit 0 |
| Harnesses | `node --test $(git ls-files 'src/**/*.harness.ts')` | 72 files, 963 pass, 0 fail |
| Em dash | added lines in `2302d69a..HEAD` | 0 |

| Harness count | Files | Pass | Fail |
|---|---|---|---|
| Base `2302d69a` | 70 | 951 | 0 |
| Final | 72 | 963 | 0 |

The 12 new cases: 7 in `artist-shelves.harness.ts` (Task 1), 3 in `library-header-hero.harness.ts` (Task 2), 2 in
`discography-model.harness.ts` (Task 4: `viewPlayIds`, `kindSettings`).

## Rulings

- Task 2: the hero title size lives in a pure module `hero-title-size.ts` (the harness cannot import through `/@/`).
- Task 2: a square hero image takes the board's 8 px radius. The board's Bricolage display font is not loaded; the font stays the
  user's setting.
- Task 3: `usePlayArtistReleases` has no `items` argument, and `viewPlayIds` is exported for the discography page (Task 4 later moved
  it into `discography-model.ts`); the prefetch moved to `lbbot-discography-prefetch.tsx`; `titleTo` is an
  opt-in on `LibraryHeader`; the play and shuffle buttons are `PlayTextButton` and `WideShuffleButton`.
- Task 4: `HeroActions` is shared (an amendment to the plan, so R3 does not write a second copy).
- Task 4: `getItemsPerRow` exported rather than copied; `TILE_BREAKPOINTS` exported with it.
- Task 4: the server id is a local `serverId` in the hook, because eslint's React Compiler rule forbids `server?.id` in deps.
- Task 4: B-212 is fixed in the hook, not left for later.
- Task 4: `HeroAction.icon` is typed `AppIconSelection`; the hook lost its unused `albumArtistId`.
- Bookkeeping: the branch is recorded as S-072, not the plan's S-071.

## Deferred minors

- Harness lacks cases for the null-year tie-break, missing/syncing ordering with two or more items, and `ownedPlayIds` skipping a
  null `albumId`.
- `noHeroWithoutProp` guards only the class call sites, not the gated style variables. No narrow-width rule for the hero row (R6).
- The discography page has no background-image branch (artist background setting). Scroll restore after the filter's replace writes
  is unchecked.
- `HeroActions` More button has no aria-label. `buildItems` runs twice (header and shelves). `sectionsOf` ranks with `indexOf`.
  Nothing renders before `cq.isCalculated`.

## Review Focus: where each item is answered

| # | Item | Answered |
|---|---|---|
| 1 | Artist lb-bot never scanned, or lb-bot absent | The model half: harness case `fromLibraryOnlyHasNoMissing` (passes). The walk: no empty headings and no pills on "Ida Verrall" (never scanned) or "Кино" (unknown to lb-bot). |
| 2 | One or two releases | The model half: `seeAllOnlyWhenMore` (passes): a kind line's "See all" shows only when the kind has more than one row. "See discography" is on the page always, for an artist with one or two releases too, and also when there is nothing to show at all (Task 4 report, choice 6). The walk saw it on artists with one release (see "Watched running on the VM"). |
| 3 | Play and Shuffle play all owned, newest first | The model half: `playIdsDefaultView` (passes), `viewPlayIds` for the discography page. The walk: 62 owned albums newest first under both routes (B-212 fixed), the Live filter queues the 12 Live albums. |
| 4 | Back restores the artist page's scroll; filters stay in the URL | The walk: Back returns to 900 px on the artist page and 1500 px on the discography with its chip; the chip writes with `replace`. |
| 5 | Narrow window: two tiles per line, headings do not wrap, buttons wrap | The walk: 2 tiles per line, headings on one line, the action row wraps, no overflow at both sizes. The hero itself is squashed (see the bug). |

Not verified by this half: nothing here was seen rendering. The B-212 fix, the 54 px title and 168 px circle as computed, the meta
line wording with real data and the first tile's top against the base are all for the walk.

## Before: the base on the VM (production build, 1440 x 900 emulated, dpr 1)

Frame numbers from that run are invalid (the VM session was locked, so the window ran at about 2 fps). Only the frame-independent
numbers are quoted. Source: `.superpowers/sdd/PLAN-feishin-short-artist-page-2026-10-28/vm-baseline.md`.

| Metric (album to artist push, median) | Before (`2302d69a`) | After (`0bfade5e`) |
|---|---|---|
| TaskDuration ms | 933 (run.mjs 1143) | 329 (run.mjs 436) |
| First tile ready, polled, ms | 657 | 248 |
| DOM nodes in main | 5304 | 847 |
| Release tiles in main | 320 | 36 |
| First tile top, px | 721.7 | 177 (header squashed, see below); 345 with the header at its drawn height |
| Header image, px | 225, radius 5 | 168, radius 50 % |
| Artist name h1, px | 33.96 | 54 |

## Watched running on the VM

Walked 2026-10-28 on the sandbox VM, the clone `~/src/feishin-repair` switched to `fix/short-artist-page-2026-10-28` at
`0bfade5e` (the branch went to the VM clone by `git push`; it has no public remote). Numbers came from the production build
(CDP 9223, profile `cfgprod`); the checks below were watched in the dev app (CDP 9222). Viewport 1440 x 900 unless named, a CDP
emulation at dpr 1 as for the base. Screenshots are in `.superpowers/sdd/PLAN-feishin-short-artist-page-2026-10-28/`, named
`repair-r2-*.png`; each was read back and the region named here was sampled.

### Bug found: the hero header is squashed to its padding

- On the artist page the hero header's box is 46 px tall (its 28 + 18 px padding). The image (168 px) and the title block sit on its
  bottom edge and overflow upwards, above the scroll area's top. At scroll 0 the image top is at -58 px and the h1 top at -38 px.
  Only the lower half of the action row shows. The image, kicker, title and meta line cannot be reached by scrolling.
- Cause, read from computed styles: `LibraryContainer` is a flex column with `height: 100%`. The hero rule sets `min-height: 0` on
  the header (`library-header.module.css`, `.library-header.hero`), and the header's `flex-shrink` is 1, so the column shrinks it to
  its padding. The base was safe because its header had `min-height: 340px`.
- The discography page has the same fault: its 96 px hero is in a 46 px box, image top 14 px, title top 40 px (main starts at 82),
  so the title link back to the artist is hidden too.
- Shots: `repair-r2-A-artist-top.png` and the production `repair-r2-after-artist.png` (circle centre pixel (360, 194) is the
  Popular tile's blue, the h1 band 470..890 x 135..180 has 0 % white). `repair-r2-A-artist-top-diag.png` is the same page with
  a diagnostic style tag injected through CDP (`flex-shrink: 0` on the hero, removed straight after; no code changed): the header
  is then 214 px tall, the circle centre is white (255, 255, 255), the h1 band is 37 % white, and the page looks as the board draws it.
- The fix is for the implementer (one CSS line, likely `flex-shrink: 0` on the hero, or dropping its `min-height: 0`). The header
  checks below were read from computed styles, and the look from the diagnostic shots.

**After the fix (`af9d7a80`, dev app, 1440 x 900 emulated, VM numbers).** `flex-shrink: 0` on the hero rule restores the header. Before: header box 46 px, image top -58 px, h1 top -38 px on the artist page. After: header box 214 px (top 82), image 168 x 168 circle at top 110 (fully visible), h1 54 px, first release tile top 345 px, as the board draws it. The discography page's compact hero is now 142 px tall with its 96 px image at top 110 and a 34 px title, the first tile at 408 px. Screenshots `repair-r2-fix-artist.png` and `repair-r2-fix-discography.png` were read back; the image region (x 280..440, y 115..270) differs from the page background in 374 of 400 sampled points on the artist page and 400 of 400 on the discography page. The discography Play and Shuffle buttons now carry `aria-label` "Play" and "Shuffle".

### The artist page, "The Long Players" (62 owned, 320 releases)

- Header, computed: image 168 x 168, `border-radius: 50%`; title h1 54 px, weight 800, line-height 54 px; kicker "ARTIST" 12 px,
  weight 800; meta line "62 songs in your library · 62 of 320 releases" (no genres: the stand-in artist has none).
- Action row: Play (round, 52 px, `aria-label` "Play"), Shuffle, Artist radio, View all tracks (a link to the songs page), then
  rating, favourite (`aria-label` "Add to Favorites") and More. **More has no accessible name** (no `aria-label`, no text, no
  title). The Task 4 review asked for one; still open.
- Lines, in this order: Popular releases (4 tiles, all Owned: Live Plain 2, Live Plain 1, Score 4, Hits Flag 8, with "See
  discography" on the right), then Albums 44, Compilations 80, EPs 26, Live 80, Other 20, Remixes 10, Singles 40, Soundtracks 20,
  each one row of 4 tiles with "See all". 36 tiles, 847 nodes in `main`. The kind lines run in alphabetical order here, while the
  discography's chips run Albums, EPs, Singles, Compilations, Live, Soundtracks, Remixes, Other. Both come from settings; not judged.
- "See all" on Albums opened `.../discography?type=album` with the Albums chip pressed (`aria-pressed=true`, the others false), 44
  tiles (`repair-r2-B-discography-albums.png`; Albums chip mean colour (57, 100, 142) against All's (76, 94, 110)).

### The discography page

- The MusicBrainz menu and Rescan live there only. The menu icon (tooltip "MusicBrainz match", no accessible name, unchanged from
  F7) opened with one item, "Refresh About"; "Wrong artist?" needs a hub with overrides, which the scratch hub does not offer
  (`repair-r2-C-mb-menu.png`).
- Rescan with the fake's `scan=slow`: the button turned to "Scanning discography", the progress bar ran and the line read "Looking
  up every release on MusicBrainz. This can take a minute..." for the 4 s watched; the fake counted one `POST discography`. The scan
  later finished: "Scanned today", All 321 and Compilations 81 on both pages (the fake adds a release). Shot
  `repair-r2-C-rescan-slow.png`, progress strip 500..885 x 211..216 mean (132, 187, 219) against (47, 73, 98) left of it.
  The fake was put back to `scan=ok`.
- Play on the discography page with the Live chip queued 12 songs, all 12 Live albums, newest first (Live Tagged 6, Live Plain 2,
  Live Plain 4, Live Tagged 5). Its Play and Shuffle buttons have no accessible name either (icon only).

### Back and scroll

- Artist page scrolled to 900, "See all" on Live, the EPs chip (the URL became `?type=ep` by `replace`), Back: the artist page at
  900. Back again: the album page.
- Discography with the Live chip, scrolled to 1500, an owned album opened, Back: the discography at 1500 with Live still pressed.
- Caveat: the walk entered pages by setting `location.hash`, which the hash router sees as a POP with the key "default", so a page
  entered that way can come back at an older offset. That is a walk artefact, not the app (the persist hook restores on POP only);
  it is why some shots arrive scrolled.

### Artists with one release, and lb-bot not knowing the artist

- "Ida Verrall" (one owned album, lb-bot has never scanned her): meta "11 songs in your library" with no release count; Popular
  releases with 1 tile and "See discography"; "Albums 1" with no "See all"; no pills, no missing tiles, no empty headings. Visiting
  did not start a scan (the fake's `POST discography` count stayed at 1). Shot `repair-r2-E-ida-verrall-diag.png`.
- "Кино" (one album, not in the fake lb-bot's index at all): meta "1 song in your library"; Popular releases 1 tile with "See
  discography"; "Albums 1" with no "See all"; no pills. Same for "Aeae Moash", "Aedra Talurn" and "Aeglasszencot".
- "Aeae" (one owned, the fake knows 5 releases): "1 song in your library · 1 of 5 releases", Popular shows the owned EP then three
  "Added, syncing" releases; "Albums 5" with "See all".
- On a one-release artist the same album shows twice, under Popular releases and under Albums 1. Expected from the rule; noted only.

### Play, Shuffle, Artist radio, B-212

Played locally only: the hub's active device was this Feishin (`5f23b560`, a computer) every time, never a `cast-*` device. Each
Play that replaced a queue asked "Discard the current queue?" first, and was confirmed. Stand-in tracks are 2 s long, so the playing
song had moved on by the time the queue was read; the queue order is what was checked. Paused after each.

- Play on `#/library/album-artists/<id>`: 62 songs from 62 albums, newest first: Live Tagged 6 (2017), Hits Type 1 (2015),
  Extended 5, Hits Flag 5, Live Plain 2 (2014), Hits Both 2. That is Navidrome's own list sorted by year, newest first. Every song
  is by the artist.
- Shuffle: the same 62 songs in a shuffled order (Studio 9, Hits Flag 6, Hits Type 4, ...).
- **B-212**, Play on `#/library/artists/<id>` with an empty queue: 62 songs from 62 albums, same order, every one by the artist. The
  fix works under that route. The page there also shows its 9 lines.
- Artist radio: 21 songs, starting Live Plain 2, Live Plain 1, Hits Flag 8, Score 4. Its busy state was too short to see.

### Narrow windows (Review Focus 5)

- 1100 x 700 with the queue open (main 476 px, queue 360 px): 2 tiles per line, every heading on one line, "See all" on the heading's
  row, nothing past main's right edge. The action row wraps onto several lines. `repair-r2-K-1100x700-queue.png` (and `-diag`).
- 800 x 600, queue closed (main 492 px): the same, 2 tiles per line, headings on one line, no overflow. With the header at its drawn
  height (`repair-r2-K-800x600-diag.png`) the 168 px image and the info column stay side by side, so the title wraps to two lines
  and the image sits beside the bottom of the button stack; R6 owns the narrow hero.
- At both widths the About, Members and External links column comes before Popular releases. That is the content's column order,
  unchanged by R2; not compared with the base.

### Artist background setting

- `artistBackground` is on in this profile (blur 6). The artist page draws the background image layer (a `getCoverArt` URL); the
  discography page draws only the overlay, no image. Shots `repair-r2-J-bg-artist.png` and `repair-r2-J-bg-discography.png`:
  the band 950..1370 x 90..130 has mean (84, 104, 134) on the artist page and (51, 61, 78) on the discography. With the stand-in's
  placeholder image the difference is a lighter wash, not a picture. A deferred minor, confirmed.

### Seen on the way, not R2's

- Calling the player store's `clearQueue()` straight after playing crashes the whole app ("Too many re-renders" in `<BaseImage>`,
  caught by the root boundary). It happened on the album page as well as the artist page, so it is not this branch's code. It was
  triggered from CDP, not from the queue's Clear button, and the base was not tried. A reload recovers.

## VM numbers (not the owner's GPU)

VM, production build, nested VM with VirGL on the NAS's UHD 630, same boot as the base (up since 2026-10-22 15:43), same scenario,
same count. **The VM's GNOME session was locked** (`LockedHint=yes` at the start and the end), so the window ran at about 2 fps and
**all 20 rounds are `valid: false`** (10 of 10 artist-push, 10 of 10 run.mjs `album->artist`), before and after alike. Frame numbers
(dropped frames, worst frame, rAF time to content) are therefore not measured, and their comparison moves to the workstation walk.
The frame-independent numbers below compare. Raw lines: `repair-r2-artist-push.jsonl`, `repair-r2-runmjs-push.jsonl` beside the
base's files in the plan workspace.

`artist-push.mjs`, album page to the artist page, 1 warm-up and 10 measured rounds, `main [data-release]` count 0 before each push,
`innerWidth 1440, innerHeight 900, devicePixelRatio 1` in every round. Median [min, max].

| Metric | Before `2302d69a` | After `0bfade5e` | After / before |
|---|---|---|---|
| TaskDuration ms | 933.5 [780, 1353] | 329 [274, 459] | 35 % |
| ScriptDuration ms | 535.5 [431, 769] | 191 [157, 266] | 36 % |
| RecalcStyleDuration ms | 154.5 [124, 213] | 33 [28, 54] | 21 % |
| LayoutDuration ms | 49.5 [40, 75] | 25 [19, 45] | 51 % |
| First tile ready, polled without rAF, ms | 657.5 [546, 1935] | 248 [201, 348] | 38 % |
| DOM nodes in `main` after arrival | 5304 [5304, 5304] | 847 [847, 847] | 16 % |
| Release tiles in `main` | 320 | 36 (4 popular + 8 lines x 4) | |
| First tile top px | 721.7 | 177 [177, 185] | header squashed |
| Dropped frames, worst frame, rAF ttc | not measured: session locked | not measured: session locked | |

`run.mjs` `album->artist` (10 rounds, marker "Hits Flag 8", which the new page shows in Popular releases): TaskDuration 1143
[936, 1450] before, 436 [394, 558] after (38 %); ScriptDuration 595.5 to 223; RecalcStyle 190 to 45.5; document `Nodes` 8634 to
2663.5. Its ttc is rAF-polled and lock-distorted (2930 before, 3067.5 after); not compared.

**VM acceptance: passed** on the frame-independent numbers. TaskDuration 35 % and DOM nodes 16 % of the base (limit 40 % each);
time to the first tile 248 ms against 657 ms (no worse). The squashed header does not change these much: it holds the same DOM, and
with it at its drawn height the page had the same tiles; only the first tile's top moves (to 345 px).

## Not verified

- Frame numbers of any kind (the VM session was locked), and so the R7 budget (dropped frames and worst frame near an ordinary
  push): for the workstation walk on the owner's GPU.
- The owner's library and real covers: the stand-in has one placeholder cover for every album and a star for the artist image, so
  the background wash and the round image were seen only with placeholders.
- The header as shipped: it is squashed (above). Its drawn look was seen only through the diagnostic style; the fixed CSS is not
  walked.
- The queue UI's own Clear button, and whether the `clearQueue()` crash exists on the base.
- Other locales (only `en` was seen; new strings exist only in `en.json`), and Windows and macOS title bars.
- Long-press on Play (none by design), keyboard focus order in the action row, and the artist page with lb-bot down.
