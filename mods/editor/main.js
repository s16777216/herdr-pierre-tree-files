import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState } from "gpui-base";
import { props, readTextFile, writeTextFile, theme, settings, notify, exec, appHome } from "herdr";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "svg"]);
function isImageFile(filePath) {
  if (!filePath) return false;
  const ext = filePath.split(".").pop().toLowerCase();
  return IMAGE_EXTS.has(ext);
}

const LANG_MAP = {
  js: "js", jsx: "js", mjs: "js", cjs: "js",
  ts: "ts", tsx: "ts", mts: "ts", cts: "ts",
  json: "json", jsonc: "json",
  html: "html", htm: "html", vue: "html", svelte: "html",
  css: "css", scss: "css", less: "css",
  md: "markdown", markdown: "markdown", mdx: "markdown",
  py: "python", pyw: "python",
  rs: "rust",
  go: "go",
  c: "c", h: "c", cpp: "cpp", hpp: "cpp", cc: "cpp",
  sh: "sh", bash: "sh", zsh: "sh", ps1: "sh",
  yaml: "yaml", yml: "yaml",
  toml: "toml",
  sql: "sql",
  php: "php",
  java: "java",
  rb: "ruby"
};

function getLanguage(filePath) {
  if (!filePath) return "text";
  const name = filePath.split(/[\\/]/).pop() || "";
  if (name.startsWith(".env") || name.startsWith(".git") || name.endsWith("rc")) return "sh";
  if (name === "Dockerfile") return "sh";
  if (name === "Makefile") return "sh";
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
    this.imageAssetPath = null;

    if (this.file) {
      this.loadFile(cx);
    } else {
      this.loading = false;
      this.error = "No file specified";
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
            `if (-not (Test-Path -LiteralPath '${targetPath}')) { Copy-Item -LiteralPath '${srcPath}' -Destination '${targetPath}' -Force }`
          ]);
        } else {
          res = await exec("sh", [
            "-c",
            `[ ! -f "${targetPath}" ] && cp -f "${srcPath}" "${targetPath}" || true`
          ]);
        }

        if (res && res.code !== 0) {
          throw new Error(res.stderr?.trim() || res.stdout?.trim() || `快取圖片失敗 (code ${res.code})`);
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
      return v_flex().id("editor-pane").size_full().min_h(0).min_w(0).bg(t.background).text_color(t.foreground)
        .track_focus(this.handle)
        // Top Breadcrumb Bar (不顯示格式標籤，維持乾淨麵包屑)
        .child(
          h_flex().h(26).flex_none().px(10).gap(5).items_center().border_b(1).border_color(t.border).bg(t.background)
            .children(parentCrumbs.map(seg => (
              h_flex().gap(5).items_center().children([
                div().text_size(11).text_color(t.dim).child(seg),
                div().text_size(10).text_color(t.dim).child("›")
              ])
            )))
            .child(div().font_semibold().text_size(12).text_color(t.foreground).child(fileName))
            .child(div().flex_1())
        )
        // Image display viewport
        .child(
          v_flex().id("image-viewport").flex_1().min_h(0).min_w(0)
            .overflow_scroll()
            .items_center().justify_center().p(24)
            .when(this.loading, el => el.child(
              div().text_size(13).text_color(t.dim).child("正在載入圖片…")
            ))
            .when(Boolean(this.error) && !this.loading, el => el.child(
              div().text_size(13).text_color(t.ansi1).child(this.error)
            ))
            .when(!this.loading && !this.error && Boolean(this.imageAssetPath), el => el.child(
              div().rounded(8).border_1().border_color(t.border).p(6).bg(t.raised)
                .child(
                  image(this.imageAssetPath)
                )
            ))
        );
    }

    return v_flex().id("editor-pane").size_full().min_h(0).min_w(0).bg(t.background).text_color(t.foreground)
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.keystroke === "ctrl-s" || e.keystroke === "cmd-s") {
          this.save(cx);
        }
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
          // Revert button (only visible when dirty)
          .when(this.isDirty, el => el.child(
            div().id("btn-revert").size(20).flex().items_center().justify_center().rounded(4).cursor_pointer()
              .text_color(t.muted)
              .hover(s => s.bg(t.hover).text_color(t.foreground))
              .tooltip("放棄變更，復原為磁碟檔案")
              .on_click((_e, cx) => this.revert(cx))
              .child(svg("mods/editor/icons/undo.svg").size(12))
          ))
          // Save Button (Pure SVG icon button, no background highlight)
          .child(
            div().id("btn-save").size(20).flex().items_center().justify_center().rounded(4).cursor_pointer()
              .text_color(this.isDirty ? t.foreground : t.dim)
              .hover(s => s.bg(t.hover).text_color(t.foreground))
              .tooltip(this.isDirty ? "儲存檔案 (⌘S)" : "已是最新版本")
              .on_click((_e, cx) => this.save(cx))
              .child(svg("mods/editor/icons/save.svg").size(12))
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
      .when(!this.loading && !this.error && Boolean(this.editorState), el => el.child(
        Editor.new(this.editorState).flex_1().min_h(0).min_w(0)
      ));
  }
}
