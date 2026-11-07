# Results: F6, the Library

Plan: `PLAN-feishin-library-2026-10-22.md` (outside the repo, with `PLAN-feishin-redesign-INDEX-2026-10-20.md` and the three Library boards'
source). Branch `redesign/library`, local only. Written 2026-10-23/24 on the sandbox VM at the end of the branch.

**Base.** The plan's preflight wants F5 merged into `origin/feat/redesign`; it was not, so the branch was cut from F5's own tip,
`origin/redesign/home-and-motion` at `636afd2a` (its results commit), with its upstream unset. Merging F5 first and then this branch, or this
branch alone (it contains F5), gives the same tree.

**Where it was built.** Not the workstation: the sandbox VM (Ubuntu 24.04, GNOME on Wayland), where the plan's "Working here" real-stack parts do
not apply. There is no owner profile, no owner sign-in and no real hub here, so every run below is on a **scratch profile**
(`XDG_CONFIG_HOME` pointed at a scratchpad copy) against **stand-ins**, never the owner's server, hub or profile:

- **Navidrome:** a real Navidrome 0.64.2 binary on this machine with a generated library (2,999 album artists with diacritics, a CJK name,
  "AC/DC", "P!nk" and same-name pairs; 8,742 albums; 11,657 songs with bitrates from 96 to 1,411 kbps; 400 rated songs; seeded plays). A small
  proxy in front of it adds 20,000 synthetic artists in Navidrome's shape and slow and failing artist pages on request.
- **lb-bot:** a fake lb-bot behind a **scratch hub** (the umbrella's `hub.py` with its own token and state file), serving health, the index
  change feed (a mirror of 307 artists built from the stand-in's own Navidrome ids, some with incomplete rows) and the artist lookup with
  `ok | slow | 503 | 404 | empty | cooldown` modes and a "hold this term" switch.
- **Real MusicBrainz, once:** a GET-only relay to the real lb-bot (health and artist lookup only; every other route answered 404 by the relay),
  behind the scratch hub, for 15 lookups at least 3 s apart (Task 4).

One session ran the plan inline, Tasks 1 to 8 in order, one commit per task, plus one fix commit from the Task 8 contrast sweep (`49f150a4`) and
one from the review (`5f13253c`). One fresh whole-branch review ran (a separate agent, read-only); its findings, the fixes and the rulings are
appended at the end.

| Commit | Task |
|---|---|
| `2c7560ba` | 1. The pure core: fuzzy matching, the MusicBrainz query, the library model, the chip model, the column migration |
| `89cc2c0c` | 2. One Library frame with chips, and a single sidebar entry |
| `2930e48a` | 3. The Artists page, one field narrowing your artists instantly |
| `721a987c` | 4. Artists from MusicBrainz arrive under Not in your library |
| `30b6e159` | 5. Tracks gets Rating and Bitrate columns, a bitrate sort and Top rated |
| `ac7ba685` | 6. The other chips sit in the frame |
| `2cc426d0` | 7. Every old page keeps a way in |
| `49f150a4` | Fix from the Task 8 sweep: the sorted header stays readable without the cover wash |
| `5f13253c` | Fixes from the review: the partial artist list, the scroll on a new text or sort, the "still reading" lines, Top rated's sort |
| (last) | 8. This note: `test(library): record the library measurements` |

## Gates

| Check | Baseline (`636afd2a`) | Final |
|---|---|---|
| `tsc -p tsconfig.web.json` (TS6307 filtered) | clean | clean |
| `tsc -p tsconfig.node.json` | clean | clean |
| eslint `--max-warnings=0`, every changed TS/TSX file (60) | - | clean |
| stylelint `--max-warnings=0`, every changed CSS file (13) | - | clean |
| `vite build --config web.vite.config.ts` / `remote.vite.config.ts` | - | exit 0 / exit 0 (after Tasks 2, 5 and 7) |
| `electron-vite build` (for the production timing) | - | exit 0, 61 s |
| The harnesses | 54 files, 832 pass, 0 fail | 60 files, 878 pass, 0 fail (59 and 874 before the review) |
| `fuzzy-match.harness.ts` (new) | - | 13 pass |
| `mb-fuzzy-query.harness.ts` (new) | - | 8 pass |
| `library-model.harness.ts` (new) | - | 13 pass |
| `library-tabs.harness.ts` (new) | - | 6 pass |
| `song-columns-migration.harness.ts` (new) | - | 4 pass |
| `sidebar-groups.harness.ts` (rewritten in Task 2: the Library row is a leaf) | 17 pass | 15 pass |
| `library-artists-read.harness.ts` (new, the review: drives a real `QueryClient`) | - | 4 pass |

Harnesses run by hand with `node --test` on Node 24.21 (CI does not run them). Every new harness was seen failing first with
`ERR_MODULE_NOT_FOUND`. The baseline count was taken in a temporary worktree of `636afd2a` with this checkout's `node_modules` linked in (without
them one F4 harness cannot resolve `lodash`; that is the worktree, not the code). `package.json`, `pnpm-lock.yaml` and `pnpm-workspace.yaml` are
unchanged by the branch. The em dash gate (`git diff 636afd2a..HEAD -U0 | grep -nP '^\+.*\x{2014}'`) prints nothing.

## Watched running

`electron-vite dev` (and once the production build, below) on the VM's desktop, driven over CDP from small scripts in the session's scratchpad.
Frames come from this VM: they are quoted for shape and order, never as the owner's speed.

### The frame (Task 2)

| What | Seen |
|---|---|
| Chips | Artists, Albums, Tracks, a divider, Mixes, Playlists, Genres, Folders, Radio stations, More (Album artists, All artists, Favorites, Discover); each reachable by click and by keyboard; `aria-current="page"` on the chip of the page shown |
| Sidebar | one Library row (bookshelf glyph), selected on every frame route in the expanded sidebar, the rail and the mobile drawer |
| First visits with 250 ms latency (six chips) | the title and the chips were never missing in any frame; the title's top stayed at 107 px; the spinner only in the body |
| The slot | one 48 px line, filled or empty, so the title does not move when a page's controls arrive (it moved 7 px before that rule) |
| Chip change | `main[data-nav=tab]`: rise 8 px to 0 and fade, settled about 190 ms (`getAnimations()`: rise 200 ms, fade 180 ms); entering from Home pushes (18 px), Back from an album pops |
| Reduced motion (CDP emulation) | no rise, no fade, no row arrival, no ghost pulse (the `getAnimations()` list holds none of them) |
| Layout, queue closed | no document scroll at 500, 800, 1100, 1280 or 2560 wide |
| Under 760 px of window height | the h1 is not drawn and the slot shares the chip row: the Tracks table at 1100 x 700 measured 261 px with the title, 322 px without |
| 1440 x 900 with the queue open | the page is 816 px (the board's twin says 836); the slot never meets the title on any chip page |

### The Artists page (Task 3), 2,999 artists unless said

| What | Seen |
|---|---|
| Typos and exact names | "pale kiosc", "radioheed", "beetles" find Pale Kiosk, Radiohead, The Beatles, marked "found by fuzzy match"; "bjork" finds Björk; "ac/dc", "p!nk", "米津" exact; "a" only names starting with a |
| Ranking alone (dev handle) | about 1 ms per keystroke over 2,999 names (index 6 ms); 1 to 10 ms over 20,000 (index 20 ms) |
| 20,000 through the proxy, dev build | first rows at 336 ms, the whole list in 8.9 s |
| Sorts | A to Z, Plays and Releases; Plays and Releases match Navidrome's own counts at both ends |
| Scroll | scrolling fast mounts no new `[data-arrive]`; Back from an artist restores the text, the sort and the scroll (also text typed inside the 300 ms URL debounce) |
| Keys | Down from the field into the rows, Up back, Enter opens, Escape clears the text and a second Escape leaves the field; the list is one Tab stop; right-click is the album-artist menu |
| States | loading (five ghost rows, then 500, 1,500, 2,999 with "still reading your library"), a failed read, a failed later page (the line above the list, the rows held), an empty library, each with Retry where it fits; a refresh with text in the field: one steady state for 4 s |
| Favourite and rating from a row (stand-in only) | the cached list entry updated in place, no exception |

### Not in your library (Task 4)

| What | Seen (fake lb-bot behind the scratch hub) |
|---|---|
| ok | the ghost row "Looking up artists on MusicBrainz" under "from MusicBrainz, arriving", then the rows under their own heading; one request per settled term |
| slow 8 s | the ghost and "arriving" until the answer |
| 503, cooldown | the reason and Retry; Retry recovers once lb-bot is back |
| 404 (an older lb-bot) | the section absent |
| empty | "None of your artists match ..." and "Checked: your library and MusicBrainz." |
| A held stale answer | "pale k" held 6 s while "pale kiosk" was typed: the held answer never replaced the newer rows |
| Ownership by MBID | an artist with no Navidrome `mbz` owned through the mirror's MBID joins Your artists; Pale Kiosk's same-name stranger stays under Not in your library |
| A pasted link | one row and no lookup; Enter twice resolves once and opens the album with lb-bot's caution; an unknown link shows lb-bot's own sentence in the row |
| Hub setting off | no section, no lookup, no gap pills, no Mixes chip |
| The late arrival | the ghost pulses between opacity 0.55 and 1.0 (1.4 s cycle), the first row rises 8 px to 0 in about 210 ms (`getAnimations()`: 240 ms) |

Real MusicBrainz, 15 lookups through the relay: beetles, boygenuis, kendrik lamar, daft pnk, radiohead, the strokes, mgmt, mitksi and slowdvie put
the right artist first; radioheed, phoebe bridgres and sufjan stevns got lb-bot's 502 ("MusicBrainz did not answer a moment ago, and was not
asked again yet"), twice each, drawn as the failure line with Retry while the owned half still found each by fuzzy match. With the hub setting
on, Feishin's Cast bridge also announced a real Cast speaker on the LAN into the scratch hub; nothing was played to it.

### Tracks (Task 5)

| What | Seen |
|---|---|
| The bitrate sort, local Navidrome 0.64.2 | `/api/song?_end=100&_order=DESC&_sort=bitRate&_start=0&missing=false` 200, first ten 1411 x10; ASC 200, first ten 96 x10; the first 30 monotone each way; all 11,657 rows ordered both ways through the API |
| The owner's server | **NOT VERIFIED** (no sign-in here) |
| Columns | Bitrate cells "1,411 kbps" (empty for 0); the sorted column's header carries `data-sorted` and the accent; the count "11,657 songs" once, at the right of the filter row |
| Sort: Rating, descending | 5 stars first (read from the list query's cache) |
| Top rated | `has_rating=true` and Rating DESC in one URL update: 400 songs, all 5 stars first; deselecting restores Name ASC; flipping the direction by hand deselects it (hasRating stays, counted as an active filter); Enter and Space work on it |
| Migration to settings version 39 | the old default at 38: both columns on, everything else the same; a customised table at 38 (a moved column, a changed width, a column off, Bitrate missing): every width and the order kept, Bitrate appended, Rating switched on; the settings import of an export written at 38: migrated; a profile with no settings at all: both on in the Tracks table only (playlist and queue song tables untouched) |
| Right-click on a row | the song menu, unchanged |

The first Top rated build did nothing: three setters in one tick each wrote the URL from the same old value, so only the last survived. Fixed
before the commit (one update for the three keys, the sort persisted by the chip itself).

### The other chips (Task 6)

Every chip page at 800, 1100, 1280 and 2560 wide, queue closed and open: the play button, count and list search sit in the slot and work (Albums
8,742 to 405 on "ae", `searchTerm` written, Escape clears); sort, direction, filters, refresh, display, table settings and the filter panel toggle
answer; no second title, no second scrollbar, no document scroll, nothing overflowing the frame; the lists reach the frame's bottom edge (Tracks
keeps its pagination row under its table). Create Playlist, Create Radio Station and New mix are visible and unclipped (looked at, not clicked).
Play from the slot: the popover, Play, the app's own "Add items to the queue" confirmation, then the album's song playing locally (the hub saw
`active=none`).

Albums: a genre filter chosen in the app (`genreIds`) survived a reload and a fresh open of its URL (891 albums, all Folk); the artist
discography route works outside the frame, where no sidebar row is selected (my first reading said Library was: my check matched a class
every row carries; the review caught it, and selection is by exact path, so a detail page selects nothing); Back from an album restored the grid's scroll (4,800 px, the
same album at the top).

Keyboard: Tab runs Back, Forward, Search, the sidebar, the slot, the chips, More, then the page; Enter opens every chip and `aria-current`
follows; More opens on Enter, the arrows move, Enter chooses (More then reads "Album artists", `aria-current="page"`), Escape returns focus to
More. Two fixes in Task 6: the slot's controls draw the chips' 2 px focus ring (the theme turns Mantine's off), and Tab out of the open More menu
closes it and moves on (Shift+Tab to the chip before it) instead of cycling inside Mantine's focus trap.

At 800 wide with the queue open the shell gives a list page 176 px: the slot wraps under the title and the count badge is squeezed to a sliver
(nothing overflows the page). That is F3's grid, not the frame (BACKLOG B-198).

### Every old page keeps a way in (Task 7)

Each old sidebar entry clicked to its new way in, with the URL and the selected state read back:

| Old entry | New way in | Lands on | Selected |
|---|---|---|---|
| Albums | chip Albums | `/library/albums` | chip Albums, sidebar Library |
| Tracks | chip Tracks | `/library/songs` | chip Tracks, sidebar Library |
| (new) Artists | chip Artists | `/library` | chip Artists, sidebar Library |
| Artists (album artists) | More > Album artists | `/library/album-artists` | More "Album artists" (page), sidebar Library |
| Artists (all roles) | More > All artists | `/library/artists` | More "All artists" (page), sidebar Library |
| Genres | chip Genres | `/library/genres` | chip Genres, sidebar Library |
| Folders | chip Folders | `/library/folders` | chip Folders, sidebar Library |
| Radio | chip Radio stations | `/radio` | chip Radio stations, sidebar Library |
| Favorites | More > Favorites | `/favorites` (its own page) | no sidebar row (outside the frame) |
| Discover | More > Discover | `/explore` (its own page) | no sidebar row (outside the frame) |
| Mixed for You | chip Mixes (while the hub is configured) | `/mixes` | chip Mixes, sidebar Library |
| Playlists | chip Playlists, and the sidebar's own Playlists section | `/playlists` | chip Playlists, sidebar Library |
| Fresh, Statistics, Saved queues, Library Matches, Settings, Home | unchanged rows | their routes | their own row |
| Needs attention, Activity | unchanged rows | `/downloads` | Activity (both rows share the route; unchanged from F5) |
| Search, Now Playing (switched on) | plain rows after Library | `/search/song`, `/now-playing` | their own row |
| Collections (one saved) | its sidebar row | `/library/albums?genreIds=...` | chip Albums, sidebar Library, 891 albums |

Switching off Genres, Folders, Radio, Favorites or All artists removes exactly that chip or More entry; nothing else moves. The palette's Go to
page lists Library (opens the Artists chip) and "Album artists" (the table, labelled as More labels it). Sidebar settings: Albums, Tracks, Album
Artists and Playlists show "Always in Library" with the switch on and disabled; Genres still gates its chip through Save, and back; the stored
items end as they started. The expanded sidebar, the rail and the drawer still select Library on the chip pages after `LibraryRow`, the
`children` field and the rail's flattening were removed.

### Measurements (Task 8)

**Keystrokes in the production build** (`electron-vite build`, Electron started on `out/` with a copy of the scratch profile, signed in to the
stand-in through its own form, the hub setting off so no lookup is spent). Time from the `input` event to the first painted frame after the list
changed; a keystroke that leaves the list as it was (16 to 20 of 100) counts the field's own paint. Ten queries typed one character every 150 ms:

| List | Read (chip to the whole list) | 1 char | 3 chars | 6 chars | 10 chars | All 100 keystrokes |
|---|---|---|---|---|---|---|
| 2,999 artists | 709 ms | median 18.7 / worst 27.5 | 19.6 / 37.0 | 31.4 / 49.4 | 25.7 / 41.3 | median 25.3, worst 62.9 |
| 20,000 synthetic | 1,915 ms | 20.5 / 36.1 | 25.6 / 50.5 | 28.6 / 55.0 | 35.8 / 43.7 | median 30.1, worst 62.4 |

The dev build's numbers (Task 3) were higher (median 25 to 65 ms, 8.9 s to read 20,000) because of React's dev-only render logging.

**Twenty typed queries**, hub off, production build, names read off the production app's own list: the ten exact ones put the exact artist
first (10 of 10); nine of the ten with a typo put the intended artist first (a swap, a dropped or an added letter, a missing diacritic). The miss:
"oryrisecot ahs" for "Oryrisécot Ash" found nothing, because the matcher forgives no typo in a three-letter word ("ahs").

**Counts:** 181 of the 2,999 artists carry a gap pill (410 gaps; the mirror holds 306 of them, 211 linked by MBID); 400 rated songs (Top
rated's count); bitrates 96 to 1,411 kbps.

**Contrast on rendered pixels:** background from screenshot pixels just outside each text's glyph box (inside its chip or pill, or on the
page), text colour through a canvas with its ancestors' opacity. Cover seeds at hues 40, 120 and 250, dark (meanL 0.22) and light (0.86), set
on the paused song's key, and with Cover colours off (defaultDark):

| Text | h40 dark | h40 light | h120 dark | h120 light | h250 dark | h250 light | Off | Lowest |
|---|---|---|---|---|---|---|---|---|
| Chip | 6.62 | 8.69 | 6.13 | 8.86 | 6.21 | 8.87 | 14.09 | 6.13 |
| Chip, selected | 6.42 | 8.01 | 6.17 | 8.13 | 6.22 | 8.09 | 5.00 | 5.00 |
| More | 6.76 | 8.37 | 6.30 | 8.38 | 6.41 | 8.42 | 14.09 | 6.30 |
| Title "Library" | 9.19 | 10.92 | 8.47 | 11.09 | 8.49 | 11.07 | 14.96 | 8.47 |
| Field text | 6.82 | 8.71 | 6.31 | 8.78 | 6.32 | 8.88 | 12.56 | 6.31 |
| Field hint | 5.53 | 5.36 | 5.22 | 5.30 | 5.22 | 5.40 | 6.23 | 5.22 |
| Section heading | 10.12 | 10.87 | 9.35 | 10.97 | 9.35 | 10.99 | 14.96 | 9.35 |
| Heading note | 8.38 | 6.36 | 7.85 | 6.29 | 7.81 | 6.32 | 6.61 | 6.29 |
| Row name / line | 10.28 / 8.63 | 10.81 / 6.55 | 9.60 / 8.18 | 10.96 / 6.50 | 9.64 / 8.16 | 10.99 / 6.56 | 14.96 / 6.61 | 9.60 / 6.50 |
| Gap pill | 10.23 | 11.06 | 9.49 | 11.14 | 9.51 | 11.17 | 14.96 | 9.49 |
| Not owned pill | 8.99 | 6.62 | 8.54 | 6.59 | 8.57 | 6.65 | 6.61 | 6.59 |
| Muted note ("Checked: ...") | 11.05 | 6.20 | 10.75 | 6.23 | 10.81 | 6.22 | 6.61 | 6.20 |
| Sorted header | 7.30 | 6.18 | 7.09 | 5.78 | 6.83 | 5.95 | 14.96 | 5.78 |
| Song count | 7.86 | 6.78 | 7.42 | 6.67 | 7.37 | 6.73 | 6.61 | 6.61 |
| Top rated chip | 6.80 | 8.42 | 6.37 | 8.52 | 6.33 | 8.45 | 14.09 | 6.33 |

**Finding, fixed in `49f150a4`:** the sorted header read **3.56:1** with Cover colours off: defaultDark's accent (`rgb(5, 88, 253)`) as text on
the header. It now carries a 2 px accent bar in every mode (3.56 to 7.31 against the header, over the 3:1 a mark needs) and takes the accent as
text only under the wash; without the wash the label keeps the header colour (14.96).

**States (Step 4)**, beyond Tasks 3 to 5: an lb-bot without the lookup route (the hub's status edited in the store): the hint promises only
"Your artists", no MusicBrainz section, "Checked: your library.", no lookup sent, the gap pills still drawn; a server without the yes/no
rating filter (its feature removed in the store): Top rated is not offered, the Rating and Bitrate sort keys still are.

### Found on the way (one line each in `backlog-ui/BACKLOG.md`)

- **B-195** Enter does nothing on any focused link or button while a list page is mounted (the app-wide `listPlayDefault` hotkey prevents its
  default). The chips keep Enter; the rest is upstream.
- **B-196** (high, F5's code) Clearing the queue crashes the whole app: `BaseImage` (`image.tsx`, from `70406953`) sets state during render, and
  when `src` is cleared while the native image still holds its last `displaySrc` the two branches undo each other forever ("Too many
  re-renders"). Reproduced with the queue panel's own Clear. Not fixed here (another branch's file); the fix is one reordering, in the line.
- **B-197** Keyboard focus is invisible almost everywhere (`focusRing: 'never'`), and the list toolbars' icon buttons have no names.
- **B-198** At 800 px wide with the queue open the shell leaves a list page 176 px.

## Reasoned from code only (NOT VERIFIED)

- **The owner's server and library:** the bitrate sort against it (Task 5's probe ran on the local Navidrome 0.64.2 only); the real artist count,
  the time to read it and the keystroke time over it; the typo table over real names; the gap-pill count; Top rated's real count.
- **The real hub and lb-bot over it:** only the scratch hub was used; the real lb-bot was reached only through the GET-only relay for 15 artist
  lookups. An lb-bot or MusicBrainz outage on the real stack beyond lb-bot's 502 seen there.
- **The index mirror not loaded yet** (gap pills absent and ownership falling back to Navidrome's own `mbz` until it loads): read, not watched.
- **A server that refuses the bitrate sort** (the list's own error state would show) and **Tracks with no rated songs** (Top rated's empty
  list).
- **Windows and macOS; a non-Navidrome server** (Jellyfin and Subsonic: no Bitrate sort key, no Top rated); light themes with Cover colours off
  (only defaultDark was measured off); **the OS reduced-motion setting** (only CDP's emulation).
- **Smoothness:** the VM's frames are not the owner's.

## Calls made beyond the plan

1. **The base** is F5's tip (`636afd2a`), because F5 was not in `origin/feat/redesign`.
2. **The ghost row is replaced in place, not folded with `Fold`:** inside the windowed list a fixed-height virtual row cannot animate its own
   height; the first result takes the ghost's 68 px, so nothing jumps.
3. **More names the page** when one of its entries is shown ("Album artists", `aria-current="page"`), so the chip row always says where you are.
4. **The lookup's failure line is the main process's sentence** (lb-bot's own wording for a MusicBrainz outage), falling back to the generic
   line, rather than one fixed sentence that would misname the cause.
5. **The link box's resolver** (`openResolvedLink`) was extracted from the Activity page's link box (where it lives on this base, not Fresh),
   and both use it.
6. **Top rated writes its three URL keys in one update, and only the URL**, instead of calling the three setters the plan names (they
   overwrite each other in one tick, and they save the sort: after the review, leaving Tracks and coming back drops Top rated and its sort
   together, since `hasRating` is never saved).
7. **The sorted header's accent** is a 2 px bar in every mode, and accent text only under the cover wash (contrast, above).
8. **Keyboard:** the slot's controls got the 2 px ring, and Tab leaves the open More menu.
9. **Sidebar settings' locked rows** show their switch on (they are always there) as well as disabled; their stored flags are left untouched.
10. **The production timing** was measured by starting Electron directly on `out/` (`electron-vite preview` has no remote-debugging switch).

## Open for the owner

The plan's list, unchanged (each was built as the plan decided):

1. The top-left Search stays beside the Library field (Call 7).
2. Top rated is every rated song, best first; Favorites stays under More (Calls 8 and 11).
3. Discover and Favorites live under More, not on the board.
4. Artists means album artists; the old table and the all-roles list are under More (Call 2).
5. A to Z by the displayed name, so "The Wrens of May" sits under T (Call 6).
6. The unowned row's line is type, country and disambiguation, not a release count (Call 5).
7. The page's play button, count and search sit in the title row's slot (Call 10).
8. Tracks keeps its paging; continuous scroll is one switch (Call 14).
9. Rating and Bitrate are switched on once in the Tracks table, even where they were off on purpose; the board's column order is not forced
   (Call 12). Folders reads the Tracks table's settings (upstream), so it shows them too.
10. The bitrate sort's proof against your server (Task 5): NOT VERIFIED here.
11. Everything under NOT VERIFIED above.

And from this run:

12. Favorites and Discover open their own pages from More, outside the frame, so no sidebar row is selected there. Should the Library row
    stay selected on them?
13. The Home and Settings switches in Sidebar settings have done nothing since F2 (those rows are always there); they are not marked here.
14. At 800 px with the queue open (B-198), should the shell fold the sidebar to its rail?
15. B-196 crashes the app on Clear queue in F5's code: worth fixing before F5 and F6 are merged.

## Suggested `navi-connect/CLAUDE.md` §6 text (Feishin)

The workstation's file cannot be edited from here, so this is the bullet to add under "### Feishin":

- **Library (F6):** a pathless layout route, `features/library/components/library-frame.tsx`, wraps the ten list routes in
  `library-routes.ts` (`LIBRARY_FRAME_ROUTES`): the title, the chips (`library-tabs.ts`, More for the rest), and a slot the pages' header pieces
  portal into (`FramedPageHeader`, `LibraryFrameActions`). The Artists page (`/library`) reads every album artist once into
  `[serverId, 'albumArtists', 'list', 'library-all', musicFolderId]` as `{ items, startIndex, totalRecordCount }` (so the lb-bot refresh drops it
  and the rating and favourite updaters can walk it) and ranks it locally with `shared/utils/fuzzy-match.ts` (Navic's Find matcher). The
  MusicBrainz half is result-shaped: absent when it was not asked, a failure is a line with Retry and never "nothing", and ownership is by MBID
  only (Navidrome's `mbz` or the index mirror's row for a held Navidrome artist), never by name.

## Try this

1. Library in the sidebar, then type a name with a typo: your artists narrow on every key; a moment later Not in your library arrives under its
   own heading with a ghost row first.
2. Paste a Spotify or MusicBrainz link into the same field and press Enter.
3. Tracks: Sort by Bitrate, then Top rated, then press it again; the sort you had comes back.
4. Tab from the top bar into the chips, Enter on one, open More with Enter and leave it with Tab.
5. Settings > Sidebar configuration: switch Genres off and save; its chip goes.

## The review (appended after the branch's last task)

One fresh agent, read-only, given the plan, this note and `636afd2a..HEAD`. It re-ran both type-checks (clean), eslint on the 58 changed
TS/TSX files and stylelint on the 13 CSS files (clean), the harnesses (59 files, 874 pass, each new one on its own: 13, 8, 13, 6, 4, and the
sidebar's 15) and the em dash gate (nothing). Its findings, in its order:

| # | Finding | Severity | What happened |
|---|---|---|---|
| 1 | Leaving the Artists page during its first read leaves the last partial page cached as a fresh success for 10 minutes (a cancelled query reverts to its last manual `setQueryData`): "still reading" with nothing reading, later artists not found, their MusicBrainz candidates "Not owned". Proved with the repo's query-core | Important | **Fixed in `5f13253c`.** A partial list is always stale (`libraryArtistsStaleTime`); the paging loop is a pure module whose harness drives a real `QueryClient` (leave after two of six pages, come back), seen failing first (no request on return). In the app, pages held 700 ms: 1,000 rows cached partial after leaving, "1,000 artists, still reading your library" on return, then 2,999 |
| 2 | A new text or sort keeps the list's scroll offset, so the best rows are above the viewport, or a shorter list shows its bottom | Important | **Fixed in `5f13253c`.** The list returns to the top when the text or sort changes after mount. Watched failing first: 980 px after typing "the" from 3,000 px, 3,000 px after A to Z to Plays; now 0 and 0, and Back from an artist still restores 2,000 px |
| 3 | "None of your artists match" and the Not owned split are drawn against a list still being read, with no "still reading" | Minor | **Fixed.** The none line adds "Still reading your library." and the MusicBrainz heading ", still reading your library" while the first read runs |
| 4 | The 20,000-row cap is called complete | Minor | **Fixed.** A capped list says "read the first 20,000 of N by name" in its heading and in the none line (harness: capped at the limit, not when the library is exactly the limit) |
| 5 | Top rated saved Rating as the Tracks sort, so leaving and coming back showed Rating with the chip off and the old sort lost | Minor | **Fixed.** The chip writes only the URL. Watched: Recently added, Top rated on, Albums, Tracks: Recently added, chip off |
| 6 | Top rated and the count also appeared on Favorites' Songs list (same page key, outside the frame), where turning it on rewrote the Tracks sort | Minor | **Fixed.** Both are gated on being in the frame. Watched: Favorites' songs filter row has neither; its own badge stays |
| 7 | An artist whose name is only symbols ("!!!") cannot be found: it normalises to nothing | Minor | **Deferred**, ruling below |
| 8 | On a Subsonic server the loader downloads the whole artist index once per 500-row page | Minor | **Deferred**, ruling below |
| - | This note claimed the discography page selects the sidebar's Library row, and "Escape twice clears" | Note | **Corrected** above |

It also checked and found sound: an older lookup answer cannot land under newer text; ownership is by MBID only; the rating and favourite
updaters handle the cached shape; the lb-bot refresh drops the list; the version 39 migration runs on settings import; the `draggable-items`
change is additive (Home, artist and full-screen settings unchanged); the tab motion keys; the slot never moves; More's Tab handling; every old
sidebar id has a way in.

### Rulings I made

- **Finding 1, the fix's shape:** a stale partial list instead of keeping partial pages out of the real cache key, so the first read still
  shows each page as it arrives and the rating and favourite updaters still find the list while it is being read.
- **Finding 2:** the reset is keyed on the ranked text and the sort, not on the item count, so the MusicBrainz half arriving under your
  artists does not move the list.
- **Finding 7 (symbol-only names), deferred:** the matcher is Navic's, rule for rule; changing what it indexes belongs in both clients at once.
  An artist named only in symbols is still in the A to Z list and in the top-left Search.
- **Finding 8 (Subsonic), deferred:** the plan leaves Jellyfin and Subsonic out; the page works there, slowly, and the fix (one `getArtists`
  call for the whole list) is the controller's, not the Library's.

### Deferred minors

- Findings 7 and 8 above.
- In fit-to-width mode with the filter panel open, every Tracks column is scaled down together; at 1280 the Bitrate column is 48 px, its
  centred header shows only its middle letters and "kbps" wraps under the number (upstream's fit, with two more columns on).
- The palette's Discover group still says "Mixed for You", "Downloads" and "My Listening" (the navi-connect items' own labels), while the sidebar says Mixes, Activity and Statistics.

