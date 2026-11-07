# Custom themes (Worbus)

Runtime custom themes for Worbus for desktop, loaded via the v1.15.0 "Custom Themes" feature
(desktop only — see `docs/CUSTOM_THEMES.md`). These are **not** part of the build; they are
dropped into the app's Themes folder and picked up live.

## Themes here

| File | Appears as | Base | Effect |
|------|-----------|------|--------|
| `catppuccin-mocha-glassy.json` | Catppuccin Mocha Glassy (Dark) | `catppuccinMocha` | Frosted/translucent glass chrome |
| `catppuccin-latte-glassy.json` | Catppuccin Latte Glassy (Light) | `catppuccinLatte` | Frosted/translucent glass chrome |
| `catppuccin-glassy.css` | — (linked stylesheet) | — | Shared glass overrides, palette-driven |

The glass treatment is the frosted-surface part of the built-in **Glassy Dark** theme, ported
onto the Catppuccin palettes. `catppuccin-glassy.css` is written in terms of `--theme-colors-*`
so the one file adapts to whichever Catppuccin palette is active (dark Mocha or light Latte).

> **Note:** the Catppuccin palettes are embedded directly in each JSON's `colors` block rather
> than pulled via `extends`. In this build, `extends` pointing at a *built-in* theme id
> is effectively a no-op — `getAppTheme` only merges the shared **default** (dark) palette with
> the theme's own `colors`, so a theme with no `colors` renders default-dark regardless of
> `extends`. The `extends` keys are kept for intent/forward-compat; the `colors` blocks are what
> actually make Latte light and Mocha its Catppuccin tones.

## Install

Copy all three files into the app's Themes folder (JSON at the root):

| Build | Folder |
|-------|--------|
| Release | `%APPDATA%\feishin\Themes` |
| Dev (`pnpm dev`) | `%APPDATA%\feishin-dev\Themes` |

Then open **Settings → General → Theme** and pick the theme (or click **Reload**). After editing
only the `.css`, re-save the `.json` or click **Reload** so the stylesheet is re-read.
