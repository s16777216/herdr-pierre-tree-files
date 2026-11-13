# Pierre Tree Files

A fast, modern file explorer, code editor, and image viewer suite for Herdr App powered by a Pierre-style path-first tree projection, VS Code's Material Icon Theme, compact single-child folder nesting (`src/components/ui`), instant fuzzy/substring search with live count, Git change status markers, standalone editor tabs (`pierre-tree-files-editor`), and Material-iconed tab pills (`pierre-tree-files-tab`).

![Pierre Tree Files](preview.png)

## What you see

1. **`pierre-tree-files` (Sidebar File Explorer)** — Sits in a layout block (typically the right sidebar, min 200px, max 600px) as a rounded-10 bordered card on `theme().background`:
   - **Header** (42px high, px 14, gap 6, bottom border): "Files" title, workspace folder name, and toolbar icon buttons (Search `Ctrl+F`, Compact folders toggle, Collapse all, Refresh).
   - **Instant Search Bar** (34px high, `theme().raised`, shown when searching): 13px search icon, 26px text input (`"Filter files… (Esc to close)"`), `"N found"` count pill, and close button.
   - **File Tree View** (flex-1, scrollbar enabled, p 4): 26px rows with hierarchical indentation (`6 + depth * 14px`), 12px chevron, 15px Material icon, truncated name, and Git status markers (`A` green, `M` yellow, `D`/`U` red, plus folder change count badge). Expanding an uncached folder immediately replaces its chevron with a spinning `.spin(900)` icon and inserts an indented `Loading…` row underneath until entries load.

2. **`pierre-tree-files-editor` (Standalone Tab Editor & Image Viewer)** — Opens as a dedicated tab via `tab.new`:
   - **Breadcrumb Bar** (26px high, px 10, bottom border): VS Code style parent path segments separated by `›`, semibold file name, and a 6px yellow dot when dirty.
   - **Text/Code Mode**: Right-aligned pure SVG icon buttons (Revert `undo.svg` when dirty, Save `save.svg`), plus a full-bleed `Editor` with syntax highlighting, line numbers, and code folding.
   - **Image Viewer Mode** (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.ico`, `.bmp`, `.svg`): Shows natural dimensions (`W×H`) next to the file name and zoom controls (`−`, `Fit` / `%` toggle, `+`) on the right. Defaults to Fit-to-Window scaling (`max_w_full().max_h_full()`), switching to scrollable pixel-scaled view when zoomed.

3. **`pierre-tree-files-tab` (Tab Bar with File Icons)** — Optional custom tab bar replacing `tabs`:
   - Displays 14px Material file icons alongside file names on editor tabs, automatically matching Herdr's light and dark themes.

## How it behaves

- **Folder clicks**: Toggles expanded/collapsed state. Uncached folders show an immediate spinning indicator and `Loading…` placeholder row while PowerShell/shell directory listing runs.
- **File clicks**: Opens a standalone tab via `run("tab.new", { name: fileName, folder: this.root, mod: "pierre-tree-files-editor", props: { file: fullPath, on: this.on } })`.
- **Workspace CWD preservation**: When focusing on a pure-mod editor tab (which has no terminal CWD), `pierre-tree-files` falls back to sibling terminal panes in the same space and a per-space `lastCwdBySpace` cache so the sidebar tree stays anchored to the active project.
- **Saving**: `Ctrl+S` / `Cmd+S` (bound via `cx.bind_keys` + `.key_context("CodeEditor")` + `.on_action`) or clicking the save SVG button performs an atomic `writeTextFile` check against `cleanText`.
- **Image caching & zooming**: External project images are copied idempotently into `~/.config/herdr-app/data/image-cache/` via PowerShell `Copy-Item` (Windows) or `cp` (Unix) so GPUI's sandboxed `image()` loader can render them without triggering mod hot-reloads. Supports `+`/`-` zoom steps (25%–400%) and `0` to reset to Fit.
- **Folder Watching**: Watches the active workspace root via `watchFolder` and refreshes on file system events.

## Built from

- **GPUI Elements**: `v_flex`, `h_flex`, `div`, `svg`, `image`, `Editor`, `EditorState`, `Input`, `InputState`.
- **Herdr APIs**: `spaces`, `panes`, `focused`, `layout`, `exec`, `readTextFile`, `writeTextFile`, `watchFolder`, `theme`, `settings`, `window`, `run`, `notify`, `appHome`.
- **Pure Models**: `tree.js` (`PierreTreeModel`), `icons.js` (Material Icon Theme resolution table).
- **Art**: VS Code Material Icon Theme SVG glyphs in `mods/pierre-tree-files/icons/`, editor action SVGs in `mods/pierre-tree-files-editor/icons/`, and window controls in `mods/pierre-tree-files-tab/`.

## Watch out

- **Sandboxing**: Herdr prevents cross-mod JS imports; `pierre-tree-files-tab` bundles its own local `icons.js` and references `mods/pierre-tree-files/icons/` for SVG assets.
- **Editor Keybindings**: `Editor` consumes `on_key_down` events when focused; `Ctrl+S` / `Cmd+S` must be registered with `cx.bind_keys` and `.key_context("CodeEditor")` + `.on_action`.
- **Image Sandbox & Hot-Reload Loop**: GPUI `image()` only loads paths relative to `~/.config/herdr-app/`. Caching images inside `mods/` triggers infinite hot-reload loops, so external images must be cached idempotently in `data/image-cache/` (using PowerShell `Copy-Item -LiteralPath` on Windows to avoid `cmd.exe` quote-escaping bugs).
- **Windows Path Separators**: Paths in the Pierre projection are normalized to forward slashes before indexing.

## Done when

1. `herdr-app check` passes with exit code 0 for all three mods (`pierre-tree-files`, `pierre-tree-files-editor`, `pierre-tree-files-tab`).
2. Clicking an uncached folder immediately shows a spinning loader and `Loading…` row before rendering children.
3. Clicking a code file opens a standalone `pierre-tree-files-editor` tab with file icon in `pierre-tree-files-tab`, while the sidebar tree retains the project CWD.
4. Editing a file and pressing `Ctrl+S` / `Cmd+S` saves atomically and clears the dirty indicator dot.
5. Clicking an image opens it cleanly in Fit mode without flashing, and `+`/`-`/`0` zoom controls work smoothly.
