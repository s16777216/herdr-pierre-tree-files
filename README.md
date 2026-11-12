# Pierre Tree Files (Herdr Mod)

A fast, modern file explorer panel for [Herdr App](https://github.com/herdr-app), built with a **Pierre-style Path-First tree architecture**, **VS Code Material Icon Theme**, **compact folder nesting**, **instant search filter**, and **Git status indicators**.

![Pierre Tree Files](preview.png)

## ✨ Features

- **🌲 Pierre-Style Path-First Projection**:
  - Linear tree projection with flat hierarchy arrays.
  - O(1) canonical path lookups without recursive DOM/element reconstruction.
- **📁 Compact Folder Nesting**:
  - Automatically collapses single-child directory hierarchies (e.g., `src/components/ui/` in a single line).
  - One-click toggle in the header toolbar to turn on/off.
- **🔍 Instant Search & Filter**:
  - Press `Ctrl+F` (or `Cmd+F`) to instantly reveal the filter input and start typing.
  - Real-time substring and path filtering with match count badges.
  - Hit `Esc` to instantly clear and return to the full tree.
- **🎨 Material Icon Theme**:
  - Complete Material Icon Theme mapping for file names, extensions, and folder names.
  - Automatically adapts to Herdr's light and dark themes.
- **🌿 Git Status Integration**:
  - Shows file change indicators: `A` (Added), `M` (Modified), `D` (Deleted), `U` (Untracked).
  - Folder badges indicate the number of modified descendant files inside collapsed trees.
- **✏️ Built-in Code Editor & Tab Integration**:
  - Clicking any file opens a standalone editor tab with breadcrumbs navigation.
  - Full syntax highlighting, line numbers, code folding, and `⌘S` / `Ctrl+S` quick atomic save.
- **🖼️ Built-in Image Viewer**:
  - Instant image preview for `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.ico`, `.bmp`, `.svg`.
  - Supports zoom in/out (`+`/`-`), fit-to-window toggle (`0`), and natural dimension badge.

---

## 🚀 Installation

Ask your Herdr coding agent:
> *"Install the mod from github.com/s16777216/herdr-pierre-tree-files"*

Your agent will automatically copy the `mods/` directory into your `~/.config/herdr-app/mods/` and verify the setup.

### Manual Installation

Copy both mods from the `mods/` directory into your Herdr configuration folder:
- **Windows**: `%USERPROFILE%\.config\herdr-app\mods\`
- **macOS / Linux**: `~/.config/herdr-app/mods/`

Then verify with:
```bash
herdr-app check ~/.config/herdr-app/mods/pierre-tree-files
herdr-app check ~/.config/herdr-app/mods/editor
```

---

## 🛠 Enabling in Your Layout

In your Herdr layout file (e.g. `~/.config/herdr-app/layouts/main.json` or your custom layout), set the mod name of the file panel block to `"pierre-tree-files"`:

```json
{
  "id": "files",
  "type": "block",
  "content": {
    "mod": "pierre-tree-files"
  }
}
```

Herdr will hot-reload within a second!

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Description |
|---|---|
| `Ctrl+F` / `Cmd+F` | Open instant search filter and focus input |
| `Esc` | Close search filter |
| `+` / `-` | Zoom in / Zoom out image in image viewer |
| `0` | Reset image view to Fit-to-Window |

---

## 📄 License

MIT License. Material Icon Theme assets are used under their respective open-source licenses.
