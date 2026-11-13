import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, TextView } from "gpui-base";
import { props, readTextFile, writeTextFile, theme, settings, notify, exec, appHome, run } from "herdr";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "svg"]);
function isImageFile(filePath) {
  if (!filePath) return false;
  const ext = filePath.split(".").pop().toLowerCase();
  return IMAGE_EXTS.has(ext);
}

const MD_EXTS = new Set(["md", "markdown", "mdx"]);
function isMarkdownFile(filePath) {
  if (!filePath) return false;
  const ext = filePath.split(".").pop().toLowerCase();
  return MD_EXTS.has(ext);
}

function formatMarkdownFrontMatter(text) {
  if (!text) return "";
  const m = /^-{3}\r?\n([\s\S]*?)\r?\n-{3}[ \t]*(\r?\n|$)/.exec(text);
  return m ? "```yaml\n" + m[1] + "\n```\n\n" + text.slice(m[0].length) : text;
}

function resolveMarkdownLink(url, docPath) {
  if (!url) return null;
  if (/^(https?:|mailto:)/i.test(url)) return { web: url };
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^file:/i.test(url) && !/^[a-z]:[\\/]/i.test(url)) return null;
  const given = decodeURIComponent(url.replace(/^file:\/\//i, "").replace(/[?#].*$/, "")).replace(/\\/g, "/");
  if (!given) return null;
  const normDoc = (docPath ?? "").replace(/\\/g, "/");
  const isAbs = given.startsWith("/") || /^[A-Za-z]:\//.test(given);
  const joined = isAbs ? given : normDoc.replace(/\/[^/]*$/, "") + "/" + given;
  const drive = /^[A-Za-z]:/.exec(joined)?.[0] ?? "";
  const rest = drive ? joined.slice(drive.length) : joined;
  const out = rest.split("/").reduce((parts, part) => (
    part === ".." ? parts.slice(0, -1) : part && part !== "." ? [...parts, part] : parts
  ), []);
  return { file: (drive || "") + "/" + out.join("/") };
}

const LANG_MAP = {
  js: "js", jsx: "js", mjs: "js", cjs: "js",
  ts: "ts", tsx: "ts", mts: "ts", cts: "ts",
  json: "json", jsonc: "json", json5: "json",
  html: "html", htm: "html", vue: "html", svelte: "html", astro: "html",
  xml: "xml", xhtml: "xml", plist: "xml", xaml: "xml",
  css: "css", scss: "css", sass: "css", less: "css",
  md: "markdown", markdown: "markdown", mdx: "markdown",
  py: "python", pyw: "python", pyi: "python",
  rs: "rust",
  go: "go",
  c: "c", h: "c",
  cpp: "cpp", hpp: "cpp", cc: "cpp", cxx: "cpp", hh: "cpp",
  cs: "csharp",
  java: "java",
  kt: "kotlin", kts: "kotlin",
  swift: "swift",
  dart: "dart",
  zig: "zig",
  lua: "lua",
  r: "r",
  pl: "perl", pm: "perl",
  ex: "elixir", exs: "elixir",
  sh: "sh", bash: "sh", zsh: "sh", fish: "sh", ps1: "sh", psm1: "sh", psd1: "sh", bat: "sh", cmd: "sh",
  yaml: "yaml", yml: "yaml",
  toml: "toml",
  ini: "ini", cfg: "ini", conf: "ini", properties: "ini",
  sql: "sql",
  graphql: "graphql", gql: "graphql",
  proto: "proto",
  diff: "diff", patch: "diff",
  php: "php",
  rb: "ruby", rake: "ruby", gemspec: "ruby"
};

function getLanguage(filePath) {
  if (!filePath) return "text";
  const name = filePath.split(/[\\/]/).pop() || "";
  const lower = name.toLowerCase();
  if (lower === ".editorconfig") return "ini";
  if (lower.startsWith(".env") || lower.startsWith(".git") || lower.endsWith("rc")) return "sh";
  if (lower === "dockerfile" || lower.endsWith(".dockerfile")) return "sh";
  if (lower === "makefile" || lower === "gnumakefile") return "sh";
  const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
  return LANG_MAP[ext] ?? ext ?? "text";
}

function getBreadcrumbs(filePath) {
  if (!filePath) return [];
  const norm = filePath.replace(/\\/g, "/");
  const parts = norm.split("/").filter(Boolean);
  if (!parts.length) return [];
  const clean = parts[0].includes(":") ? parts.slice(1) : parts;
  return clean.slice(-3);
}

export default class CodeEditorPane extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.file = props()?.file ?? null;
    this.on = props()?.on ?? null;
    this.cleanText = "";
    this.editorState = null;
    this.isDirty = false;
    this.loading = true;
    this.error = null;
    this.saving = false;
    this.lineCount = 0;
    this.isImage = isImageFile(this.file);
    this.isMarkdown = isMarkdownFile(this.file);
    this.mdPreview = this.isMarkdown;
    this.imageAssetPath = null;
    this.isFit = true;
    this.zoom = 1.0;
    this.imgWidth = 0;
    this.imgHeight = 0;

    cx.bind_keys([
      { keystroke: "ctrl-s", action: "code_editor_save", context: "CodeEditor" },
      { keystroke: "cmd-s", action: "code_editor_save", context: "CodeEditor" }
    ]);

    if (this.file) {
      this.loadFile(cx);
    } else {
      this.loading = false;
      this.error = "No file specified";
    }
  }

  zoomIn(cx) {
    const steps = [0.25, 0.33, 0.5, 0.67, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0];
    if (this.isFit) {
      this.isFit = false;
      this.zoom = 1.0;
    } else {
      const next = steps.find(s => s > this.zoom + 0.05);
      this.zoom = next ?? 4.0;
    }
    cx.notify();
  }

  zoomOut(cx) {
    const steps = [0.25, 0.33, 0.5, 0.67, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0];
    if (this.isFit) {
      this.isFit = false;
      this.zoom = 0.75;
    } else {
      const prev = [...steps].reverse().find(s => s < this.zoom - 0.05);
      if (prev) {
        this.zoom = prev;
      } else {
        this.isFit = true;
      }
    }
    cx.notify();
  }

  toggleFit(cx) {
    if (this.isFit) {
      this.isFit = false;
      this.zoom = 1.0;
    } else {
      this.isFit = true;
    }
    cx.notify();
  }

  resetFit(cx) {
    this.isFit = true;
    this.zoom = 1.0;
    cx.notify();
  }

  setMarkdownPreview(preview, cx) {
    if (this.mdPreview === preview) return;
    this.mdPreview = preview;
    cx.notify();
  }

  followLink(url, cx) {
    const to = resolveMarkdownLink(url, this.file);
    if (to?.web) {
      try { cx.open_url(to.web); } catch {}
    } else if (to?.file) {
      const targetName = to.file.split(/[\\/]/).pop() || "Editor";
      run("tab.new", {
        name: targetName,
        mod: "pierre-tree-files-editor",
        props: { file: to.file, on: this.on }
      });
    }
  }

  async loadFile(cx) {
    if (this.isImage) {
      this.loading = true;
      this.error = null;
      cx.notify();

      try {
        const hash = Math.abs(Array.from(this.file).reduce((acc, char) => (acc << 5) - acc + char.charCodeAt(0), 0)).toString(36);
        const ext = this.file.split(".").pop().toLowerCase();
        const cacheFile = `img_${hash}.${ext}`;
        const relPath = `data/image-cache/${cacheFile}`;

        const base = appHome();
        const sep = base.includes("\\") ? "\\" : "/";
        const normBase = base.replace(/[\\/]+$/, "");
        const targetAbs = `${normBase}${sep}data${sep}image-cache${sep}${cacheFile}`;

        const isWin = sep === "\\";
        const srcPath = isWin ? this.file.replace(/\//g, "\\") : this.file;
        const targetPath = isWin ? targetAbs.replace(/\//g, "\\") : targetAbs;

        let res;
        if (isWin) {
          res = await exec("powershell", [
            "-NoProfile",
            "-Command",
            `if (-not (Test-Path -LiteralPath '${targetPath}')) { Copy-Item -LiteralPath '${srcPath}' -Destination '${targetPath}' -Force }; try { Add-Type -AssemblyName System.Drawing; $i = [System.Drawing.Image]::FromFile('${targetPath}'); Write-Host "SIZE:$($i.Width)x$($i.Height)"; $i.Dispose() } catch {}`
          ]);
        } else {
          res = await exec("sh", [
            "-c",
            `[ ! -f "${targetPath}" ] && cp -f "${srcPath}" "${targetPath}" || true; identify -format "SIZE:%wx%h" "${targetPath}" 2>/dev/null || true`
          ]);
        }

        if (res && res.code !== 0) {
          throw new Error(res.stderr?.trim() || res.stdout?.trim() || `快取圖片失敗 (code ${res.code})`);
        }

        const match = (res.stdout || "").match(/SIZE:(\d+)x(\d+)/);
        if (match) {
          this.imgWidth = parseInt(match[1], 10);
          this.imgHeight = parseInt(match[2], 10);
        }

        this.imageAssetPath = relPath;
        this.loading = false;
      } catch (err) {
        this.error = `載入圖片失敗: ${err?.message || err}`;
        this.loading = false;
      } finally {
        cx.notify();
      }
      return;
    }

    this.loading = true;
    this.error = null;
    cx.notify();

    try {
      const text = await readTextFile(this.file, { on: this.on });
      if (text === null) {
        this.error = "File not found or unreadable";
        this.loading = false;
        cx.notify();
        return;
      }
      if (text.includes("\0")) {
        this.error = "Binary file cannot be edited in text editor";
        this.loading = false;
        cx.notify();
        return;
      }

      this.cleanText = text;
      this.isDirty = false;
      this.lineCount = text.split("\n").length;
      const t = theme();
      const s = settings();

      this.editorState = EditorState.new({
        language: getLanguage(this.file),
        value: text,
        readonly: false,
        line_numbers: true,
        folding: true,
        font_family: s?.font_family,
        font_size: s?.font_size ?? 13,
        syntax: {
          keyword: t.ansi5,
          string: t.ansi2,
          comment: t.dim,
          function: t.ansi4,
          type: t.ansi3,
          number: t.ansi1,
          constant: t.ansi6,
          variable: t.foreground,
          operator: t.accent,
          punctuation: t.muted
        }
      });

      this.editorState.on("change", (_e, cx) => {
        if (!this.editorState) return;
        const current = this.editorState.value();
        this.lineCount = current.split("\n").length;
        const dirtyNow = current !== this.cleanText;
        if (dirtyNow !== this.isDirty) {
          this.isDirty = dirtyNow;
          cx.notify();
        }
      });

      this.loading = false;
    } catch (err) {
      this.error = `Failed to open file: ${err?.message || err}`;
      this.loading = false;
    } finally {
      cx.notify();
    }
  }

  async save(cx) {
    if (!this.file || !this.editorState || this.saving) return;
    this.saving = true;
    cx.notify();

    const current = this.editorState.value();
    const fileName = this.file.split(/[\\/]/).pop() || "File";

    try {
      await writeTextFile(this.file, current, this.cleanText);
      this.cleanText = current;
      this.isDirty = false;
      this.saving = false;
      notify({ title: "已儲存檔案", body: fileName });
    } catch (err) {
      this.saving = false;
      // Stale or conflict: try forced write or report error
      try {
        await writeTextFile(this.file, current, null);
        this.cleanText = current;
        this.isDirty = false;
        notify({ title: "已儲存檔案 (覆寫)", body: fileName });
      } catch (forcedErr) {
        notify({ title: "儲存失敗", body: String(forcedErr?.message || forcedErr) });
      }
    } finally {
      cx.notify();
    }
  }

  revert(cx) {
    if (!this.editorState || !this.isDirty) return;
    this.editorState.set_value(this.cleanText);
    this.isDirty = false;
    this.lineCount = this.cleanText.split("\n").length;
    cx.notify();
  }

  render(cx) {
    const t = theme();
    const breadcrumbs = getBreadcrumbs(this.file);
    const fileName = breadcrumbs.length ? breadcrumbs[breadcrumbs.length - 1] : "Untitled";
    const parentCrumbs = breadcrumbs.slice(0, -1);
    const lang = getLanguage(this.file);

    if (this.isImage) {
      const zoomLabel = this.isFit ? "Fit" : `${Math.round(this.zoom * 100)}%`;
      const scaledW = this.imgWidth > 0 && !this.isFit ? Math.round(this.imgWidth * this.zoom) : null;
      const scaledH = this.imgHeight > 0 && !this.isFit ? Math.round(this.imgHeight * this.zoom) : null;

      return v_flex().id("editor-pane").size_full().min_h(0).min_w(0).bg(t.background).text_color(t.foreground)
        .track_focus(this.handle)
        .on_key_down((e, cx) => {
          if (e.keystroke === "ctrl-=" || e.keystroke === "ctrl-+" || e.keystroke === "=" || e.keystroke === "+") {
            this.zoomIn(cx);
          } else if (e.keystroke === "ctrl--" || e.keystroke === "-") {
            this.zoomOut(cx);
          } else if (e.keystroke === "ctrl-0" || e.keystroke === "0") {
            this.resetFit(cx);
          }
        })
        // Top Breadcrumb Bar (不顯示格式標籤，維持乾淨麵包屑與縮放控制項)
        .child(
          h_flex().h(26).flex_none().px(10).gap(5).items_center().border_b(1).border_color(t.border).bg(t.background)
            .children(parentCrumbs.map(seg => (
              h_flex().gap(5).items_center().children([
                div().text_size(11).text_color(t.dim).child(seg),
                div().text_size(10).text_color(t.dim).child("›")
              ])
            )))
            .child(div().font_semibold().text_size(12).text_color(t.foreground).child(fileName))
            .when(Boolean(this.imgWidth && this.imgHeight), el => el.child(
              div().text_size(10).text_color(t.dim).child(`${this.imgWidth}×${this.imgHeight}`)
            ))
            .child(div().flex_1())
            // Zoom controls
            .child(
              h_flex().gap(2).items_center().children([
                // Zoom out
                div().id("btn-zoom-out").size(20).flex().items_center().justify_center().rounded(4).cursor_pointer()
                  .text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
                  .tooltip("縮小 (-)")
                  .on_click((_e, cx) => this.zoomOut(cx))
                  .child(div().font_bold().text_size(14).child("−")),
                // Zoom level / Fit toggle
                div().id("btn-zoom-fit").h(20).px(6).flex().items_center().justify_center().rounded(4).cursor_pointer()
                  .text_color(this.isFit ? t.accent : t.foreground).bg(t.raised)
                  .hover(s => s.bg(t.hover))
                  .tooltip(this.isFit ? "點擊切換為 100% 原寸" : "點擊重置為自適應 (Fit / 0)")
                  .on_click((_e, cx) => this.toggleFit(cx))
                  .child(div().text_size(11).font_medium().child(zoomLabel)),
                // Zoom in
                div().id("btn-zoom-in").size(20).flex().items_center().justify_center().rounded(4).cursor_pointer()
                  .text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
                  .tooltip("放大 (+)")
                  .on_click((_e, cx) => this.zoomIn(cx))
                  .child(div().font_bold().text_size(14).child("+"))
              ])
            )
        )
        // Image display viewport
        .child(
          v_flex().id("image-viewport").flex_1().min_h(0).min_w(0).p(24)
            .when(this.isFit, el => el.items_center().justify_center().overflow_hidden())
            .when(!this.isFit, el => el.overflow_scroll())
            .when(this.loading, el => el.child(
              div().m_auto().text_size(13).text_color(t.dim).child("正在載入圖片…")
            ))
            .when(Boolean(this.error) && !this.loading, el => el.child(
              div().m_auto().text_size(13).text_color(t.ansi1).child(this.error)
            ))
            .when(!this.loading && !this.error && Boolean(this.imageAssetPath), el => el.child(
              this.isFit
                // Fit mode: adapt smoothly within bounds
                ? div().max_w_full().max_h_full().flex().items_center().justify_center().rounded(8).border_1().border_color(t.border).p(6).bg(t.raised)
                    .child(
                      image(this.imageAssetPath).max_w_full().max_h_full()
                    )
                // Custom zoom mode: fixed scaled size with full scrolling
                : div().rounded(8).border_1().border_color(t.border).p(6).bg(t.raised)
                    .when(Boolean(scaledW && scaledH), b => b.w(scaledW).h(scaledH))
                    .child(
                      image(this.imageAssetPath).when(Boolean(scaledW && scaledH), img => img.w(scaledW).h(scaledH))
                    )
            ))
        );
    }

    return v_flex().id("editor-pane").key_context("CodeEditor").size_full().min_h(0).min_w(0).bg(t.background).text_color(t.foreground)
      .track_focus(this.handle)
      .on_action("code_editor_save", (_e, cx) => {
        this.save(cx);
      })
      // Top Breadcrumb Bar (Scheme 1: VS Code Breadcrumb style, h=26)
      .child(
        h_flex().h(26).flex_none().px(10).gap(5).items_center().border_b(1).border_color(t.border).bg(t.background)
          // Breadcrumbs (parent segments)
          .children(parentCrumbs.map(seg => (
            h_flex().gap(5).items_center().children([
              div().text_size(11).text_color(t.dim).child(seg),
              div().text_size(10).text_color(t.dim).child("›")
            ])
          )))
          // Current file name
          .child(div().font_semibold().text_size(12).text_color(t.foreground).child(fileName))
          // Dirty indicator dot
          .when(this.isDirty, el => el.child(
            div().size(6).rounded(3).bg(t.ansi3).tooltip("未儲存變更")
          ))
          // Spacer
          .child(div().flex_1())
          // Markdown Preview / Source 兩段切換
          .when(this.isMarkdown, el => el.child(
            h_flex().p(2).gap(2).rounded(5).bg(t.raised).border_1().border_color(t.border).items_center().children([
              div().id("btn-md-preview").h(18).px(7).flex().items_center().rounded(3).cursor_pointer()
                .text_size(11).font_medium()
                .when(this.mdPreview, b => b.bg(t.background).text_color(t.foreground))
                .when(!this.mdPreview, b => b.text_color(t.dim).hover(s => s.text_color(t.foreground)))
                .on_click((_e, cx) => this.setMarkdownPreview(true, cx))
                .child("Preview"),
              div().id("btn-md-source").h(18).px(7).flex().items_center().rounded(3).cursor_pointer()
                .text_size(11).font_medium()
                .when(!this.mdPreview, b => b.bg(t.background).text_color(t.foreground))
                .when(this.mdPreview, b => b.text_color(t.dim).hover(s => s.text_color(t.foreground)))
                .on_click((_e, cx) => this.setMarkdownPreview(false, cx))
                .child("Source")
            ])
          ))
          // Revert button (only visible when dirty)
          .when(this.isDirty, el => el.child(
            div().id("btn-revert").size(20).flex().items_center().justify_center().rounded(4).cursor_pointer()
              .text_color(t.muted)
              .hover(s => s.bg(t.hover).text_color(t.foreground))
              .tooltip("放棄變更，復原為磁碟檔案")
              .on_click((_e, cx) => this.revert(cx))
              .child(svg("mods/pierre-tree-files-editor/icons/undo.svg").size(12))
          ))
          // Save Button (Pure SVG icon button, no background highlight)
          .child(
            div().id("btn-save").size(20).flex().items_center().justify_center().rounded(4).cursor_pointer()
              .text_color(this.isDirty ? t.foreground : t.dim)
              .hover(s => s.bg(t.hover).text_color(t.foreground))
              .tooltip(this.isDirty ? "儲存檔案 (⌘S)" : "已是最新版本")
              .on_click((_e, cx) => this.save(cx))
              .child(svg("mods/pierre-tree-files-editor/icons/save.svg").size(12))
          )
      )
      // Editor body or loading/error
      .when(this.loading, el => el.child(
        h_flex().flex_1().items_center().justify_center().child(
          div().text_size(13).text_color(t.dim).child("正在載入檔案…")
        )
      ))
      .when(Boolean(this.error) && !this.loading, el => el.child(
        h_flex().flex_1().items_center().justify_center().p(24).child(
          div().text_size(13).text_color(t.ansi1).child(this.error)
        )
      ))
      .when(!this.loading && !this.error && this.isMarkdown && this.mdPreview, el => el.child(
        div().id("md-preview-scroll").flex_1().min_h(0).min_w(0).overflow_y_scrollbar()
          .child(
            v_flex().w_full().max_w(820).px(24).py(20).text_size(14).text_color(t.foreground)
              .child(
                TextView.markdown(
                  "md-preview-view",
                  formatMarkdownFrontMatter(this.editorState ? this.editorState.value() : this.cleanText)
                ).on_link_click((url, cx) => this.followLink(url, cx))
              )
          )
      ))
      .when(!this.loading && !this.error && Boolean(this.editorState) && (!this.isMarkdown || !this.mdPreview), el => el.child(
        Editor.new(this.editorState).flex_1().min_h(0).min_w(0)
      ));
  }
}
