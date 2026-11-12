// Herdr's Files panel powered by Pierre-style Path-First tree architecture
// with VS Code's Material Icon Theme icons, compact folder nesting, instant filter search,
// bounded read-only previews, and optional Markdown panel pop-out.
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, InputState, Input } from "gpui-base";
import { spaces, panes, focused, layout, exec, readTextFile, watchFolder, theme, settings, window, openOverlay, setShared, home, run } from "herdr";
import ICONS from "./icons.js";
import { PierreTreeModel } from "./tree.js";
import { MarkdownDoc } from "./doc.js";

let hasMarkdownPanel = undefined;

async function checkMarkdownPanel() {
  if (hasMarkdownPanel !== undefined) return hasMarkdownPanel;
  try {
    const p = (home() ?? "").replace(/\\/g, "/") + "/.config/herdr-app/mods/markdown-panel/mod.json";
    const text = await readTextFile(p);
    hasMarkdownPanel = Boolean(text);
  } catch {
    hasMarkdownPanel = false;
  }
  return hasMarkdownPanel;
}

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}
const key = () => JSON.stringify(location());

function isFilesVisible() {
  const tree = layout();
  if (!tree || typeof tree !== "object") return true;
  let foundInLayout = false, visibleInLayout = false;
  const walk = (node, hiddenAncestor = false) => {
    if (!node || typeof node !== "object") return;
    const hidden = hiddenAncestor || Boolean(node.hidden);
    if (node.content?.mod === "pierre-tree-files" || node.content?.mod === "file-icons" || node.content?.mod === "files") {
      foundInLayout = true;
      if (!hidden) visibleInLayout = true;
    }
    for (const ch of node.children ?? []) {
      const inactiveStack = node.type === "stack" && node.active && ch?.id && ch.id !== node.active;
      walk(ch, hidden || inactiveStack);
    }
  };
  walk(tree, false);
  if (!foundInLayout || visibleInLayout) return true;
  return (panes() ?? []).some(p => p.mod === "pierre-tree-files" || p.mod === "file-icons" || p.mod === "files");
}

const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html", md: "markdown", markdown: "markdown", mdx: "markdown" };
const DIR = "mods/pierre-tree-files";
const ICON = (name) => `mods/workspace-chrome/${name}.svg`;
const isMarkdown = path => /\.(md|markdown|mdx)$/i.test(path ?? "");

// Material Icon Theme's rules, as VS Code applies them
const bare = name => name.replace(/^__(.+)__$/, "$1").replace(/^[._-]/, "");
const opened = id => id.endsWith("_light") ? `${id.slice(0, -6)}-open_light` : `${id}-open`;
function lookup(table, key, dark) { return (dark ? undefined : ICONS.light[table][key]) ?? ICONS[table][key]; }
function icon(path, dir, open, dark) {
  const parts = path.toLowerCase().split("/"), name = parts[parts.length - 1];
  const table = dir ? "folderNames" : "fileNames", find = key => lookup(table, key, dark) ?? (dir ? lookup(table, bare(key), dark) : undefined);
  let id;
  for (let i = 0; !id && i < parts.length - 1; i++) id = find(parts.slice(i).join("/"));
  if (dir) {
    id ??= find(name) ?? ICONS.folder;
    return `${DIR}/icons/${open ? opened(id) : id}.svg`;
  }
  id ??= lookup(table, name, dark);
  for (let dot = name.indexOf("."); !id && dot !== -1; dot = name.indexOf(".", dot + 1)) id = lookup("fileExtensions", name.slice(dot + 1), dark);
  return `${DIR}/icons/${id ?? ICONS.file}.svg`;
}

async function batchDirectories(root, relPaths, on) {
  if (!on && window()?.platform === "windows") {
    const q = s => "'" + s.replace(/['‘’‚‛]/g, "$&$&") + "'";
    const argsList = relPaths.map(q).join(", ");
    const cmd = `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $r = ${q(root)}; $out = @{}; foreach ($rel in @(${argsList})) { $p = if ($rel) { "$r/$rel" } else { $r }; $items = @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }); $out[$rel] = $items }; $out | ConvertTo-Json -Compress -Depth 4`;
    const r = await exec("powershell", ["-NoProfile", "-Command", cmd], { on });
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const parsed = JSON.parse(r.stdout || "{}");
    const map = new Map();
    for (const rel of relPaths) {
      const val = parsed?.[rel] ?? [];
      map.set(rel, Array.isArray(val) ? val : [val]);
    }
    return map;
  }
  const map = new Map();
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ] && [ ! -L "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  for (const rel of relPaths) {
    const path = rel ? `${root}/${rel}` : root;
    const r = await exec("sh", ["-c", script, "files", path], { on });
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const fields = r.stdout.split("\0"), out = [];
    for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
    map.set(rel, out);
  }
  return map;
}

export default class Files extends View {
  init(_props, cx) {
    this.entries = new Map();
    this.pending = new Set();
    this.marks = {};
    this.gitTopCache = new Map();
    this.stale = false;
    this.mdDoc = null;
    this.treeModel = new PierreTreeModel();
    this.searching = false;
    this.searchInput = InputState.new({ placeholder: "Filter files… (Esc to close)" });
    this.searchInput.on("change", (_e, cx) => {
      this.treeModel.setSearchQuery(this.searchInput.value());
      cx.notify();
    });
    this.handle = cx.focus_handle();
    cx.bind_keys(["Files", "Files > Input"].map(context => ({ keystroke: "escape", action: "files_escape", context })));
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
  }

  close() {
    this.watched = null;
    this.code?.release(); this.code = null;
    this.mdDoc?.release(); this.mdDoc = null;
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async cx => {
      try {
        while (this.watched === root) {
          await watchFolder(root);
          if (this.watched === root) {
            if (isFilesVisible()) {
              this.mdDoc?.load(cx);
              this.refresh(cx, true);
            } else {
              this.stale = true;
            }
          }
        }
      }
      catch { if (this.watched === root) this.watched = null; }
    });
  }

  applyFolderEntries(path, entries) {
    this.entries.set(path, entries);
    this.treeModel.setEntries(path, entries);
  }

  async loadFolder(path, context) {
    const on = this.on, root = this.root;
    const map = await batchDirectories(root, [path], on);
    if (key() !== context) return;
    this.applyFolderEntries(path, map.get(path) ?? []);
  }

  refresh(cx, force = false) {
    if (this.loading) return;
    const { cwd, on } = location(), context = key();
    if (context !== this.context) {
      this.context = context;
      this.root = cwd;
      this.on = on;
      this.entries = new Map();
      this.treeModel = new PierreTreeModel();
      this.pending = new Set();
      this.marks = {};
      this.show(null);
      this.watched = null;
      this.error = null;
      this.stale = true;
    }
    if (!cwd) return;
    if (!force && !isFilesVisible()) {
      this.stale = true;
      return;
    }
    this.stale = false;
    this.loading = true;
    cx.spawn(async cx => {
      try {
        const paths = ["", ...this.treeModel.expanded];
        const map = await batchDirectories(cwd, paths, on);
        if (key() !== context) return;
        for (const path of paths) {
          if (!path || this.treeModel.isExpanded(path)) {
            const entries = map.get(path) ?? [];
            this.applyFolderEntries(path, entries);
          }
        }
        // Auto-prefetch single child directories for instant compact nesting
        if (this.treeModel.compact) {
          const prefetch = [];
          for (const [p, items] of this.entries) {
            if (items.length === 1 && items[0].dir) {
              const childPath = p ? `${p}/${items[0].name}` : items[0].name;
              if (!this.entries.has(childPath)) prefetch.push(childPath);
            }
          }
          if (prefetch.length > 0) {
            const subMap = await batchDirectories(cwd, prefetch, on).catch(() => null);
            if (subMap && key() === context) {
              for (const p of prefetch) {
                this.applyFolderEntries(p, subMap.get(p) ?? []);
              }
            }
          }
        }
        const cacheKey = `${on ?? ""}:${cwd}`;
        let topDir = this.gitTopCache.get(cacheKey);
        if (topDir === undefined) {
          const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
          topDir = top?.code === 0 ? top.stdout.trim() : null;
          this.gitTopCache.set(cacheKey, topDir);
        }
        const marks = {};
        if (topDir) {
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=normal"], { cwd, on }).catch(() => null);
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean)) {
            const xy = entry.slice(0, 2);
            marks[`${topDir}/${entry.slice(3)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
        }
        if (key() !== context) return;
        this.marks = marks;
        this.error = null;
        this.watch(cwd, cx);
      } catch (e) {
        if (key() === context) this.error = String(e);
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
  }

  toggleDir(row, cx) {
    this.treeModel.toggleRow(row);
    const target = row.path;
    if (this.treeModel.isExpanded(target) && !this.entries.has(target) && !this.pending.has(target)) {
      const context = this.context;
      this.pending.add(target);
      cx.spawn(async (cx) => {
        try {
          await this.loadFolder(target, context);
          // Prefetch single child if compact
          if (this.treeModel.compact) {
            const items = this.entries.get(target);
            if (items && items.length === 1 && items[0].dir) {
              const child = `${target}/${items[0].name}`;
              if (!this.entries.has(child)) await this.loadFolder(child, context);
            }
          }
        } catch (e) {
          if (key() === context) this.error = String(e);
        } finally {
          this.pending.delete(target);
          cx.notify();
        }
      });
    }
    cx.notify();
  }

  toggleSearch(cx) {
    this.searching = !this.searching;
    if (!this.searching) {
      this.searchInput.set_value("");
      this.treeModel.setSearchQuery("");
    } else {
      this.searchInput.focus();
    }
    cx.notify();
  }

  closeSearch(cx) {
    this.searching = false;
    this.searchInput.set_value("");
    this.treeModel.setSearchQuery("");
    cx.notify();
  }

  show(path, cx) {
    const prevDoc = this.mdDoc;
    this.code?.release(); this.code = null;
    this.mdDoc = null;
    this.file = path; this.fileError = null;

    if (prevDoc) {
      if (cx) cx.spawn(async () => { await prevDoc.flush().catch(() => {}); prevDoc.release(); });
      else prevDoc.release();
    }
    if (!path || !cx) return;

    const context = this.context, root = this.root, on = this.on;
    const fullPath = `${root}/${path}`;

    if (isMarkdown(path)) {
      setShared("markdown-panel.target", { path: fullPath, on, seq: Date.now() });
      cx.spawn(async (cx) => {
        try {
          const isInstalled = await checkMarkdownPanel();
          if (this.file !== path || key() !== context) return;
          if (isInstalled) {
            this.mdDoc = new MarkdownDoc(fullPath, on, to => {
              if (!isMarkdown(to)) return;
              const normRoot = (root ?? "").replace(/\\/g, "/");
              const normTo = to.replace(/\\/g, "/");
              const rel = normTo.startsWith(normRoot + "/") ? normTo.slice(normRoot.length + 1) : to;
              this.show(rel, cx);
            }, "mods/markdown-panel/icons");
            this.mdDoc.load(cx);
            cx.notify();
            return;
          }
          await this.loadAsPlainText(fullPath, path, context, cx);
        } catch {
          if (this.file === path && key() === context) {
            await this.loadAsPlainText(fullPath, path, context, cx);
          }
        }
      });
      return;
    }

    cx.spawn(async (cx) => {
      await this.loadAsPlainText(fullPath, path, context, cx);
    });
  }

  async loadAsPlainText(fullPath, path, context, cx) {
    try {
      const text = await readTextFile(fullPath, { on: this.on });
      if (this.file !== path || key() !== context) return;
      if (text === null) { this.fileError = "This file is no longer available"; return; }
      if (text.includes("\0")) { this.fileError = "Binary file · no text preview"; return; }
      const t = theme(), ext = path.includes(".") ? path.split(".").pop().toLowerCase() : "txt";
      this.code = EditorState.new({
        language: LANG[ext] ?? (isMarkdown(path) ? "markdown" : ext),
        readonly: true,
        value: text.length > 400000 ? text.slice(0, 400000) + "\n… (file truncated)" : text,
        font_family: settings().font_family,
        font_size: 12,
        syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 }
      });
    } catch {
      if (this.file === path && key() === context) this.fileError = "Cannot preview this file (binary, too large, or unreadable)";
    } finally {
      cx.notify();
    }
  }

  popOutMarkdown(cx) {
    if (!this.file || !isMarkdown(this.file)) return;
    const fullPath = `${this.root}/${this.file}`;
    setShared("markdown-panel.target", { path: fullPath, on: this.on, seq: Date.now() });
    const open = () => {
      try {
        openOverlay({
          mod: "markdown-panel",
          kind: "window",
          width: 560,
          height: 0.9,
          key: "markdown-panel",
          props: { file: fullPath, on: this.on },
        });
      } catch {
        // Gracefully ignore if markdown-panel is not installed
      }
    };
    if (this.mdDoc) {
      cx.spawn(async () => {
        await this.mdDoc?.flush().catch(() => {});
        open();
      });
    } else {
      open();
    }
  }

  treeRow(row, t, dark) {
    const isDir = row.type === "dir";
    const indent = 6 + row.depth * 14;
    const isSelected = this.file === row.path;

    return h_flex().id(`file-${row.path}`).h(26).flex_none().pl(indent).pr(8).gap(6).items_center().rounded(6).cursor_pointer()
      .when(isSelected, el => el.bg(t.selected))
      .hover(s => s.bg(isSelected ? t.selected : t.hover))
      .on_click((_e, cx) => {
        if (isDir) {
          this.toggleDir(row, cx);
        } else {
          const fullPath = this.root ? `${this.root}/${row.path}`.replace(/\\/g, "/") : row.path;
          run("pane.split", {
            direction: "right",
            mod: "editor",
            props: { file: fullPath, on: this.on }
          });
        }
      })
      .child(isDir ? svg(`${DIR}/chevron-${row.open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
      .child(image(icon(row.path, isDir, row.open, dark)).size(15).flex_none())
      .child(div().flex_1().min_w(0).truncate().text_size(12).font_medium()
        .text_color(row.mark === "D" ? t.muted : t.foreground).child(row.name))
      .when(isDir && row.markCount > 0, el => el.child(
        div().px(5).py(1).rounded(4).bg(t.ansi3 + "22").text_color(t.ansi3).text_size(10).font_medium().child(String(row.markCount))
      ))
      .when(!isDir && Boolean(row.mark), el => el.child(
        div().text_size(11).font_semibold()
          .text_color(row.mark === "A" ? t.ansi2 : row.mark === "D" || row.mark === "U" ? t.ansi1 : t.ansi3)
          .child(row.mark)
      ));
  }

  render(cx) {
    if (key() !== this.context || (this.stale && isFilesVisible())) this.refresh(cx, true);
    const t = theme(), dark = Boolean(settings().dark), md = this.mdDoc;
    const treeProject = !this.file ? this.treeModel.project(this.marks, this.root) : null;

    const iconBtn = (id, glyph, tip, on, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .when(on, el => el.bg(t.selected).text_color(t.foreground))
      .when(!on, el => el.text_color(t.muted))
      .hover(s => s.bg(t.hover).text_color(t.foreground))
      .tooltip(tip)
      .on_click((_e, cx) => action(_e, cx))
      .child(svg(ICON(glyph)).size(13));

    return v_flex().id("files").key_context("Files").track_focus(this.handle)
      .on_action("files_escape", (_e, cx) => {
        if (this.searching) { this.closeSearch(cx); }
        else if (md && md.active !== null) { md.close(); cx.notify(); }
        else if (this.file) { this.show(null, cx); cx.notify(); }
      })
      .on_key_down((e, cx) => {
        if ((e.keystroke === "ctrl-f" || e.keystroke === "cmd-f") && !this.file) {
          this.toggleSearch(cx);
          return;
        }
        if ((e.keystroke === "ctrl-shift-m" || e.keystroke === "cmd-shift-m") && this.file && isMarkdown(this.file)) {
          this.popOutMarkdown(cx);
          return;
        }
        md?.key(e, cx);
      })
      .size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      // Header
      .child(h_flex().h(42).flex_none().px(14).gap(6).items_center().border_b(1).border_color(t.border)
        .when(Boolean(this.file), el => el.child(div().id("files-back").w(20).cursor_pointer().text_color(t.muted).hover(s => s.text_color(t.foreground)).on_click((_e, cx) => { this.show(null, cx); cx.notify(); }).child("←")))
        .child(div().font_semibold().child("Files"))
        .child(h_flex().flex_1().min_w(0).gap(6).justify_end().items_center().text_size(12).text_color(t.dim)
          .when(Boolean(this.file), el => el.child(image(icon(this.file, false, false, dark)).size(14).flex_none()))
          .child(div().min_w(0).truncate().child(this.file ?? this.root?.split(/[\\/]/).pop() ?? "")))
        // Tree actions when not showing file
        .when(!this.file, el => el.children([
          iconBtn("files-search-btn", "search", "Search files (Ctrl+F)", this.searching, (_e, cx) => this.toggleSearch(cx)),
          iconBtn("files-compact-btn", "folder", this.treeModel.compact ? "Compact folders (On)" : "Compact folders (Off)", this.treeModel.compact, (_e, cx) => {
            this.treeModel.toggleCompact();
            cx.notify();
          }),
          iconBtn("files-collapse-btn", "minus", "Collapse all folders", false, (_e, cx) => {
            this.treeModel.collapseAll();
            cx.notify();
          }),
          iconBtn("files-refresh-btn", "spinner", "Refresh file tree", false, (_e, cx) => {
            this.refresh(cx, true);
          })
        ]))
        // Markdown controls if markdown-panel is active
        .children(md ? md.controls(t, "files-md") : [])
        .when(Boolean(md) && !md.editing, el => el.child(
          div().id("files-md-refresh").p(4).rounded(6).cursor_pointer().text_color(t.muted).tooltip("Read again")
            .hover(s => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => md.load(cx))
            .child(svg("mods/markdown-panel/icons/refresh.svg").size(13)),
        ))
        // Pop-out Markdown overlay if markdown file is open
        .when(Boolean(this.file) && isMarkdown(this.file), el => el.child(
          div().id("files-md-popout").h(24).px(7).flex().items_center().rounded(6).border_1().border_color(t.border).bg(t.raised).cursor_pointer().text_size(12).text_color(t.foreground)
            .tooltip("Open in floating Markdown window (Ctrl+Shift+M)")
            .hover(s => s.bg(t.hover))
            .on_click((_e, cx) => this.popOutMarkdown(cx))
            .child("↗")
        )))
      // Instant search input bar
      .when(!this.file && this.searching, el => {
        const matchCount = treeProject?.matchCount ?? 0;
        return el.child(
          h_flex().h(34).flex_none().px(10).py(4).gap(6).items_center().border_b(1).border_color(t.border).bg(t.raised)
            .child(svg(ICON("search")).size(13).flex_none().text_color(t.dim))
            .child(div().flex_1().min_w(0).h(26).px(8).flex().items_center().rounded(6).border_1().border_color(t.border).bg(t.background)
              .child(Input.new(this.searchInput).h_full().w_full().text_size(12).text_color(t.foreground)))
            .when(Boolean(this.treeModel.searchQuery), e => e.child(
              div().px(6).py(1).rounded(4).bg(t.surface).text_size(11).text_color(t.dim).child(`${matchCount} found`)
            ))
            .child(div().id("files-search-close").size(22).rounded(4).cursor_pointer().flex().items_center().justify_center().text_color(t.muted)
              .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
              .hover(s => s.bg(t.hover).text_color(t.foreground))
              .tooltip("Close search (Esc)")
              .on_click((_e, cx) => this.closeSearch(cx))
              .child(svg(ICON("x")).size(12)))
        );
      })
      // Tree view
      .when(!this.file, el => {
        const { rows, isSearching } = treeProject;
        return el.child(
          v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(4)
            .children(rows.map(r => this.treeRow(r, t, dark)))
            .when(Boolean(this.error) || (!rows.length && !isSearching), e => e.child(
              div().p(12).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))
            ))
            .when(isSearching && !rows.length, e => e.child(
              h_flex().p(12).gap(8).items_center().justify_center()
                .child(div().text_size(12).text_color(t.dim).child(`No files matching "${this.treeModel.searchQuery}"`))
                .child(div().cursor_pointer().text_size(12).text_color(t.accent).hover(s => s.underline()).on_click((_e, cx) => this.closeSearch(cx)).child("Clear filter"))
            ))
        );
      })
      // Preview view
      .when(Boolean(this.file) && Boolean(md), el => el.child(md.body(t, "files-md-doc")))
      .when(Boolean(this.file) && !md, el => el.child(
        this.code ? Editor.new(this.code).flex_1().min_h(0) : div().p(12).text_color(t.dim).child(this.fileError || "Loading file…")
      ));
  }
}
