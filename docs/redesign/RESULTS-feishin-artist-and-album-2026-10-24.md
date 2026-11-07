# Results: F7, the artist and album pages

Plan: `PLAN-feishin-artist-and-album-2026-10-24.md` (outside the repo, with `PLAN-feishin-redesign-INDEX-2026-10-20.md` and the nine
boards' source). Branch `redesign/artist-and-album`, local only, not pushed, not merged. Written 2026-10-25 on the sandbox VM.

**Base.** The plan says to cut from F5 (`636afd2a`, since F5 is not in `origin/feat/redesign`) and not from F6. **At the owner's word
in the session ("cut it from F6 instead") the branch was cut from F6's tip, `redesign/library` at `845422ee`**, which contains F5. So
the branch carries F6 (settings v39, the Library frame) and merges after it; this plan adds no persisted setting and no migration.

**Where it was built.** The sandbox VM, against stand-ins only. Nothing was sent to the real hub, the real lb-bot or MusicBrainz.

- **Navidrome:** a real Navidrome 0.64.2 binary on this machine, F6's generated library plus four F7 artists written by
  `gen_library.py --artists-f7` with real `musicbrainz_releasegroupid`, `releasetype` and `compilation` tags: *Hollow Orchard* (the
  board's artist: 4 owned, one 9 of 12), *The Long Players* (62 owned: 14 studio, 6 EPs, 20 compilations of which 8 are tagged by
  Navidrome's flag only, 8 by `releasetype=compilation` only and 4 by both, 12 live of which 6 are tagged `album;live` and 6 plain
  `album`, 10 soundtracks), *Ida Verrall* (one album, never scanned). Plays were seeded through Subsonic `scrobble`.
- **lb-bot:** a fake lb-bot behind a **scratch hub** (the umbrella's own `hub.py`, own token and state file, loopback). F6's routes plus
  the F7 ones: the discography read and scan start with a scan record (`scan=ok|slow|fail|mbdown|restart`), meta, editions,
  tracklist, similar artists, sources (`ok|empty|502|slow`, delay settable), download, status, fills, cancel, allow-MP3, wishlist,
  and a scripted fill (`ok|no_source|transfer_failed|format_rejected|placement_failed|cancel_late`). A finished scan or a landed
  fill bumps the change feed and POSTs `/lb/index` to the scratch hub, so the app's mirror moves by the real path. A fill that ends
  `ok` writes the album into the stand-in library and rescans Navidrome, so the redirect to the owned album is real. Its 320-release
  index for *The Long Players* has 258 missing rows across every kind. The not-owned artist is **"Paper Kiosk"**, not the plan's
  "Kiosk": F6's library already owns an artist named Kiosk. A second not-owned artist, *Quiet Annex*, is never scanned.
- **The app:** `electron-vite dev` on a scratch profile (`XDG_CONFIG_HOME` pointed at a copy), driven over CDP; once the production
  build (`electron-vite build`, Electron on `out/`) for the timings. Frames are this VM's (software / VM GPU): quoted for shape and
  order, never as the owner's speed.

| Commit | Task |
|---|---|
| `6e71db35` | 2. The discography's pure core, one kind rule for owned and missing albums |
| `91a01945` | 3. The artist discography filters by release type and ownership, per page (B-165) |
| `cd3599e0` | 4. A visible Rescan with the states a scan really has |
| `4c888820` | 5. The artist page in two columns, owned and not owned |
| `56c3a285` | 6. The not-owned album page with its About first and Find sources (B-169) |
| `a0e8adc2` | 7. The request box folds with each step and becomes the recovery card |
| `4dd89e22` | Fix from the Task 8 sweep: the failed state and the chip count readable in every theme |
| `6a2e8a64` | 8. This note |
| `3893f2a0` | Fixes from the review (below) |
| (last) | The review appended to this note |

Task 1 changed nothing in the repo (stand-ins and the baseline, below).

## Gates

| Check | Baseline (`845422ee`) | Final |
|---|---|---|
| `tsc -p tsconfig.web.json` (TS6307 filtered) | clean | clean |
| `tsc -p tsconfig.node.json` | clean | clean |
| eslint `--max-warnings=0`, every changed TS/TSX file (47) | - | clean |
| stylelint `--max-warnings=0`, every changed CSS file (11) | - | clean |
| `vite build --config web.vite.config.ts` / `remote.vite.config.ts` | - | exit 0 / exit 0 (after Tasks 5, 6 and 7) |
| `electron-vite build` (for the production timing) | - | exit 0, 62 s |
| The harnesses | 60 files, 878 pass, 0 fail | 67 files, 935 pass, 0 fail (932 before the review) |
| `release-kind.harness.ts` (new) | - | 6 pass |
| `discography-model.harness.ts` (new) | - | 24 pass (340 items built, filtered, sorted and cut in 1.2 ms) |
| `discography-view.harness.ts` (new) | - | 4 pass |
| `scan-phase.harness.ts` (new; one case added in Task 4, one from the review) | - | 12 pass |
| `request-stage.harness.ts` (new) | - | 5 pass |
| `album-page-state.harness.ts` (new) | - | 4 pass |
| `motion/grow.harness.ts` (new) | - | 2 pass |
| Em dash gate on added lines | - | nothing |
| `grep -rn setArtistReleaseTypeItems src/renderer` | the gear and Settings | Settings only |

Every new harness was seen failing first (`ERR_MODULE_NOT_FOUND`); the Task 4 case first as an assertion failure. Two rules were also
mutated to see their assertions go red (Live before Compilation in `releaseKindOf`; the task-id match in `scanPhase`) and restored.
`useFillActions` (Task 7) is delegation only, so it has no harness of its own.

## The baseline (Task 1, today's build at `845422ee`)

- **B-165 seen.** *The Long Players* in the default "primary" grouping: `Album 56 +179 missing`, `Broadcast 0 +5`, `EP 6 +20`,
  `Other 0 +4`, `Single 0 +50`; no Compilation, Live, Soundtrack or Remix section. The gear listed only Album, Broadcast, EP, Other,
  Single. Switching Single off in the gear wrote Settings' global list (`releaseTypeSingle` disabled) and *Hollow Orchard* then lost
  its Single section. "All release types" showed the combined keys and the split: 8 type-only compilations under "Album •
  Compilation", the 12 flagged ones under "Compilation", the 6 plain-tagged live albums under "Album" beside their missing siblings
  under "Album • Live".
- **B-169 seen.** A missing tile on *Paper Kiosk* and on *Hollow Orchard* opened a dialog with no About; the URL did not change. The
  page `/external/albums/:rgid` had About first, reachable from a tile by no click.
- **Rescan seen.** On *Ida Verrall* the scan was an icon inside a menu; started with `scan=slow`, left at 5 s, back at 22 s: no
  spinner while lb-bot still answered `running`.
- **Request seen.** After a transfer failure the dialog offered Back and Download; the Downloads page offered Retry, Try another
  source and Dismiss for the same row.
- **Call 13 re-proved on the scratch hub (the real `hub.py`).** The discography read, the scan POST, and a read 6 ms later: the hub
  answered the cached pre-scan `{"indexed": false}` with no `scan` while lb-bot said `running`. The index push at the scan's end
  dropped the cache (the next read had `scan: done` and 4 rows).

## Watched running

### The discography (Task 3), on *The Long Players* unless named

| What | Seen |
|---|---|
| Chips vs sections | All 320; Albums 44 (12 owned, 2 partly, 30 missing), EPs 26, Singles 40, Compilations 80, Live 80, Soundtracks 20, Remixes 10, Other 20; each chip's count equals its section's tiles |
| One kind rule | Compilations: all 20 owned (flag, type, both) with the 60 missing; Live: all 12 owned (6 tagged plain `album`, joined to lb-bot's live row) with the 68 missing |
| Filters | `?type=live` 80 releases; `?own=missing` 258, no owned tile; `?own=partly` the 2 partly-owned studio albums; Live + Partly: "Nothing matches Live + Partly owned." and Show all, which cleared the URL |
| Sort | Your plays: played owned first, then the rest by year; the direction flips the owned order only; Recently added; Year |
| Settings untouched | `artistReleaseTypeItems` byte-identical before and after the whole walk |
| Back | Back from an album restored `?type=live` and the scroll (1500 to 1496 px) |
| A kind off in Settings | Compilations started collapsed, "80 releases, collapsed", 0 tiles mounted; its chip opened it; its header opened it |
| Play (Call 4) | With Live, the queue held exactly the 12 owned live albums, newest first; unfiltered, 62 songs from 62 albums (after the app's existing "Discard the current queue?" confirmation) |
| lb-bot off (hub setting off) | *Hollow Orchard*: the 4 owned albums, chips from Navidrome's tags (Albums 3, EPs 1), no ownership filter, no pills, no scan control |
| Section fold | Closing an EP section 1620 to 854 px at 362 ms to 0 by 734 ms; opening 0 to 1620 px by 802 ms; the pressed header moved 0 px; reduced motion: one frame |
| Layout | No sideways document scroll at 800, 1100, 1280, 2560, queue closed and open; the bar wraps; at 800 with the queue open the shell leaves the page 176 px and only the library card's own title (in a 54 px tile) overflows its box |

### Rescan (Task 4)

| What | Seen |
|---|---|
| `scan=ok` on *Ida Verrall* | Find missing albums, then Scanning discography with the bar and ghost sections at once, the 3 missing rows in place at 6.1 s, Rescan discography / "Scanned today" at 15.2 s |
| Leave and return (`slow`) | Left at 5 s, back at 20 s: still Scanning, read from the record and the session's task id; finished while away: the rows there on return |
| `fail`, `mbdown` | lb-bot's sentence in the line with Retry scan, the tiles kept; seen about 53 s after the press (the cached read, Call 13's stated cost) |
| `restart` | The record vanished at 8 s; back to Rescan discography at 65.6 s, tiles kept, the poll stopped |
| Reload mid-scan | After a reload the page read "Not scanned yet" (the cached pre-scan answer, the session map gone) and stayed so while open; reopened about 95 s after the press it read `running` from lb-bot's record, then the result |
| Ghost to rows | First scan of *Quiet Annex*: the ghost's first tile at 739 px, the real one arrived at 747 and settled at 739 (its 8 px arrival) |
| Rescan | The first tile stayed at 1305 px from the press to the end (after the fix that keeps the status block's height) |
| Hub off | No control, no line |

### The artist pages (Task 5)

| What | Seen |
|---|---|
| Two columns | From a content width of 960 px: 1280 closed (972 px) 576 + 300; 1440 closed 736 + 300; 2560 1404 + 300; 1280 with the queue (656 px), 1100, 800: one column, About above the discography as before |
| Owned side column | About, Members (lb-bot), External links, in the owner's order; "Recent albums" off: no left column, the side takes 1068 px |
| Not-owned page | Plain hero: "ARTIST · NOT IN YOUR LIBRARY", the name, "6 releases, from MusicBrainz"; About, Similar artists (Hollow Orchard Owned, Quiet Annex and Low Tide Choir Not owned), Links |
| Long name | Wraps in its column (3 lines at 800 px), no sideways scroll |

### The not-owned album page and Find sources (Task 6)

| What | Seen |
|---|---|
| B-169 | A missing tile opens `/external/albums/<rgid>?artist=…&artistId=…&artistMbid=…&title=…&year=…`, no dialog |
| The page | "ALBUM · NOT IN YOUR LIBRARY", "Paper Kiosk · 2009 · 11 tracks · from MusicBrainz", Find sources; About on the left, the tracklist with its version and edition pickers on the right, Missing pills, the no-play line |
| The wait (`sources=slow`, 60 s) | "Searching" with 0:03 at 3 s; a second press ignored; Stop waiting back to idle; pressed again: a fresh wait, answered when lb-bot's original search ended (60.1 s); lb-bot ran **one** search |
| Leave and return | Left at 4 s, back at 31 s: the ranked answer on screen, Recommended (velvetcrate) selected, one search |
| Stop-waiting claim | Stop at 3 s, the search ended at 15 s, pressed again: the answer in 128 ms, one search. The line was changed to say only this |
| Empty / 502 | "No usable source found on Soulseek for this release." / lb-bot's sentence, each with Try again |
| No About (`meta=empty`, `404`) | "No description yet.", no error, the page works |
| Owned release-group | Redirected to the library album |
| No hints | The header filled from lb-bot's answer |
| lb-bot down | The not-reachable sentence, no spinner |

### The request box (Task 7)

| Fill | Seen in the box |
|---|---|
| `ok` | Searching, Downloading 0 to 8 of 8 with Source and Folder, "Added ... waiting for the library scan", then the redirect to the real album at 48 s |
| `transfer_failed` | The ring, Failed, "The download itself failed", lb-bot's sentence, "3 of 8 files had finished", Retry / Try another source / Dismiss; Try another source POSTed `excludeUsers: ["velvetcrate"]` and the box went back to active in place |
| `format_rejected` | Allow MP3 and retry / Try another source / Dismiss; Allow MP3 set the group opt-in and the retry went through |
| `no_source` | The wishlist explanation and button; added (POST wishlist), the row dismissed |
| `placement_failed` | "Downloaded, but couldn't be filed into the library", the sentence, "8 of 8 files had finished" |
| too-late cancel | lb-bot's placing state shown, with the app's existing "Too late to cancel" toast |
| Same buttons | The Downloads page showed the same buttons for each failed row; the box leaves out only Open album while it would open the same page |
| Reopened failure | The failed box at once |
| Another device | A fill started directly at the fake: read once, shown ("Downloading 2 of 11") |
| Two presses on Download | One POST (after the fix: a ref guard) |
| Grow | Searching to downloading 145 to 219 px over 300 ms; to the failure 219 to 184 px; the About column moves with it; reduced motion: one frame each |

### Timings and nodes (*The Long Players*, hub on, mirror loaded)

| What | Dev | Production build |
|---|---|---|
| Route to the first tile = all 8 sections | 1.7 to 1.9 s (3.1 s cold) | 620 to 650 ms (986 ms cold) |
| Live chip to painted | 230 ms | 182 ms |
| Collapse an 80-tile section, to unmounted | 650 to 680 ms (the 450 ms fold, then unmount) | 555 to 627 ms |
| Expand it, 80 tiles mounted and open | 467 ms | 136 ms |
| Discography nodes, all open / all collapsed | 5,085 (320 tiles) / 120 (0 tiles) | same |

The largest section here is 80 tiles; the plan's 150-tile case was not built.

### Contrast on rendered pixels

Text colour from the computed style through a canvas, background from screenshot pixels beside each glyph box; hues 40, 120, 250,
dark and light covers, and Cover colours off. Lowest per text after `4dd89e22`: chip 6.33, selected chip 5.0, chip count 5.0 (3.76
before), ownership chip 6.83, Rescan 6.85, scan line 6.57, section count 6.61, section name 11.34, Owned pill 5.0, 9 of 12 pill 13.74,
Failed pill on a cover 6.8, Missing pill on a cover 6.48, kicker 6.36, Not owned pill 6.61, side label 6.61, Failed pill in the box
6.9 (3.77 before), failure headline 8.04, lb-bot's sentence 8.38, box line 8.04, track Missing pill 6.61, no-play line 6.34. The
failed ring as a mark: 5.61 or better (1.71 to 2.69 before). Not measured: the running-fill pill (no fill was running; it shares the
syncing pill's style).

## Reasoned from code only (NOT VERIFIED)

- The owner's real library, real MusicBrainz types and real lb-bot answers; a real scan's length; the real hub's cache behaviour for
  the scan read (only the scratch hub, the real `hub.py`, was used).
- **What the fake invented** about lb-bot: the scan record's error sentences; `/lb/fills` answering `{"state": "unknown"}` for an
  unknown release; the fill's step timing, its `groupId` (`ag` + 8 of the rgid), its reasons and peers; that a group's allow-MP3
  makes the next retry accept MP3; the meta paragraphs, members and links; the editions, labels and track titles; the sources'
  fields; the wishlist's interval and cooldown. The client parses each through the existing normalizers, so a field the fake got
  wrong would show as missing, not crash.
- Windows and macOS; Jellyfin and Subsonic (the pages must not crash there; not run); the VM's frames as the owner's speed; light
  theme beyond the light cover washes; keyboard-only walks beyond the DOM order (hero, bar, sections, side column).
- The link-paste flow on the Downloads page starting a fill and then opening the album page (the other-device read covers the
  mechanism, not that flow).

## The fake's POSTs

Counted by the fake per run (it was restarted between runs, so these are the runs' own numbers): scans 1 per press in every scan run;
`album/sources` 1 for the Stop-and-press-again run and 1 for leave-and-return; `album/download` 1 per Download in each failure run plus
1 per Retry, Try another source and Allow MP3 (10 across the last two runs), `album/cancel` 1, `allow-mp3` 1, `wishlist` 1. The
two-press check: 2 POSTs before the guard, 1 after.

## Calls made beyond the plan

1. **The base is F6** (the owner's word), not F5.
2. **"Paper Kiosk"** stands in for "Kiosk" (F6's library already owns a Kiosk).
3. **The two columns start at 960 px**, not 1000: this shell gives the page 972 px at a 1280 px window, where the plan expects two.
4. **A lost scan rests**: a read made more than the hub's cache (60 s + 5) after the press, with no record of the session's task,
   means lb-bot lost it (Call 13 alone would spin for five minutes after an lb-bot restart).
5. **`placed` is the syncing stage.** The plan's interface says so; one harness line in the plan said "active"; syncing matches
   `describeFill`'s "Added ... waiting for the library scan".
6. **A section collapse folds** (brief 8) and still mounts nothing while collapsed (it unmounts once folded).
7. **A row naming a Navidrome album the page has not listed is owned**, not dropped, so a landed fill never vanishes before the album
   list refreshes.
8. **The section summary** shows the ownership breakdown only when more than one state is present, with the app's "·".
9. **The search** narrows what is shown but not the chip counts (one definition per count).
10. **The box hides Open album** while it would open the page you are on.
11. **The missing-album tile changed for every caller**: Statistics' unowned tiles now carry the same pill.
12. **Discover's top badge** is bounded to its cover (the pill no longer overflows a narrow tile).
13. **A fill from another device is adopted into the ledger**, so the app-root watcher follows it.
14. **GrowBox uses the Web Animations API**: a height set inside a ResizeObserver callback did not start a CSS transition here.
15. **No track times**: the tracklist route carries none, so none are drawn.
16. **The scan sentences** are English in the pure module (the copy table is the plan's); the rest is in `en.json`.
17. **The Stop-waiting line and the not-reachable line** say what was shown, not the plan's first wording.
18. **The failed red** is the error role mixed with the foreground role, for contrast.

## Found on the way

- The hub's scan POST does not drop the cached discography read (the plan's line; backlog).
- After an app reload mid-scan the page keeps "Not scanned yet" while open (no read outside a running scan); a slow re-read while
  the page is open would make the plan's "up to a minute late" true (backlog).
- At 800 px with the queue open the shell leaves an artist page 176 px, where the library card's title overflows a 54 px tile.
- `navi-connect/CLAUDE.md` §6 still says the discography gear writes the global list and the tile opens the dialog. Suggested
  replacement (this VM cannot edit the workstation's copy): "The artist discography (F7) filters per page in the URL; Settings'
  release-type list sets which kinds start collapsed. A missing tile opens `/external/albums/:rgid`, whose request box is the fill
  ledger's row."

## The review

One fresh whole-branch review ran (a separate agent, read-only, given the plan, the diff and this note, the plan's Review Focus as
its brief). Its findings, most severe first, and what was done:

| # | Finding | Ruling |
|---|---|---|
| 1 | A Find sources session never expired: reopening the page after its answer went stale started a live search nobody asked for, with the timer counting from the first press | **Fixed** (`3893f2a0`): a session expires with the answer's five-minute cache. Reasoned from code and the query settings, not watched (it needs five minutes of waiting per case) |
| 2 | A dismissed request came back: with no ledger row the box adopted any state lb-bot still reported, terminal ones included | **Fixed**: only a running fill is adopted. Watched: a failed box dismissed stayed gone 6 s later |
| 3 | A missing row whose fill had landed read Missing and offered Get again while the index caught up | **Fixed** in the pure core, with a harness case seen failing first |
| 4 | A link with no hints (a paste, Downloads' Open album) never redirected an owned album | **Fixed**: the redirect also uses the artist MBID `/lb/album/releases` names. Watched: a hint-less link to *Lantern Season* redirected to the library album |
| 5 | "Not scanned yet" and a filled Find missing albums showed while the discography read was still out, inviting a full walk of an indexed artist | **Fixed**: `scanPhase` takes `loading` (nothing said or offered), harness case seen failing first. The window is too short to watch here |
| 6 | A section collapsed by hand stayed collapsed when its own chip was pressed | **Fixed**. Watched: Live collapsed, then its chip: `live:false:80` |
| 7 | Two rows naming one Navidrome album drew it twice with one React key | **Fixed**, harness case seen failing first |
| 8 | `useIndexArtist`'s own 5 s interval (from before this branch) outlives the page and the page's phase | **Kept**: it is what pulls the mirror once a scan ends even after the page was left (Ruling R23, a lost `index` frame). It ends after its 60 attempts. Noted for a later tidy-up |
| 9 | Try again on a failed or empty search kept the old elapsed time | **Fixed**: the clock restarts |
| 10 | An unreadable tracklist showed only its heading | **Fixed**: "Could not read this release's tracklist." with Try again. Watched with `tracklist=502` |
| 11 | The owned page passed a new empty array each render while albums loaded | **Fixed**: a stable empty list |
| 12 | The scan start had no in-flight guard (two presses, two walks) | **Fixed**: a ref guard, as Download has. Reasoned, not watched |

After the fixes: both `tsc` clean, eslint clean, the harnesses 935 pass and 0 fail, both builds exit 0, no em dash added.
