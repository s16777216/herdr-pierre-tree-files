import { View, div } from "gpui-kit";
import { v_flex, h_flex, Input, InputState } from "gpui-base";
import { props, closeOverlay, openOverlay, run, exec, theme, notify, setShared, writeTextFile, readTextFile, window as win } from "herdr";

function parentOf(p) {
  return (p || "").replace(/[\\/][^\\/]+$/, "") || p;
}

function basenameOf(p) {
  return (p || "").split(/[\\/]/).pop() || "";
}

function parentRelOf(rel) {
  const norm = (rel || "").replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  return idx >= 0 ? norm.slice(0, idx) : "";
}

function toWinPath(p) {
  return (p || "").replace(/\//g, "\\");
}

function shQuote(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

export default class FileContextMenu extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.mode = p.mode || "menu";
    this.busy = false;
    this.error = null;

    if (this.mode !== "menu" && this.mode !== "root-menu") {
      this.handle = cx.focus_handle();
      this.handle.focus();
      if (this.mode === "new-file" || this.mode === "new-folder" || this.mode === "rename") {
        const placeholder = this.mode === "new-file"
          ? "輸入檔案名稱 (例如 notes.md)"
          : this.mode === "new-folder"
            ? "輸入資料夾名稱"
            : "輸入新名稱";
        this.input = InputState.new({
          placeholder,
          value: this.mode === "rename" ? (p.name || "") : ""
        });
        this.input.on("submit", (_e, cx) => this.submitDialog(cx));
        this.input.focus();
      }
    }
  }

  close() {
    closeOverlay(props()?.overlay);
  }

  menuItem(id, label, t, action, { danger = false } = {}) {
    return h_flex()
      .id(id)
      .h(26)
      .px(10)
      .rounded(5)
      .items_center()
      .cursor_pointer()
      .text_size(12)
      .text_color(danger ? t.ansi1 : t.foreground)
      .hover(s => s.bg(t.hover))
      .on_click((_e, cx) => action(cx))
      .child(label);
  }

  divider(t) {
    return div().h(1).my(3).mx(6).bg(t.border);
  }

  openDialog(mode, extra) {
    const p = props() ?? {};
    this.close();
    openOverlay({
      mod: "pierre-tree-files-menu",
      kind: "dialog",
      width: 360,
      height: mode === "delete" ? 150 : 165,
      props: {
        mode,
        fullPath: p.fullPath,
        relPath: p.relPath,
        name: p.name,
        isDir: p.isDir,
        root: p.root,
        on: p.on,
        ...extra
      }
    });
  }

  async revealInExplorer() {
    const p = props() ?? {};
    const full = p.fullPath;
    if (!full) return;
    const plat = win()?.platform;
    if (p.on) {
      notify({ title: "不支援遠端檔案總管", body: "遠端主機上的檔案無法在本機檔案總管開啟" });
      return;
    }
    if (plat === "windows") {
      const wp = toWinPath(full);
      await exec("explorer.exe", p.isDir ? [wp] : [`/select,${wp}`]).catch(() => {});
    } else if (plat === "macos") {
      await exec("open", p.isDir ? [full] : ["-R", full]).catch(() => {});
    } else {
      await exec("xdg-open", [p.isDir ? full : parentOf(full)]).catch(() => {});
    }
  }

  submitDialog(cx) {
    if (this.busy) return;
    const p = props() ?? {};
    const overlay = p.overlay;
    const on = p.on ?? null;
    this.error = null;
    this.busy = true;
    cx.notify();

    cx.spawn(async (cx) => {
      try {
        if (this.mode === "new-file" || this.mode === "new-folder") {
          const rawName = (this.input?.value() ?? "").trim().replace(/^[/\\]+/, "");
          if (!rawName) {
            this.error = "名稱不能為空";
            this.busy = false;
            cx.notify();
            return;
          }
          const baseDir = p.targetDir || (p.isDir ? p.fullPath : parentOf(p.fullPath));
          const target = `${baseDir.replace(/[\\/]+$/, "")}/${rawName}`.replace(/\\/g, "/");
          if (on || win()?.platform !== "windows") {
            const cmd = this.mode === "new-folder"
              ? `mkdir -p ${shQuote(target)}`
              : `mkdir -p ${shQuote(parentOf(target))} && touch ${shQuote(target)}`;
            const r = await exec("sh", ["-c", cmd], on ? { on } : undefined);
            if (r.code !== 0) throw new Error(r.stderr || "操作失敗");
          } else {
            if (this.mode === "new-folder") {
              const r = await exec("cmd", ["/c", "mkdir", toWinPath(target)]);
              if (r.code !== 0) throw new Error(r.stderr || "建立資料夾失敗");
            } else {
              const existing = await readTextFile(target).catch(() => null);
              if (existing !== null) throw new Error("檔案已存在");
              await exec("cmd", ["/c", "mkdir", toWinPath(parentOf(target))]).catch(() => {});
              await writeTextFile(target, "", null);
            }
          }
          setShared("pierre-tree-files.refresh", { seq: Date.now(), dir: p.relDir ?? "" });
          closeOverlay(overlay);
          if (this.mode === "new-file") {
            run("tab.new", {
              name: basenameOf(target),
              folder: p.root,
              mod: "pierre-tree-files-editor",
              props: { file: target, on }
            });
          }
          return;
        } else if (this.mode === "rename") {
          const newName = (this.input?.value() ?? "").trim();
          if (!newName || /[\\/]/.test(newName)) {
            this.error = "請輸入有效名稱（不可包含路徑斜線）";
            this.busy = false;
            cx.notify();
            return;
          }
          if (newName !== p.name) {
            const dest = `${parentOf(p.fullPath)}/${newName}`.replace(/\\/g, "/");
            if (on || win()?.platform !== "windows") {
              const r = await exec("sh", ["-c", `mv ${shQuote(p.fullPath)} ${shQuote(dest)}`], on ? { on } : undefined);
              if (r.code !== 0) throw new Error(r.stderr || "重新命名失敗");
            } else {
              const r = await exec("cmd", ["/c", "ren", toWinPath(p.fullPath), newName]);
              if (r.code !== 0) throw new Error(r.stderr || "重新命名失敗");
            }
            setShared("pierre-tree-files.refresh", { seq: Date.now(), dir: parentRelOf(p.relPath) });
          }
        } else if (this.mode === "delete") {
          if (on || win()?.platform !== "windows") {
            const r = await exec("sh", ["-c", `rm -rf ${shQuote(p.fullPath)}`], on ? { on } : undefined);
            if (r.code !== 0) throw new Error(r.stderr || "刪除失敗");
          } else {
            const r = p.isDir
              ? await exec("cmd", ["/c", "rmdir", "/s", "/q", toWinPath(p.fullPath)])
              : await exec("cmd", ["/c", "del", "/f", "/q", toWinPath(p.fullPath)]);
            if (r.code !== 0) throw new Error(r.stderr || "刪除失敗");
          }
          setShared("pierre-tree-files.refresh", { seq: Date.now(), dir: parentRelOf(p.relPath) });
        }
        closeOverlay(overlay);
      } catch (e) {
        this.error = e?.message ?? String(e);
        this.busy = false;
        cx.notify();
      }
    });
  }

  renderDialog(t) {
    const p = props() ?? {};
    const titles = {
      "new-file": "新增檔案",
      "new-folder": "新增資料夾",
      "rename": "重新命名",
      "delete": p.isDir ? "刪除資料夾" : "刪除檔案"
    };
    const isDelete = this.mode === "delete";
    const parentRel = p.isDir ? p.relPath : parentRelOf(p.relPath);

    return v_flex()
      .id("files-dialog")
      .size_full()
      .p(16)
      .gap(10)
      .bg(t.surface)
      .text_color(t.foreground)
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape" || e.keystroke === "escape") this.close();
        else if (e.key === "enter" || e.keystroke === "enter") this.submitDialog(cx);
      })
      .child(div().text_size(13).font_semibold().child(titles[this.mode] || "檔案操作"))
      .when(!isDelete, el => el.child(
        v_flex().gap(6)
          .child(div().text_size(11).text_color(t.dim).truncate().child(parentRel ? `位置：${parentRel}` : "位置：根目錄"))
          .child(
            div().h(30).px(8).flex().items_center().rounded(6).border_1().border_color(t.input ?? t.border).bg(t.background)
              .child(Input.new(this.input).w_full().text_size(12.5).text_color(t.foreground))
          )
      ))
      .when(isDelete, el => el.child(
        div().text_size(12.5).text_color(t.muted)
          .child(p.isDir ? `確定要刪除資料夾「${p.name}」及其所有內容嗎？` : `確定要刪除檔案「${p.name}」嗎？`)
      ))
      .when(Boolean(this.error), el => el.child(
        div().text_size(11.5).text_color(t.ansi1).truncate().child(this.error)
      ))
      .child(div().flex_1())
      .child(
        h_flex().gap(8).justify_end().items_center()
          .child(
            div().id("dlg-cancel").h(26).px(12).flex().items_center().rounded(6).cursor_pointer()
              .text_size(12).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
              .on_click(() => this.close())
              .child("取消")
          )
          .child(
            div().id("dlg-confirm").h(26).px(12).flex().items_center().rounded(6).cursor_pointer()
              .text_size(12).font_medium()
              .bg(isDelete ? t.ansi1 : (t.solid ?? t.accent))
              .text_color(isDelete ? "#ffffff" : (t.solid_foreground ?? "#ffffff"))
              .hover(s => s.opacity(0.9))
              .on_click((_e, cx) => this.submitDialog(cx))
              .child(this.busy ? "處理中…" : (isDelete ? "刪除" : "確定"))
          )
      );
  }

  render() {
    const t = theme();
    if (this.mode !== "menu" && this.mode !== "root-menu") {
      return this.renderDialog(t);
    }

    const p = props() ?? {};
    if (this.mode === "root-menu") {
      return v_flex()
        .id("pierre-files-root-menu")
        .w_full()
        .p(4)
        .bg(t.surface)
        .text_color(t.foreground)
        .child(this.menuItem("rm-new-file", "新增檔案…", t, () => this.openDialog("new-file", { targetDir: p.fullPath, relDir: "" })))
        .child(this.menuItem("rm-new-dir", "新增資料夾…", t, () => this.openDialog("new-folder", { targetDir: p.fullPath, relDir: "" })))
        .child(this.divider(t))
        .child(this.menuItem("rm-term", "在此資料夾開啟終端機", t, () => {
          this.close();
          run("tab.new", { folder: p.fullPath });
        }))
        .child(this.menuItem("rm-copy-root", "複製根目錄路徑", t, (_cx) => {
          _cx.write_to_clipboard(p.fullPath || "");
          notify({ title: "已複製路徑", body: p.fullPath });
          this.close();
        }))
        .child(this.menuItem("rm-reveal", "在檔案總管中開啟", t, () => {
          this.close();
          this.revealInExplorer();
        }))
        .child(this.menuItem("rm-refresh", "重新整理", t, () => {
          setShared("pierre-tree-files.refresh", { seq: Date.now(), dir: "" });
          this.close();
        }));
    }
    const targetDir = p.isDir ? p.fullPath : parentOf(p.fullPath);
    const targetRelDir = p.isDir ? p.relPath : parentRelOf(p.relPath);

    return v_flex()
      .id("pierre-files-menu")
      .w_full()
      .p(4)
      .bg(t.surface)
      .text_color(t.foreground)
      .when(p.isDir, el => el
        .child(this.menuItem("m-toggle", p.isOpen ? "收合資料夾" : "展開資料夾", t, () => {
          setShared("pierre-tree-files.action", { seq: Date.now(), type: "toggle", relPath: p.relPath });
          this.close();
        }))
        .child(this.menuItem("m-term", "在此資料夾開啟終端機", t, () => {
          this.close();
          run("tab.new", { folder: p.fullPath });
        }))
        .child(this.divider(t))
      )
      .when(!p.isDir, el => el
        .child(this.menuItem("m-open", "在編輯器開啟", t, () => {
          this.close();
          run("tab.new", {
            name: p.name,
            folder: p.root,
            mod: "pierre-tree-files-editor",
            props: { file: p.fullPath, on: p.on }
          });
        }))
        .child(this.divider(t))
      )
      .child(this.menuItem("m-new-file", "新增檔案…", t, () => this.openDialog("new-file", { targetDir, relDir: targetRelDir })))
      .child(this.menuItem("m-new-dir", "新增資料夾…", t, () => this.openDialog("new-folder", { targetDir, relDir: targetRelDir })))
      .child(this.divider(t))
      .child(this.menuItem("m-copy-abs", "複製完整路徑", t, (_cx) => {
        _cx.write_to_clipboard(p.fullPath || "");
        notify({ title: "已複製路徑", body: p.fullPath });
        this.close();
      }))
      .child(this.menuItem("m-copy-rel", "複製相對路徑", t, (_cx) => {
        _cx.write_to_clipboard(p.relPath || "");
        notify({ title: "已複製相對路徑", body: p.relPath });
        this.close();
      }))
      .child(this.menuItem("m-reveal", "在檔案總管中顯示", t, () => {
        this.close();
        this.revealInExplorer();
      }))
      .child(this.divider(t))
      .child(this.menuItem("m-rename", "重新命名…", t, () => this.openDialog("rename")))
      .child(this.menuItem("m-delete", "刪除…", t, () => this.openDialog("delete"), { danger: true }));
  }
}
