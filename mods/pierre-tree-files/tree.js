// PierreTreeModel: Path-First tree state, compact folder nesting, and instant search filter.
export class PierreTreeModel {
  constructor() {
    this.entries = new Map(); // path -> Array<{ name, dir }>
    this.expanded = new Set(); // canonical folder paths currently open
    this.compact = true;
    this.searchQuery = "";
  }

  setEntries(path, entries) {
    this.entries.set(path, entries);
  }

  hasEntries(path) {
    return this.entries.has(path);
  }

  isExpanded(path) {
    return this.expanded.has(path);
  }

  // Toggle a row (supports compact directory chains)
  toggleRow(row) {
    const p = row.path;
    const root = row.rootPath || p;
    const isOpen = this.expanded.has(p) || this.expanded.has(root);

    if (isOpen) {
      this.expanded.delete(p);
      this.expanded.delete(root);
      // Collapse all descendants
      for (const exp of [...this.expanded]) {
        if (exp === p || exp === root || exp.startsWith(root + "/") || exp.startsWith(p + "/")) {
          this.expanded.delete(exp);
        }
      }
    } else {
      this.expanded.add(p);
      if (row.rootPath) {
        // Expand all intermediate segments in the compact chain
        const parts = p.split("/");
        for (let i = 1; i <= parts.length; i++) {
          this.expanded.add(parts.slice(0, i).join("/"));
        }
      }
    }
  }

  collapseAll() {
    this.expanded.clear();
  }

  expandAll() {
    for (const [path, items] of this.entries) {
      if (items.some((x) => x.dir)) this.expanded.add(path);
    }
  }

  toggleCompact() {
    this.compact = !this.compact;
  }

  setSearchQuery(q) {
    this.searchQuery = (q ?? "").trim();
  }

  // Count total known files
  totalFiles() {
    let count = 0;
    for (const items of this.entries.values()) {
      for (const it of items) if (!it.dir) count++;
    }
    return count;
  }

  // Projects the visible tree into an array of visual row objects
  project(marks = {}, root = "") {
    const rows = [];
    const query = this.searchQuery.toLowerCase();
    const normRoot = root ? root.replace(/\\/g, "/").replace(/\/$/, "") : "";

    // Normalize marks to relative paths:
    const relMarks = new Map();
    for (const [absPath, status] of Object.entries(marks)) {
      const p = absPath.replace(/\\/g, "/");
      if (normRoot && p.startsWith(normRoot + "/")) {
        relMarks.set(p.slice(normRoot.length + 1), status);
      } else {
        relMarks.set(p, status);
      }
    }

    // Pre-calculate directory modified counts
    const dirMarks = new Map(); // dirPath -> count of modified files inside
    for (const [relPath] of relMarks) {
      const parts = relPath.split("/");
      for (let i = 1; i < parts.length; i++) {
        const d = parts.slice(0, i).join("/");
        dirMarks.set(d, (dirMarks.get(d) ?? 0) + 1);
      }
    }

    // If searching, pre-compute matching paths and required ancestors
    let matchedPaths = null;
    let requiredExpanded = null;
    let matchCount = 0;

    if (query) {
      matchedPaths = new Set();
      requiredExpanded = new Set();
      for (const [prefix, items] of this.entries) {
        for (const item of items) {
          const fullPath = prefix ? `${prefix}/${item.name}` : item.name;
          if (item.name.toLowerCase().includes(query) || fullPath.toLowerCase().includes(query)) {
            matchedPaths.add(fullPath);
            if (!item.dir) matchCount++;
            // Expand all ancestors
            const parts = fullPath.split("/");
            for (let i = 1; i < parts.length; i++) {
              requiredExpanded.add(parts.slice(0, i).join("/"));
            }
          }
        }
      }
    }

    const walk = (prefix, depth) => {
      const items = this.entries.get(prefix) ?? [];
      const sorted = [...items].sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));

      for (let i = 0; i < sorted.length; i++) {
        const item = sorted[i];
        const path = prefix ? `${prefix}/${item.name}` : item.name;

        if (item.dir) {
          let displayName = item.name;
          let currentPath = path;
          let isCompact = false;

          // Compact nesting: only when enabled and not currently searching
          if (this.compact && !query) {
            let nextItems = this.entries.get(currentPath);
            while (nextItems && nextItems.length === 1 && nextItems[0].dir) {
              const child = nextItems[0];
              displayName += "/" + child.name;
              currentPath += "/" + child.name;
              isCompact = true;
              nextItems = this.entries.get(currentPath);
            }
          }

          const isOpen = query ? requiredExpanded.has(currentPath) : (this.expanded.has(currentPath) || this.expanded.has(path));

          if (query && !matchedPaths.has(currentPath) && !requiredExpanded.has(currentPath)) {
            continue;
          }

          const markCount = dirMarks.get(currentPath) ?? dirMarks.get(path) ?? 0;

          rows.push({
            type: "dir",
            path: currentPath,
            rootPath: path,
            name: displayName,
            baseName: item.name,
            depth,
            open: isOpen,
            compact: isCompact,
            markCount,
          });

          if (isOpen) {
            walk(currentPath, depth + 1);
          }
        } else {
          // File
          if (query && !matchedPaths.has(path)) {
            continue;
          }

          const mark = relMarks.get(path);

          rows.push({
            type: "file",
            path,
            name: item.name,
            depth,
            mark,
          });
        }
      }
    };

    walk("", 0);
    return { rows, matchCount, isSearching: Boolean(query) };
  }
}
