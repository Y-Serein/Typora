import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import { demoWorkspace } from "./data/demoWorkspace";
import type { Card, EditorCommandAction, EditorCommandSignal } from "./domain/model";
import "./styles.css";

const MilkdownEditor = lazy(() => import("./components/MilkdownEditor").then((module) => ({
  default: module.MilkdownEditor,
})));

const WORKSPACE_STORAGE_KEY = "ys-writer.workspace.v1";
const SETTINGS_STORAGE_KEY = "ys-writer.settings.v1";
const SHORTCUTS_STORAGE_KEY = "ys-writer.shortcuts.v1";
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 360;
const MIN_EDITOR_LEFT_GAP = 16;
const MAX_EDITOR_LEFT_GAP = 140;
const MIN_UI_SCALE = 85;
const MAX_UI_SCALE = 130;
const WORKSPACE_DIRECTORY_LIMIT = 300;

type PersistedWorkspace = {
  cards: Card[];
  savedAt: string | null;
};

type InitialWorkspace = PersistedWorkspace & {
  loadError: string | null;
};

type SaveStatus = "idle" | "saved" | "error";
type EditorMode = "plain" | "rich";
type ThemeStyle = "daily" | "eye" | "ink" | "mint";
type UIDensity = "comfortable" | "compact";
type SaveFileExt = "md" | "txt";
type SettingsSection = "general" | "editor" | "shortcuts" | "appearance" | "files";

type AppSettings = {
  theme: ThemeStyle;
  uiDensity: UIDensity;
  sidebarWidth: number;
  sidebarVisible: boolean;
  outlineVisible: boolean;
  workspaceRoot: string | null;
  lastOpenedFile: string | null;
  selectedWorkspaceDir: string;
  workspaceRecoveryBlocked: boolean;
  defaultEditorMode: EditorMode;
  restoreWorkspace: boolean;
  editorFontSize: number;
  editorLineHeight: number;
  editorLeftGap: number;
  uiScale: number;
  zoomWithWheel: boolean;
  defaultSaveExt: SaveFileExt;
};

type CommandDefinition = {
  id: string;
  label: string;
  enabled: boolean;
  run: () => void | Promise<void>;
};

type ShortcutCategory = "File" | "Edit" | "View" | "Theme" | "App";

type MarkdownFileResponse = {
  path: string;
  fileName: string;
  fileExt: string;
  content: string;
};

type WorkspaceTreeEntry = {
  name: string;
  path: string;
  relativePath: string;
  kind: "directory" | "file";
  fileExt: string | null;
  children: WorkspaceTreeEntry[];
  loaded?: boolean;
  loading?: boolean;
  hasMore?: boolean;
  truncated?: boolean;
  loadError?: string | null;
};

type WorkspaceDirectoryResponse = {
  name: string;
  path: string;
  relativePath: string;
  children: WorkspaceTreeEntry[];
  hasMore: boolean;
  truncated: boolean;
  error: string | null;
};

type ShortcutEntry = {
  id: string;
  label: string;
  category: ShortcutCategory;
  defaultKeys: string[];
  currentKeys: string[];
  commandId: string;
  editable: boolean;
  enabled: boolean;
};

type PersistedShortcut = {
  id: string;
  currentKeys: string[];
  enabled: boolean;
};

type MenuItem = {
  label: string;
  commandId?: string;
  disabled?: boolean;
};

type MenuGroup = {
  id: string;
  label: string;
  items: MenuItem[];
};

const defaultEditorMode: EditorMode = import.meta.env.PROD ? "rich" : "plain";
const defaultSettings: AppSettings = {
  theme: "daily",
  uiDensity: "comfortable",
  sidebarWidth: 220,
  sidebarVisible: true,
  outlineVisible: true,
  workspaceRoot: null,
  lastOpenedFile: null,
  selectedWorkspaceDir: "",
  workspaceRecoveryBlocked: false,
  defaultEditorMode,
  restoreWorkspace: true,
  editorFontSize: 18,
  editorLineHeight: 1.76,
  editorLeftGap: 48,
  uiScale: 100,
  zoomWithWheel: true,
  defaultSaveExt: "md",
};

const defaultShortcutRegistry: ShortcutEntry[] = [
  {
    id: "file.new",
    label: "New card",
    category: "File",
    defaultKeys: ["Ctrl+N"],
    currentKeys: ["Ctrl+N"],
    commandId: "file.new",
    editable: true,
    enabled: true,
  },
  {
    id: "file.open",
    label: "Open file",
    category: "File",
    defaultKeys: ["Ctrl+O"],
    currentKeys: ["Ctrl+O"],
    commandId: "file.open",
    editable: true,
    enabled: true,
  },
  {
    id: "file.openWorkspace",
    label: "Open workspace",
    category: "File",
    defaultKeys: ["Ctrl+Shift+O"],
    currentKeys: ["Ctrl+Shift+O"],
    commandId: "file.openWorkspace",
    editable: true,
    enabled: true,
  },
  {
    id: "file.save",
    label: "Save workspace",
    category: "File",
    defaultKeys: ["Ctrl+S"],
    currentKeys: ["Ctrl+S"],
    commandId: "file.save",
    editable: true,
    enabled: true,
  },
  {
    id: "file.saveAs",
    label: "Save as",
    category: "File",
    defaultKeys: ["Ctrl+Shift+S"],
    currentKeys: ["Ctrl+Shift+S"],
    commandId: "file.saveAs",
    editable: true,
    enabled: true,
  },
  {
    id: "app.openSettings",
    label: "Open settings",
    category: "App",
    defaultKeys: ["Ctrl+,"],
    currentKeys: ["Ctrl+,"],
    commandId: "app.openSettings",
    editable: true,
    enabled: true,
  },
  {
    id: "edit.cut",
    label: "Cut",
    category: "Edit",
    defaultKeys: ["Ctrl+X"],
    currentKeys: ["Ctrl+X"],
    commandId: "edit.cut",
    editable: true,
    enabled: true,
  },
  {
    id: "edit.copy",
    label: "Copy",
    category: "Edit",
    defaultKeys: ["Ctrl+C"],
    currentKeys: ["Ctrl+C"],
    commandId: "edit.copy",
    editable: true,
    enabled: true,
  },
  {
    id: "edit.paste",
    label: "Paste",
    category: "Edit",
    defaultKeys: ["Ctrl+V"],
    currentKeys: ["Ctrl+V"],
    commandId: "edit.paste",
    editable: true,
    enabled: true,
  },
  {
    id: "edit.selectAll",
    label: "Select all",
    category: "Edit",
    defaultKeys: ["Ctrl+A"],
    currentKeys: ["Ctrl+A"],
    commandId: "edit.selectAll",
    editable: true,
    enabled: true,
  },
  {
    id: "edit.undo",
    label: "Undo",
    category: "Edit",
    defaultKeys: ["Ctrl+Z"],
    currentKeys: ["Ctrl+Z"],
    commandId: "edit.undo",
    editable: true,
    enabled: true,
  },
  {
    id: "edit.redo",
    label: "Redo",
    category: "Edit",
    defaultKeys: ["Ctrl+Y", "Ctrl+Shift+Z"],
    currentKeys: ["Ctrl+Y", "Ctrl+Shift+Z"],
    commandId: "edit.redo",
    editable: true,
    enabled: true,
  },
  {
    id: "view.plain",
    label: "Plain Edit",
    category: "View",
    defaultKeys: ["Ctrl+Alt+P"],
    currentKeys: ["Ctrl+Alt+P"],
    commandId: "view.setPlainEdit",
    editable: true,
    enabled: true,
  },
  {
    id: "view.rich",
    label: "Rich Edit",
    category: "View",
    defaultKeys: ["Ctrl+Alt+R"],
    currentKeys: ["Ctrl+Alt+R"],
    commandId: "view.setRichEdit",
    editable: true,
    enabled: true,
  },
];

const menuGroups: MenuGroup[] = [
  {
    id: "file",
    label: "文件",
    items: [
      { label: "新建", commandId: "file.new" },
      { label: "打开", commandId: "file.open" },
      { label: "打开工作区", commandId: "file.openWorkspace" },
      { label: "保存", commandId: "file.save" },
      { label: "另存为", commandId: "file.saveAs" },
      { label: "导出", commandId: "file.export" },
      { label: "偏好设置", commandId: "app.openSettings" },
    ],
  },
  {
    id: "edit",
    label: "编辑",
    items: [
      { label: "撤销", commandId: "edit.undo" },
      { label: "重做", commandId: "edit.redo" },
      { label: "剪切", commandId: "edit.cut" },
      { label: "复制", commandId: "edit.copy" },
      { label: "粘贴", commandId: "edit.paste" },
      { label: "全选", commandId: "edit.selectAll" },
      { label: "查找", commandId: "edit.find" },
    ],
  },
  {
    id: "paragraph",
    label: "段落",
    items: [
      { label: "正文", commandId: "paragraph.text" },
      { label: "标题1", commandId: "paragraph.heading1" },
      { label: "标题2", commandId: "paragraph.heading2" },
      { label: "标题3", commandId: "paragraph.heading3" },
      { label: "引用", commandId: "paragraph.blockquote" },
      { label: "无序列表", commandId: "paragraph.bulletList" },
      { label: "有序列表", commandId: "paragraph.orderedList" },
      { label: "代码块", commandId: "paragraph.codeBlock" },
    ],
  },
  {
    id: "format",
    label: "格式",
    items: [
      { label: "加粗", commandId: "format.bold" },
      { label: "斜体", commandId: "format.italic" },
      { label: "行内代码", commandId: "format.inlineCode" },
      { label: "删除线", commandId: "format.strike" },
      { label: "链接", commandId: "format.link" },
    ],
  },
  {
    id: "view",
    label: "视图",
    items: [
      { label: "Plain Edit", commandId: "view.setPlainEdit" },
      { label: "Rich Edit", commandId: "view.setRichEdit" },
      { label: "显示/隐藏侧边栏", commandId: "view.toggleSidebar" },
      { label: "Outline", commandId: "view.toggleOutline" },
    ],
  },
  {
    id: "theme",
    label: "主题",
    items: [
      { label: "Daily", commandId: "theme.daily" },
      { label: "Eye Care", commandId: "theme.eye" },
      { label: "Mint", commandId: "theme.mint" },
      { label: "Dark", commandId: "theme.ink" },
    ],
  },
  {
    id: "help",
    label: "帮助",
    items: [
      { label: "快捷键", commandId: "app.openShortcuts" },
      { label: "关于", commandId: "app.about" },
    ],
  },
];

const settingsSections: Array<{ id: SettingsSection; label: string }> = [
  { id: "general", label: "General" },
  { id: "editor", label: "Editor" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "appearance", label: "Appearance" },
  { id: "files", label: "Files" },
];

function formatTime(date: Date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function extractOutline(markdown: string) {
  return markdown
    .split("\n")
    .map((line) => line.match(/^(#{1,3})\s+(.+)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({
      level: match[1].length,
      text: match[2],
    }));
}

function extractFirstLineTitle(markdown: string) {
  const firstLine = markdown.split(/\r?\n/, 1)[0] ?? "";
  const match = firstLine.match(/^#(?!#)\s+(.+?)\s*$/);
  return match?.[1].trim() || null;
}

function getHeadingOffsets(markdown: string) {
  let offset = 0;
  const offsets: Array<{ start: number; end: number }> = [];

  for (const line of markdown.split("\n")) {
    if (/^(#{1,3})\s+(.+)$/.test(line)) {
      offsets.push({ start: offset, end: offset + line.length });
    }
    offset += line.length + 1;
  }

  return offsets;
}

function createCard(): Card {
  const now = new Date().toISOString();
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `card-${Date.now()}`;

  return {
    id,
    title: "未命名文档",
    markdown: "# 未命名文档\n\n开始写作。",
    tagIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

function createFileCard(file: MarkdownFileResponse): Card {
  const now = new Date().toISOString();
  const titleFromHeading = extractFirstLineTitle(file.content);
  const titleFromFile = stripExtension(file.fileName).trim();
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `card-${Date.now()}`;

  return {
    id,
    title: titleFromFile || titleFromHeading || "未命名文档",
    markdown: file.content,
    tagIds: [],
    createdAt: now,
    updatedAt: now,
    filePath: file.path,
    fileName: file.fileName,
    fileExt: file.fileExt,
  };
}

function stripExtension(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "");
}

function pathFileName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? "Untitled.md";
}

function pathExtension(path: string) {
  const match = pathFileName(path).match(/\.([^.]+)$/);
  return match?.[1]?.toLowerCase() ?? "";
}

function ensureSaveExtension(path: string, defaultExt: SaveFileExt) {
  const extension = pathExtension(path);
  if (extension === "md" || extension === "markdown" || extension === "txt") return path;
  return `${path}.${defaultExt}`;
}

function joinWorkspacePath(directory: string, name: string) {
  const cleanName = name.trim();
  return directory ? `${directory}/${cleanName}` : cleanName;
}

function ensureWorkspaceFileName(name: string, defaultExt: SaveFileExt) {
  const cleanName = name.trim();
  const extension = pathExtension(cleanName);
  if (extension === "md" || extension === "markdown" || extension === "txt") return cleanName;
  return `${cleanName}.${defaultExt}`;
}

function normalizeFilePath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function isSameOrChildPath(path: string | undefined, parentPath: string) {
  if (!path) return false;

  const normalizedPath = normalizeFilePath(path);
  const normalizedParent = normalizeFilePath(parentPath);
  return normalizedPath === normalizedParent || normalizedPath.startsWith(`${normalizedParent}/`);
}

function parentWorkspaceDir(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index > -1 ? normalized.slice(0, index) : "";
}

function toLazyWorkspaceEntry(entry: WorkspaceTreeEntry): WorkspaceTreeEntry {
  return {
    ...entry,
    children: [],
    loaded: entry.kind === "file",
    loading: false,
    hasMore: false,
    truncated: false,
    loadError: null,
  };
}

function directoryFromResponse(response: WorkspaceDirectoryResponse): WorkspaceTreeEntry {
  return {
    name: response.name,
    path: response.path,
    relativePath: response.relativePath,
    kind: "directory",
    fileExt: null,
    children: response.children.map(toLazyWorkspaceEntry),
    loaded: true,
    loading: false,
    hasMore: response.hasMore,
    truncated: response.truncated,
    loadError: response.error,
  };
}

function updateWorkspaceNode(
  node: WorkspaceTreeEntry,
  relativePath: string,
  updater: (entry: WorkspaceTreeEntry) => WorkspaceTreeEntry,
): WorkspaceTreeEntry {
  if (node.relativePath === relativePath) return updater(node);

  return {
    ...node,
    children: node.children.map((child) => (
      child.kind === "directory" ? updateWorkspaceNode(child, relativePath, updater) : child
    )),
  };
}

function isEmptyDraft(card: Card) {
  return !card.filePath
    && (card.markdown.trim() === "" || card.markdown === "# 未命名文档\n\n开始写作。");
}

function isCard(value: unknown): value is Card {
  if (!value || typeof value !== "object") return false;
  const card = value as Partial<Card>;
  return typeof card.id === "string"
    && typeof card.title === "string"
    && typeof card.markdown === "string"
    && Array.isArray(card.tagIds)
    && card.tagIds.every((tagId) => typeof tagId === "string")
    && typeof card.createdAt === "string"
    && typeof card.updatedAt === "string";
}

function readInitialWorkspace(restoreWorkspace: boolean): InitialWorkspace {
  const fallback = {
    cards: demoWorkspace.cards,
    savedAt: null,
    loadError: null,
  };

  if (typeof window === "undefined") return fallback;
  if (!restoreWorkspace) return fallback;

  const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedWorkspace>;
    if (!Array.isArray(parsed.cards) || parsed.cards.length === 0 || !parsed.cards.every(isCard)) {
      return {
        ...fallback,
        loadError: "Saved workspace is invalid; loaded demo data.",
      };
    }

    return {
      cards: parsed.cards,
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : null,
      loadError: null,
    };
  } catch (error) {
    console.warn("Failed to read saved workspace", error);
    return {
      ...fallback,
      loadError: "Saved workspace could not be read; loaded demo data.",
    };
  }
}

function writeWorkspace(cards: Card[], persistFileContent: boolean) {
  const savedAt = new Date();
  const payload: PersistedWorkspace = {
    cards: persistFileContent ? cards : cards.filter((card) => !card.filePath),
    savedAt: savedAt.toISOString(),
  };

  window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(payload));
  return savedAt;
}

function clearDraftWorkspace() {
  window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
}

function clampSidebarWidth(width: number) {
  if (!Number.isFinite(width)) return defaultSettings.sidebarWidth;
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width));
}

function clampEditorLeftGap(value: number) {
  if (!Number.isFinite(value)) return defaultSettings.editorLeftGap;
  return Math.min(MAX_EDITOR_LEFT_GAP, Math.max(MIN_EDITOR_LEFT_GAP, value));
}

function clampUiScale(value: number) {
  if (!Number.isFinite(value)) return defaultSettings.uiScale;
  return Math.min(MAX_UI_SCALE, Math.max(MIN_UI_SCALE, value));
}

function readSettings(): AppSettings {
  if (typeof window === "undefined") return defaultSettings;

  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return defaultSettings;

    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const theme: ThemeStyle = parsed.theme === "eye" || parsed.theme === "ink" || parsed.theme === "mint"
      ? parsed.theme
      : "daily";
    const uiDensity: UIDensity = parsed.uiDensity === "compact" ? "compact" : "comfortable";
    const sidebarWidth = typeof parsed.sidebarWidth === "number"
      ? clampSidebarWidth(parsed.sidebarWidth)
      : defaultSettings.sidebarWidth;
    const editorLeftGap = typeof parsed.editorLeftGap === "number"
      ? clampEditorLeftGap(parsed.editorLeftGap)
      : defaultSettings.editorLeftGap;
    const uiScale = typeof parsed.uiScale === "number"
      ? clampUiScale(parsed.uiScale)
      : defaultSettings.uiScale;

    return {
      theme,
      uiDensity,
      sidebarWidth,
      sidebarVisible: typeof parsed.sidebarVisible === "boolean" ? parsed.sidebarVisible : defaultSettings.sidebarVisible,
      outlineVisible: typeof parsed.outlineVisible === "boolean" ? parsed.outlineVisible : defaultSettings.outlineVisible,
      workspaceRoot: typeof parsed.workspaceRoot === "string" && parsed.workspaceRoot ? parsed.workspaceRoot : null,
      lastOpenedFile: typeof parsed.lastOpenedFile === "string" && parsed.lastOpenedFile ? parsed.lastOpenedFile : null,
      selectedWorkspaceDir: typeof parsed.selectedWorkspaceDir === "string" ? parsed.selectedWorkspaceDir : "",
      workspaceRecoveryBlocked: typeof parsed.workspaceRecoveryBlocked === "boolean"
        ? parsed.workspaceRecoveryBlocked
        : defaultSettings.workspaceRecoveryBlocked,
      defaultEditorMode: parsed.defaultEditorMode === "plain" || parsed.defaultEditorMode === "rich"
        ? parsed.defaultEditorMode
        : defaultSettings.defaultEditorMode,
      restoreWorkspace: typeof parsed.restoreWorkspace === "boolean" ? parsed.restoreWorkspace : defaultSettings.restoreWorkspace,
      editorFontSize: typeof parsed.editorFontSize === "number" ? parsed.editorFontSize : defaultSettings.editorFontSize,
      editorLineHeight: typeof parsed.editorLineHeight === "number" ? parsed.editorLineHeight : defaultSettings.editorLineHeight,
      editorLeftGap,
      uiScale,
      zoomWithWheel: typeof parsed.zoomWithWheel === "boolean" ? parsed.zoomWithWheel : defaultSettings.zoomWithWheel,
      defaultSaveExt: parsed.defaultSaveExt === "txt" ? "txt" : "md",
    };
  } catch (error) {
    console.warn("Failed to read settings", error);
    return defaultSettings;
  }
}

function writeSettings(settings: AppSettings) {
  window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

function normalizeShortcutText(value: string) {
  const parts = value
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  const modifiers: string[] = [];
  let key = "";

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "ctrl" || lower === "control") {
      if (!modifiers.includes("Ctrl")) modifiers.push("Ctrl");
    } else if (lower === "shift") {
      if (!modifiers.includes("Shift")) modifiers.push("Shift");
    } else if (lower === "alt" || lower === "option") {
      if (!modifiers.includes("Alt")) modifiers.push("Alt");
    } else if (lower === "meta" || lower === "cmd" || lower === "command") {
      if (!modifiers.includes("Meta")) modifiers.push("Meta");
    } else if (lower === "escape" || lower === "esc") {
      key = "Esc";
    } else if (lower === "space") {
      key = "Space";
    } else if (part.length === 1) {
      key = part.toUpperCase();
    } else {
      key = part.slice(0, 1).toUpperCase() + part.slice(1);
    }
  }

  if (!key) return "";
  return [...modifiers, key].join("+");
}

function normalizeShortcutList(value: string) {
  const normalized = value
    .split(/,\s+/)
    .map((item) => normalizeShortcutText(item))
    .filter(Boolean);

  return Array.from(new Set(normalized));
}

function readShortcuts(): ShortcutEntry[] {
  if (typeof window === "undefined") return defaultShortcutRegistry;

  try {
    const raw = window.localStorage.getItem(SHORTCUTS_STORAGE_KEY);
    if (!raw) return defaultShortcutRegistry;

    const persisted = JSON.parse(raw) as PersistedShortcut[];
    if (!Array.isArray(persisted)) return defaultShortcutRegistry;

    return defaultShortcutRegistry.map((shortcut) => {
      const saved = persisted.find((item) => item.id === shortcut.id);
      if (!saved) return shortcut;

      return {
        ...shortcut,
        currentKeys: Array.isArray(saved.currentKeys)
          ? saved.currentKeys.map((key) => normalizeShortcutText(key)).filter(Boolean)
          : shortcut.currentKeys,
        enabled: typeof saved.enabled === "boolean" ? saved.enabled : shortcut.enabled,
      };
    });
  } catch (error) {
    console.warn("Failed to read shortcuts", error);
    return defaultShortcutRegistry;
  }
}

function writeShortcuts(shortcuts: ShortcutEntry[]) {
  const payload: PersistedShortcut[] = shortcuts.map(({ id, currentKeys, enabled }) => ({
    id,
    currentKeys,
    enabled,
  }));
  window.localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(payload));
}

function shortcutFromEvent(event: KeyboardEvent) {
  if (event.key === "Control" || event.key === "Shift" || event.key === "Alt" || event.key === "Meta") {
    return "";
  }

  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.shiftKey) parts.push("Shift");
  if (event.altKey) parts.push("Alt");
  if (event.metaKey) parts.push("Meta");

  let key = event.key;
  if (key === " ") key = "Space";
  if (key === "Escape") key = "Esc";
  if (key.length === 1) key = key.toUpperCase();

  parts.push(key);
  return parts.join("+");
}

function getShortcutForCommand(shortcuts: ShortcutEntry[], commandId?: string) {
  if (!commandId) return "";
  const shortcut = shortcuts.find((item) => item.commandId === commandId && item.enabled && item.currentKeys.length);
  return shortcut?.currentKeys.join(" / ") ?? "";
}

function isEditorTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    && Boolean(target.closest(".markdown-editor, .ProseMirror, .milkdown"));
}

function selectRichCodeBlockDom(target: EventTarget | null) {
  const selection = window.getSelection();
  if (!selection) return false;
  const anchorElement = selection.anchorNode instanceof HTMLElement
    ? selection.anchorNode
    : selection.anchorNode?.parentElement;
  const eventElement = target instanceof HTMLElement ? target : null;
  const codeBlock = eventElement?.closest<HTMLElement>(".milkdown pre code, .milkdown pre")
    ?? anchorElement?.closest<HTMLElement>(".milkdown pre code, .milkdown pre");

  if (!codeBlock) return false;

  const range = document.createRange();
  range.selectNodeContents(codeBlock);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

function isFormTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

type PlainEditResult = {
  markdown: string;
  selectionStart: number;
  selectionEnd: number;
};

function lineBounds(markdown: string, start: number, end: number) {
  const lineStart = markdown.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nextBreak = markdown.indexOf("\n", end);
  const lineEnd = nextBreak === -1 ? markdown.length : nextBreak;
  return { lineStart, lineEnd };
}

function transformSelectedLines(
  markdown: string,
  start: number,
  end: number,
  transform: (line: string, index: number) => string,
): PlainEditResult {
  const { lineStart, lineEnd } = lineBounds(markdown, start, end);
  const selected = markdown.slice(lineStart, lineEnd);
  const lines = selected.split("\n");
  const nextSelected = lines.map(transform).join("\n");

  return {
    markdown: `${markdown.slice(0, lineStart)}${nextSelected}${markdown.slice(lineEnd)}`,
    selectionStart: lineStart,
    selectionEnd: lineStart + nextSelected.length,
  };
}

function findFenceContentRange(markdown: string, position: number) {
  const lines = markdown.split("\n");
  let offset = 0;
  let opening: { start: number; end: number } | null = null;

  for (const line of lines) {
    const lineStart = offset;
    const lineEnd = lineStart + line.length;
    const isFence = /^\s*```/.test(line);

    if (isFence) {
      if (!opening) {
        opening = { start: lineStart, end: lineEnd };
      } else {
        const contentStart = Math.min(opening.end + 1, markdown.length);
        const contentEnd = lineStart > 0 && markdown[lineStart - 1] === "\n" ? lineStart - 1 : lineStart;
        if (position >= opening.start && position <= lineEnd) {
          return { start: contentStart, end: contentEnd };
        }
        opening = { start: lineStart, end: lineEnd };
      }
    }

    offset = lineEnd + 1;
  }

  if (!opening || position <= opening.end) return null;
  return {
    start: Math.min(opening.end + 1, markdown.length),
    end: markdown.length,
  };
}

function wrapPlainSelection(
  markdown: string,
  start: number,
  end: number,
  before: string,
  after = before,
  placeholder = "text",
): PlainEditResult {
  const selected = markdown.slice(start, end) || placeholder;
  const nextText = `${before}${selected}${after}`;

  return {
    markdown: `${markdown.slice(0, start)}${nextText}${markdown.slice(end)}`,
    selectionStart: start + before.length,
    selectionEnd: start + before.length + selected.length,
  };
}

function applyPlainEditorCommand(
  markdown: string,
  start: number,
  end: number,
  action: EditorCommandAction,
  payload?: string,
): PlainEditResult {
  if (action === "selectAllSmart") {
    const codeRange = findFenceContentRange(markdown, start);
    return codeRange
      ? { markdown, selectionStart: codeRange.start, selectionEnd: codeRange.end }
      : { markdown, selectionStart: 0, selectionEnd: markdown.length };
  }

  if (action === "bold") return wrapPlainSelection(markdown, start, end, "**");
  if (action === "italic") return wrapPlainSelection(markdown, start, end, "*");
  if (action === "inlineCode") return wrapPlainSelection(markdown, start, end, "`");
  if (action === "strike") return wrapPlainSelection(markdown, start, end, "~~");
  if (action === "link") {
    const selected = markdown.slice(start, end) || "link";
    const url = payload || "https://";
    const nextText = `[${selected}](${url})`;
    return {
      markdown: `${markdown.slice(0, start)}${nextText}${markdown.slice(end)}`,
      selectionStart: start + 1,
      selectionEnd: start + 1 + selected.length,
    };
  }

  if (action === "codeBlock") {
    const selected = markdown.slice(start, end) || "code";
    const nextText = `\`\`\`bash\n${selected}\n\`\`\``;
    return {
      markdown: `${markdown.slice(0, start)}${nextText}${markdown.slice(end)}`,
      selectionStart: start + 8,
      selectionEnd: start + 8 + selected.length,
    };
  }

  const headingLevel = action === "heading1" ? 1 : action === "heading2" ? 2 : action === "heading3" ? 3 : 0;
  if (headingLevel) {
    const prefix = `${"#".repeat(headingLevel)} `;
    return transformSelectedLines(markdown, start, end, (line) => (
      line.trim() ? `${prefix}${line.replace(/^\s{0,3}#{1,6}\s+/, "")}` : line
    ));
  }

  if (action === "paragraph") {
    return transformSelectedLines(markdown, start, end, (line) => (
      line
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s{0,3}>\s?/, "")
        .replace(/^\s{0,3}(?:[-*+]\s+|\d+\.\s+)/, "")
    ));
  }

  if (action === "blockquote") {
    return transformSelectedLines(markdown, start, end, (line) => (
      line.trim() && !/^\s{0,3}>\s?/.test(line) ? `> ${line}` : line.replace(/^\s{0,3}>\s?/, "")
    ));
  }

  if (action === "bulletList") {
    return transformSelectedLines(markdown, start, end, (line) => (
      line.trim() ? `- ${line.replace(/^\s{0,3}(?:[-*+]\s+|\d+\.\s+)/, "")}` : line
    ));
  }

  if (action === "orderedList") {
    return transformSelectedLines(markdown, start, end, (line, index) => (
      line.trim() ? `${index + 1}. ${line.replace(/^\s{0,3}(?:[-*+]\s+|\d+\.\s+)/, "")}` : line
    ));
  }

  return { markdown, selectionStart: start, selectionEnd: end };
}

function findShortcutConflicts(shortcuts: ShortcutEntry[]) {
  const keyOwners = new Map<string, ShortcutEntry[]>();

  for (const shortcut of shortcuts) {
    if (!shortcut.enabled) continue;

    for (const key of shortcut.currentKeys) {
      const owners = keyOwners.get(key) ?? [];
      owners.push(shortcut);
      keyOwners.set(key, owners);
    }
  }

  return new Map(
    Array.from(keyOwners.entries())
      .filter(([, owners]) => new Set(owners.map((owner) => owner.commandId)).size > 1),
  );
}

export default function App() {
  const [initialSettings] = useState(readSettings);
  const [initialWorkspace] = useState(() => readInitialWorkspace(initialSettings.restoreWorkspace && !initialSettings.workspaceRoot));
  const [initialShortcuts] = useState(readShortcuts);
  const [cards, setCards] = useState<Card[]>(() => (initialSettings.workspaceRoot ? [createCard()] : initialWorkspace.cards));
  const [activeCardId, setActiveCardId] = useState(cards[0]?.id ?? "");
  const [savedAt, setSavedAt] = useState<Date | null>(
    initialWorkspace.savedAt ? new Date(initialWorkspace.savedAt) : null,
  );
  const [saveError, setSaveError] = useState<string | null>(initialWorkspace.loadError);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [editorMode, setEditorMode] = useState<EditorMode>(initialSettings.defaultEditorMode);
  const [theme, setTheme] = useState<ThemeStyle>(initialSettings.theme);
  const [uiDensity, setUiDensity] = useState<UIDensity>(initialSettings.uiDensity);
  const [sidebarWidth, setSidebarWidth] = useState(initialSettings.sidebarWidth);
  const [sidebarVisible, setSidebarVisible] = useState(initialSettings.sidebarVisible);
  const [outlineVisible, setOutlineVisible] = useState(initialSettings.outlineVisible);
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(initialSettings.workspaceRoot);
  const [workspaceTree, setWorkspaceTree] = useState<WorkspaceTreeEntry | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [selectedWorkspaceDir, setSelectedWorkspaceDir] = useState(initialSettings.selectedWorkspaceDir);
  const [lastOpenedFile, setLastOpenedFile] = useState<string | null>(initialSettings.lastOpenedFile);
  const [workspaceRecoveryBlocked, setWorkspaceRecoveryBlocked] = useState(initialSettings.workspaceRecoveryBlocked);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set([""]));
  const [defaultEditorModeSetting, setDefaultEditorModeSetting] = useState<EditorMode>(initialSettings.defaultEditorMode);
  const [restoreWorkspace, setRestoreWorkspace] = useState(initialSettings.restoreWorkspace);
  const [editorFontSize, setEditorFontSize] = useState(initialSettings.editorFontSize);
  const [editorLineHeight, setEditorLineHeight] = useState(initialSettings.editorLineHeight);
  const [editorLeftGap, setEditorLeftGap] = useState(initialSettings.editorLeftGap);
  const [uiScale, setUiScale] = useState(initialSettings.uiScale);
  const [zoomWithWheel, setZoomWithWheel] = useState(initialSettings.zoomWithWheel);
  const [richCommand, setRichCommand] = useState<EditorCommandSignal | null>(null);
  const [defaultSaveExt, setDefaultSaveExt] = useState<SaveFileExt>(initialSettings.defaultSaveExt);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [shortcuts, setShortcuts] = useState<ShortcutEntry[]>(initialShortcuts);
  const [shortcutEdits, setShortcutEdits] = useState<Record<string, string>>(
    () => Object.fromEntries(initialShortcuts.map((shortcut) => [shortcut.id, shortcut.currentKeys.join(", ")])),
  );
  const menuBarRef = useRef<HTMLElement | null>(null);
  const editorSurfaceRef = useRef<HTMLElement | null>(null);
  const plainEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const restoredWorkspaceRef = useRef(false);
  const richCommandIdRef = useRef(0);

  const activeCard = cards.find((card) => card.id === activeCardId) ?? cards[0];
  const outline = useMemo(() => extractOutline(activeCard.markdown), [activeCard.markdown]);
  const shortcutConflicts = useMemo(() => findShortcutConflicts(shortcuts), [shortcuts]);
  const workspaceMode = Boolean(workspaceRoot);

  const handleWindowAction = useCallback((action: "minimize" | "maximize" | "close") => {
    const run = async () => {
      try {
        const currentWindow = getCurrentWindow();
        if (action === "minimize") await currentWindow.minimize();
        if (action === "maximize") await currentWindow.toggleMaximize();
        if (action === "close") await currentWindow.close();
      } catch (error) {
        console.warn("Window action is only available inside Tauri", error);
      }
    };

    void run();
  }, []);

  const handleTitlebarMouseDown = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0 || event.detail > 1) return;
    if ((event.target as HTMLElement).closest("button")) return;

    try {
      void getCurrentWindow().startDragging();
    } catch (error) {
      console.warn("Window dragging is only available inside Tauri", error);
    }
  }, []);

  const handleTitlebarDoubleClick = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    handleWindowAction("maximize");
  }, [handleWindowAction]);

  const handleMarkdownChange = useCallback((markdown: string) => {
    setCards((currentCards) => currentCards.map((card) => {
      if (card.id !== activeCardId) return card;
      const title = extractFirstLineTitle(markdown);
      return {
        ...card,
        title: title ?? card.title,
        markdown,
        updatedAt: new Date().toISOString(),
      };
    }));
  }, [activeCardId]);

  const loadWorkspaceDirectory = useCallback(async (relativePath = "", root = workspaceRoot) => {
    if (!root) {
      setWorkspaceTree(null);
      return null;
    }

    setWorkspaceTree((current) => {
      if (!current && relativePath === "") {
        return {
          name: pathFileName(root),
          path: root,
          relativePath: "",
          kind: "directory",
          fileExt: null,
          children: [],
          loaded: false,
          loading: true,
          hasMore: false,
          truncated: false,
          loadError: null,
        };
      }

      return current
        ? updateWorkspaceNode(current, relativePath, (entry) => ({ ...entry, loading: true, loadError: null }))
        : current;
    });

    try {
      const directory = await invoke<WorkspaceDirectoryResponse>("read_workspace_directory", {
        root,
        relativePath,
        limit: WORKSPACE_DIRECTORY_LIMIT,
      });

      const nextDirectory = directoryFromResponse(directory);
      setWorkspaceTree((current) => {
        if (!current || relativePath === "") return nextDirectory;
        return updateWorkspaceNode(current, relativePath, () => nextDirectory);
      });
      setWorkspaceError(null);
      setWorkspaceRecoveryBlocked(false);
      return directory;
    } catch (error) {
      console.error("Failed to read workspace directory", error);
      const message = relativePath ? "Directory failed to load" : "Workspace failed to load; safe mode enabled";
      setWorkspaceError(message);
      if (relativePath === "") setWorkspaceRecoveryBlocked(true);
      setWorkspaceTree((current) => (
        current
          ? updateWorkspaceNode(current, relativePath, (entry) => ({
            ...entry,
            loading: false,
            loadError: message,
          }))
          : current
      ));
      return null;
    }
  }, [workspaceRoot]);

  const prefetchInitialDirectories = useCallback(async (root: string, rootDirectory: WorkspaceDirectoryResponse) => {
    let loadedCount = 0;
    const rootDirs = rootDirectory.children.filter((entry) => entry.kind === "directory");

    for (const directory of rootDirs) {
      if (loadedCount >= 3) return;

      setExpandedDirs((current) => new Set(current).add(directory.relativePath));
      const response = await loadWorkspaceDirectory(directory.relativePath, root);
      loadedCount += 1;

      const firstChildDir = response?.children.find((entry) => entry.kind === "directory");
      if (!firstChildDir || loadedCount >= 3) continue;

      setExpandedDirs((current) => new Set(current).add(firstChildDir.relativePath));
      await loadWorkspaceDirectory(firstChildDir.relativePath, root);
      loadedCount += 1;
    }
  }, [loadWorkspaceDirectory]);

  const applyOpenedFile = useCallback((file: MarkdownFileResponse) => {
    const nextCard = createFileCard(file);

    setCards((currentCards) => {
      if (workspaceRoot) return [nextCard];

      if (activeCard && isEmptyDraft(activeCard)) {
        return currentCards.map((card) => (card.id === activeCard.id ? nextCard : card));
      }

      return [nextCard, ...currentCards];
    });
    setActiveCardId(nextCard.id);
    setLastOpenedFile(nextCard.filePath ?? null);
    setSaveError(null);
    setSaveStatus("saved");
  }, [activeCard, workspaceRoot]);

  const openMarkdownFile = useCallback(async (path: string) => {
    const file = await invoke<MarkdownFileResponse>("read_markdown_file", { path });
    applyOpenedFile(file);
  }, [applyOpenedFile]);

  const handleOpenFile = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Markdown/Text", extensions: ["md", "markdown", "txt"] }],
      });

      if (!selected || Array.isArray(selected)) return;

      await openMarkdownFile(selected);
    } catch (error) {
      console.error("Failed to open file", error);
      setSaveError("Open failed");
      setSaveStatus("error");
    }
  }, [openMarkdownFile]);

  const handleOpenWorkspace = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });

      if (!selected || Array.isArray(selected)) return;

      setWorkspaceRoot(selected);
      setSelectedWorkspaceDir("");
      setLastOpenedFile(null);
      setWorkspaceRecoveryBlocked(false);
      setExpandedDirs(new Set([""]));
      const card = createCard();
      setCards([card]);
      setActiveCardId(card.id);
      const rootDirectory = await loadWorkspaceDirectory("", selected);
      if (rootDirectory) void prefetchInitialDirectories(selected, rootDirectory);
    } catch (error) {
      console.error("Failed to open workspace", error);
      setWorkspaceError("Open workspace failed");
    }
  }, [loadWorkspaceDirectory, prefetchInitialDirectories]);

  const saveCardToPath = useCallback(async (card: Card, path: string) => {
    const normalizedPath = ensureSaveExtension(path, defaultSaveExt);
    const file = await invoke<MarkdownFileResponse>("write_markdown_file", {
      path: normalizedPath,
      content: card.markdown,
    });

    const nextCard: Card = {
      ...card,
      title: stripExtension(file.fileName) || extractFirstLineTitle(card.markdown) || card.title,
      filePath: file.path,
      fileName: file.fileName,
      fileExt: file.fileExt,
      updatedAt: new Date().toISOString(),
    };

    setCards((currentCards) => currentCards.map((item) => (item.id === card.id ? nextCard : item)));
    setLastOpenedFile(nextCard.filePath ?? null);
    if (workspaceRoot) await loadWorkspaceDirectory(selectedWorkspaceDir);
    setSavedAt(new Date());
    setSaveError(null);
    setSaveStatus("saved");
  }, [defaultSaveExt, loadWorkspaceDirectory, selectedWorkspaceDir, workspaceRoot]);

  const handleSaveAs = useCallback(async () => {
    if (!activeCard) return;

    try {
      const fallbackName = `${activeCard.fileName ? stripExtension(activeCard.fileName) : activeCard.title || "Untitled"}.${defaultSaveExt}`;
      const selected = await save({
        defaultPath: fallbackName,
        filters: [{ name: "Markdown/Text", extensions: ["md", "markdown", "txt"] }],
      });

      if (!selected) return;
      await saveCardToPath(activeCard, selected);
    } catch (error) {
      console.error("Failed to save file as", error);
      setSaveError("Save As failed");
      setSaveStatus("error");
    }
  }, [activeCard, defaultSaveExt, saveCardToPath]);

  const handleSave = useCallback(async () => {
    if (!activeCard) return;

    try {
      if (activeCard.filePath) {
        await saveCardToPath(activeCard, activeCard.filePath);
      } else {
        await handleSaveAs();
      }
    } catch (error) {
      console.error("Failed to save workspace", error);
      setSaveError("Save failed");
      setSaveStatus("error");
    }
  }, [activeCard, handleSaveAs, saveCardToPath]);

  const handleCreateCard = useCallback(() => {
    if (workspaceRoot) {
      const input = window.prompt("New file name", `Untitled.${defaultSaveExt}`);
      if (!input) return;

      const fileName = ensureWorkspaceFileName(input, defaultSaveExt);
      const relativePath = joinWorkspacePath(selectedWorkspaceDir, fileName);
      invoke<string>("create_workspace_entry", { root: workspaceRoot, relativePath, kind: "file" })
        .then(async (path) => {
          await loadWorkspaceDirectory(selectedWorkspaceDir);
          await openMarkdownFile(path);
        })
        .catch((error) => {
          console.error("Failed to create workspace file", error);
          setWorkspaceError("Create file failed");
        });
      return;
    }

    const card = createCard();
    setCards((currentCards) => [card, ...currentCards]);
    setActiveCardId(card.id);
  }, [defaultSaveExt, loadWorkspaceDirectory, openMarkdownFile, selectedWorkspaceDir, workspaceRoot]);

  const handleCreateWorkspaceFolder = useCallback(() => {
    if (!workspaceRoot) return;

    const input = window.prompt("New folder name", "New Folder");
    if (!input) return;

    const relativePath = joinWorkspacePath(selectedWorkspaceDir, input);
    invoke("create_workspace_entry", { root: workspaceRoot, relativePath, kind: "directory" })
      .then(() => loadWorkspaceDirectory(selectedWorkspaceDir))
      .catch((error) => {
        console.error("Failed to create workspace folder", error);
        setWorkspaceError("Create folder failed");
      });
  }, [loadWorkspaceDirectory, selectedWorkspaceDir, workspaceRoot]);

  const handleRenameWorkspaceEntry = useCallback((entry: WorkspaceTreeEntry) => {
    if (!workspaceRoot || !entry.relativePath) return;

    const nextName = window.prompt("Rename", entry.name);
    if (!nextName || nextName === entry.name) return;

    invoke<string>("rename_workspace_entry", { root: workspaceRoot, relativePath: entry.relativePath, newName: nextName })
      .then(async (nextPath) => {
        await loadWorkspaceDirectory(parentWorkspaceDir(entry.relativePath));
        if (activeCard.filePath === entry.path) {
          await openMarkdownFile(nextPath);
        }
      })
      .catch((error) => {
        console.error("Failed to rename workspace entry", error);
        setWorkspaceError("Rename failed");
      });
  }, [activeCard.filePath, loadWorkspaceDirectory, openMarkdownFile, workspaceRoot]);

  const handleDeleteWorkspaceEntry = useCallback((entry: WorkspaceTreeEntry) => {
    if (!workspaceRoot || !entry.relativePath) return;
    if (!window.confirm(`Delete ${entry.name}? This will delete it from disk.`)) return;

    invoke("delete_workspace_entry", { root: workspaceRoot, relativePath: entry.relativePath })
      .then(async () => {
        await loadWorkspaceDirectory(parentWorkspaceDir(entry.relativePath));
        if (isSameOrChildPath(activeCard.filePath, entry.path)) {
          const card = createCard();
          setCards([card]);
          setActiveCardId(card.id);
          setLastOpenedFile(null);
        }
      })
      .catch((error) => {
        console.error("Failed to delete workspace entry", error);
        setWorkspaceError("Delete failed");
      });
  }, [activeCard.filePath, loadWorkspaceDirectory, workspaceRoot]);

  const focusEditor = useCallback(() => {
    if (editorMode === "plain") {
      plainEditorRef.current?.focus();
      return;
    }

    const proseMirror = editorSurfaceRef.current?.querySelector<HTMLElement>(".ProseMirror");
    proseMirror?.focus();
  }, [editorMode]);

  const runEditorCommand = useCallback((action: EditorCommandAction, payload?: string) => {
    if (!activeCard) return;

    if (editorMode === "plain") {
      const textarea = plainEditorRef.current;
      if (!textarea) return;

      const result = applyPlainEditorCommand(
        activeCard.markdown,
        textarea.selectionStart,
        textarea.selectionEnd,
        action,
        payload,
      );

      setCards((currentCards) => currentCards.map((card) => {
        if (card.id !== activeCard.id) return card;
        const title = extractFirstLineTitle(result.markdown);
        return {
          ...card,
          title: title ?? card.title,
          markdown: result.markdown,
          updatedAt: new Date().toISOString(),
        };
      }));

      window.requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
      });
      return;
    }

    richCommandIdRef.current += 1;
    setRichCommand({ id: richCommandIdRef.current, action, payload });
  }, [activeCard, editorMode]);

  const runLinkCommand = useCallback(() => {
    const href = window.prompt("Link URL", "https://");
    if (!href) return;
    runEditorCommand("link", href);
  }, [runEditorCommand]);

  const handleFind = useCallback(() => {
    if (!activeCard) return;
    const query = window.prompt("Find", "");
    if (!query) return;

    if (editorMode === "plain") {
      const textarea = plainEditorRef.current;
      if (!textarea) return;

      const startFrom = textarea.selectionEnd;
      const index = activeCard.markdown.indexOf(query, startFrom);
      const wrappedIndex = index === -1 ? activeCard.markdown.indexOf(query) : index;
      if (wrappedIndex === -1) {
        window.alert("No matches found");
        return;
      }

      textarea.focus();
      textarea.setSelectionRange(wrappedIndex, wrappedIndex + query.length);
      return;
    }

    focusEditor();
    const found = (window as Window & { find?: (...args: unknown[]) => boolean }).find?.(
      query,
      false,
      false,
      true,
      false,
      false,
      false,
    ) ?? false;
    if (!found) window.alert("No matches found");
  }, [activeCard, editorMode, focusEditor]);

  const commands = useMemo<Record<string, CommandDefinition>>(() => ({
    "file.new": {
      id: "file.new",
      label: "New card",
      enabled: true,
      run: handleCreateCard,
    },
    "file.open": {
      id: "file.open",
      label: "Open file",
      enabled: true,
      run: handleOpenFile,
    },
    "file.openWorkspace": {
      id: "file.openWorkspace",
      label: "Open workspace",
      enabled: true,
      run: handleOpenWorkspace,
    },
    "file.save": {
      id: "file.save",
      label: "Save file",
      enabled: Boolean(activeCard),
      run: handleSave,
    },
    "file.saveAs": {
      id: "file.saveAs",
      label: "Save as",
      enabled: Boolean(activeCard),
      run: handleSaveAs,
    },
    "file.export": {
      id: "file.export",
      label: "Export",
      enabled: Boolean(activeCard),
      run: handleSaveAs,
    },
    "app.openSettings": {
      id: "app.openSettings",
      label: "Open settings",
      enabled: true,
      run: () => {
        setSettingsSection("general");
        setSettingsOpen(true);
      },
    },
    "app.openShortcuts": {
      id: "app.openShortcuts",
      label: "Open shortcuts",
      enabled: true,
      run: () => {
        setSettingsSection("shortcuts");
        setSettingsOpen(true);
      },
    },
    "app.about": {
      id: "app.about",
      label: "About",
      enabled: true,
      run: () => window.alert("YS Writer 0.1.0"),
    },
    "edit.cut": {
      id: "edit.cut",
      label: "Cut",
      enabled: true,
      run: () => {
        focusEditor();
        document.execCommand("cut");
      },
    },
    "edit.copy": {
      id: "edit.copy",
      label: "Copy",
      enabled: true,
      run: () => {
        focusEditor();
        document.execCommand("copy");
      },
    },
    "edit.paste": {
      id: "edit.paste",
      label: "Paste",
      enabled: true,
      run: () => {
        focusEditor();
        document.execCommand("paste");
      },
    },
    "edit.undo": {
      id: "edit.undo",
      label: "Undo",
      enabled: true,
      run: () => {
        focusEditor();
        document.execCommand("undo");
      },
    },
    "edit.redo": {
      id: "edit.redo",
      label: "Redo",
      enabled: true,
      run: () => {
        focusEditor();
        document.execCommand("redo");
      },
    },
    "edit.selectAll": {
      id: "edit.selectAll",
      label: "Select all",
      enabled: true,
      run: () => runEditorCommand("selectAllSmart"),
    },
    "edit.find": {
      id: "edit.find",
      label: "Find",
      enabled: Boolean(activeCard),
      run: handleFind,
    },
    "paragraph.text": {
      id: "paragraph.text",
      label: "Text",
      enabled: Boolean(activeCard),
      run: () => runEditorCommand("paragraph"),
    },
    "paragraph.heading1": {
      id: "paragraph.heading1",
      label: "Heading 1",
      enabled: Boolean(activeCard),
      run: () => runEditorCommand("heading1"),
    },
    "paragraph.heading2": {
      id: "paragraph.heading2",
      label: "Heading 2",
      enabled: Boolean(activeCard),
      run: () => runEditorCommand("heading2"),
    },
    "paragraph.heading3": {
      id: "paragraph.heading3",
      label: "Heading 3",
      enabled: Boolean(activeCard),
      run: () => runEditorCommand("heading3"),
    },
    "paragraph.blockquote": {
      id: "paragraph.blockquote",
      label: "Quote",
      enabled: Boolean(activeCard),
      run: () => runEditorCommand("blockquote"),
    },
    "paragraph.bulletList": {
      id: "paragraph.bulletList",
      label: "Bullet list",
      enabled: Boolean(activeCard),
      run: () => runEditorCommand("bulletList"),
    },
    "paragraph.orderedList": {
      id: "paragraph.orderedList",
      label: "Ordered list",
      enabled: Boolean(activeCard),
      run: () => runEditorCommand("orderedList"),
    },
    "paragraph.codeBlock": {
      id: "paragraph.codeBlock",
      label: "Code block",
      enabled: Boolean(activeCard),
      run: () => runEditorCommand("codeBlock"),
    },
    "format.bold": {
      id: "format.bold",
      label: "Bold",
      enabled: Boolean(activeCard),
      run: () => runEditorCommand("bold"),
    },
    "format.italic": {
      id: "format.italic",
      label: "Italic",
      enabled: Boolean(activeCard),
      run: () => runEditorCommand("italic"),
    },
    "format.inlineCode": {
      id: "format.inlineCode",
      label: "Inline code",
      enabled: Boolean(activeCard),
      run: () => runEditorCommand("inlineCode"),
    },
    "format.strike": {
      id: "format.strike",
      label: "Strikethrough",
      enabled: Boolean(activeCard),
      run: () => runEditorCommand("strike"),
    },
    "format.link": {
      id: "format.link",
      label: "Link",
      enabled: Boolean(activeCard),
      run: runLinkCommand,
    },
    "view.setPlainEdit": {
      id: "view.setPlainEdit",
      label: "Plain Edit",
      enabled: editorMode !== "plain",
      run: () => setEditorMode("plain"),
    },
    "view.setRichEdit": {
      id: "view.setRichEdit",
      label: "Rich Edit",
      enabled: editorMode !== "rich",
      run: () => setEditorMode("rich"),
    },
    "view.toggleSidebar": {
      id: "view.toggleSidebar",
      label: "Toggle sidebar",
      enabled: true,
      run: () => setSidebarVisible((visible) => !visible),
    },
    "view.toggleOutline": {
      id: "view.toggleOutline",
      label: "Toggle outline",
      enabled: true,
      run: () => setOutlineVisible((visible) => !visible),
    },
    "theme.daily": {
      id: "theme.daily",
      label: "Daily",
      enabled: theme !== "daily",
      run: () => setTheme("daily"),
    },
    "theme.eye": {
      id: "theme.eye",
      label: "Eye Care",
      enabled: theme !== "eye",
      run: () => setTheme("eye"),
    },
    "theme.mint": {
      id: "theme.mint",
      label: "Mint",
      enabled: theme !== "mint",
      run: () => setTheme("mint"),
    },
    "theme.ink": {
      id: "theme.ink",
      label: "Dark",
      enabled: theme !== "ink",
      run: () => setTheme("ink"),
    },
  }), [
    activeCard,
    editorMode,
    focusEditor,
    handleCreateCard,
    handleFind,
    handleOpenFile,
    handleOpenWorkspace,
    handleSave,
    handleSaveAs,
    runEditorCommand,
    runLinkCommand,
    theme,
  ]);

  const dispatchCommand = useCallback(async (commandId: string) => {
    const command = commands[commandId];
    if (!command?.enabled) return;
    await command.run();
    setOpenMenuId(null);
  }, [commands]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        if (workspaceRoot) {
          clearDraftWorkspace();
          return;
        }

        const nextSavedAt = writeWorkspace(cards, true);
        setSavedAt(nextSavedAt);
        setSaveError(null);
      } catch (error) {
        console.error("Failed to autosave workspace", error);
        setSaveError("Autosave failed");
      }
    }, 700);

    return () => window.clearTimeout(timeout);
  }, [cards, workspaceRoot]);

  useEffect(() => {
    if (restoredWorkspaceRef.current || !workspaceRoot) return;
    restoredWorkspaceRef.current = true;

    if (workspaceRecoveryBlocked) {
      setWorkspaceError("Workspace recovery is paused after a previous load failure. Reopen or clear the workspace.");
      setWorkspaceTree({
        name: pathFileName(workspaceRoot),
        path: workspaceRoot,
        relativePath: "",
        kind: "directory",
        fileExt: null,
        children: [],
        loaded: false,
        loading: false,
        hasMore: false,
        truncated: false,
        loadError: "Recovery paused",
      });
      return;
    }

    loadWorkspaceDirectory("", workspaceRoot).then((rootDirectory) => {
      if (rootDirectory) void prefetchInitialDirectories(workspaceRoot, rootDirectory);
    });
    if (lastOpenedFile) {
      openMarkdownFile(lastOpenedFile).catch((error) => {
        console.error("Failed to restore last opened file", error);
        setWorkspaceError("Last file failed to restore");
      });
    }
  }, [lastOpenedFile, loadWorkspaceDirectory, openMarkdownFile, prefetchInitialDirectories, workspaceRecoveryBlocked, workspaceRoot]);

  useEffect(() => {
    writeSettings({
      theme,
      uiDensity,
      sidebarWidth,
      sidebarVisible,
      outlineVisible,
      workspaceRoot,
      lastOpenedFile,
      selectedWorkspaceDir,
      workspaceRecoveryBlocked,
      defaultEditorMode: defaultEditorModeSetting,
      restoreWorkspace,
      editorFontSize,
      editorLineHeight,
      editorLeftGap,
      uiScale,
      zoomWithWheel,
      defaultSaveExt,
    });
  }, [
    theme,
    uiDensity,
    sidebarWidth,
    sidebarVisible,
    outlineVisible,
    workspaceRoot,
    lastOpenedFile,
    selectedWorkspaceDir,
    workspaceRecoveryBlocked,
    defaultEditorModeSetting,
    restoreWorkspace,
    editorFontSize,
    editorLineHeight,
    editorLeftGap,
    uiScale,
    zoomWithWheel,
    defaultSaveExt,
  ]);

  useEffect(() => {
    writeShortcuts(shortcuts);
  }, [shortcuts]);

  useEffect(() => {
    if (!zoomWithWheel) return undefined;

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      setUiScale((current) => clampUiScale(current + (event.deltaY < 0 ? 5 : -5)));
    };

    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => window.removeEventListener("wheel", handleWheel);
  }, [zoomWithWheel]);

  useEffect(() => {
    if (saveStatus === "idle") return undefined;

    const timeout = window.setTimeout(() => setSaveStatus("idle"), 1200);
    return () => window.clearTimeout(timeout);
  }, [saveStatus]);

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (!openMenuId) return;
      if (menuBarRef.current?.contains(event.target as Node)) return;
      setOpenMenuId(null);
    };

    window.addEventListener("mousedown", handleMouseDown);
    return () => window.removeEventListener("mousedown", handleMouseDown);
  }, [openMenuId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenuId(null);
        setSettingsOpen(false);
        return;
      }

      const key = shortcutFromEvent(event);
      if (!key) return;

      if ((key === "Ctrl+A" || key === "Meta+A") && selectRichCodeBlockDom(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const shortcut = shortcuts.find((item) => item.enabled && item.currentKeys.includes(key));
      if (!shortcut) return;

      if (isEditorTarget(event.target) && (shortcut.commandId === "edit.undo" || shortcut.commandId === "edit.redo")) {
        return;
      }

      if (
        isFormTarget(event.target)
        && shortcut.commandId !== "file.save"
        && shortcut.commandId !== "file.saveAs"
        && shortcut.commandId !== "file.open"
        && shortcut.commandId !== "file.openWorkspace"
        && shortcut.commandId !== "file.new"
        && shortcut.commandId !== "edit.selectAll"
        && shortcut.commandId !== "app.openSettings"
      ) {
        return;
      }

      const command = commands[shortcut.commandId];
      if (!command?.enabled) return;

      event.preventDefault();
      dispatchCommand(shortcut.commandId);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [commands, dispatchCommand, shortcuts]);

  const handleOutlineClick = useCallback((index: number) => {
    if (editorMode === "plain") {
      const target = getHeadingOffsets(activeCard.markdown)[index];
      if (!target) return;

      plainEditorRef.current?.focus();
      plainEditorRef.current?.setSelectionRange(target.start, target.end);
      return;
    }

    const headings = editorSurfaceRef.current?.querySelectorAll(".milkdown h1, .milkdown h2, .milkdown h3");
    const heading = headings?.item(index);
    heading?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [activeCard.markdown, editorMode]);

  const handleSidebarPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setSidebarWidth(clampSidebarWidth(startWidth + moveEvent.clientX - startX));
    };

    const handlePointerUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }, [sidebarWidth]);

  const handleShortcutInputBlur = useCallback((shortcutId: string) => {
    const nextKeys = normalizeShortcutList(shortcutEdits[shortcutId] ?? "");
    setShortcuts((current) => current.map((shortcut) => (
      shortcut.id === shortcutId ? { ...shortcut, currentKeys: nextKeys } : shortcut
    )));
    setShortcutEdits((current) => ({ ...current, [shortcutId]: nextKeys.join(", ") }));
  }, [shortcutEdits]);

  const handleShortcutRestore = useCallback((shortcutId: string) => {
    setShortcuts((current) => current.map((shortcut) => (
      shortcut.id === shortcutId ? { ...shortcut, currentKeys: shortcut.defaultKeys, enabled: true } : shortcut
    )));
    setShortcutEdits((current) => {
      const shortcut = defaultShortcutRegistry.find((item) => item.id === shortcutId);
      return shortcut ? { ...current, [shortcutId]: shortcut.defaultKeys.join(", ") } : current;
    });
  }, []);

  const handleShortcutRestoreAll = useCallback(() => {
    setShortcuts(defaultShortcutRegistry);
    setShortcutEdits(Object.fromEntries(defaultShortcutRegistry.map((shortcut) => [shortcut.id, shortcut.defaultKeys.join(", ")])));
  }, []);

  const updateShortcutEnabled = useCallback((shortcutId: string, enabled: boolean) => {
    setShortcuts((current) => current.map((shortcut) => (
      shortcut.id === shortcutId ? { ...shortcut, enabled } : shortcut
    )));
  }, []);

  const clearWorkspaceState = useCallback(() => {
    setWorkspaceRoot(null);
    setWorkspaceTree(null);
    setWorkspaceError(null);
    setWorkspaceRecoveryBlocked(false);
    setSelectedWorkspaceDir("");
    setLastOpenedFile(null);
    setExpandedDirs(new Set([""]));
    const card = createCard();
    setCards([card]);
    setActiveCardId(card.id);
  }, []);

  const handleWorkspaceDirectoryClick = useCallback((entry: WorkspaceTreeEntry) => {
    setSelectedWorkspaceDir(entry.relativePath);
    if (entry.relativePath === "") return;

    const isExpanded = expandedDirs.has(entry.relativePath);
    if (isExpanded) {
      setExpandedDirs((current) => {
        const next = new Set(current);
        next.delete(entry.relativePath);
        return next;
      });
      return;
    }

    setExpandedDirs((current) => new Set(current).add(entry.relativePath));
    if (!entry.loaded && !entry.loading) {
      loadWorkspaceDirectory(entry.relativePath);
    }
  }, [expandedDirs, loadWorkspaceDirectory]);

  const modeCommandId = editorMode === "plain" ? "view.setRichEdit" : "view.setPlainEdit";
  const renderWorkspaceEntry = (entry: WorkspaceTreeEntry, depth = 0) => (
    <div key={entry.path} className="workspace-entry">
      <div
        className={[
          "workspace-row",
          entry.kind,
          entry.path === activeCard.filePath ? "active" : "",
          entry.kind === "directory" && entry.relativePath === selectedWorkspaceDir ? "selected" : "",
        ].filter(Boolean).join(" ")}
        style={{ "--tree-depth": depth } as CSSProperties}
      >
        <button
          type="button"
          className="workspace-name"
          onClick={() => {
            if (entry.kind === "directory") {
              handleWorkspaceDirectoryClick(entry);
            } else {
              openMarkdownFile(entry.path).catch((error) => {
                console.error("Failed to open workspace file", error);
                setWorkspaceError("Open file failed");
              });
            }
          }}
        >
          <span className="workspace-disclosure" aria-hidden="true">
            {entry.kind === "directory"
              ? (entry.loading ? "..." : (entry.relativePath === "" || expandedDirs.has(entry.relativePath) ? "▾" : "▸"))
              : "·"}
          </span>
          <span className="workspace-label" title={entry.name}>{entry.name}</span>
        </button>
        {entry.relativePath ? (
          <div className="workspace-actions">
            <button type="button" title="Rename" onClick={() => handleRenameWorkspaceEntry(entry)}>R</button>
            <button type="button" title="Delete" onClick={() => handleDeleteWorkspaceEntry(entry)}>D</button>
          </div>
        ) : null}
      </div>
      {entry.loadError ? (
        <p className="workspace-entry-note" style={{ "--tree-depth": depth } as CSSProperties}>
          {entry.loadError}
        </p>
      ) : null}
      {entry.truncated ? (
        <p className="workspace-entry-note" style={{ "--tree-depth": depth } as CSSProperties}>
          已限制加载数量，请缩小范围。
        </p>
      ) : null}
      {entry.kind === "directory" && (entry.relativePath === "" || expandedDirs.has(entry.relativePath)) && entry.children.length ? (
        <div className="workspace-children">
          {entry.children.map((child) => renderWorkspaceEntry(child, depth + 1))}
        </div>
      ) : null}
    </div>
  );

  return (
    <div
      className="desktop-shell"
      data-theme={theme}
      data-density={uiDensity}
      data-sidebar={sidebarVisible ? "visible" : "hidden"}
      style={{
        "--sidebar-width": `${sidebarWidth}px`,
        "--ui-scale": String(uiScale / 100),
        "--editor-font-size": `${editorFontSize * (uiScale / 100)}px`,
        "--editor-line-height": String(editorLineHeight),
        "--editor-left-gap": `${editorLeftGap}px`,
      } as CSSProperties}
    >
      <div className="app-chrome">
        <header
          className="window-titlebar"
          aria-label="Window title bar"
          data-tauri-drag-region
          onMouseDown={handleTitlebarMouseDown}
          onDoubleClick={handleTitlebarDoubleClick}
        >
          <strong className="window-title" data-tauri-drag-region>YS Writer</strong>
          <div className="titlebar-drag-region" data-tauri-drag-region />
          <div className="window-controls" aria-label="Window controls">
            <button type="button" aria-label="Minimize window" onClick={() => handleWindowAction("minimize")}>-</button>
            <button type="button" aria-label="Maximize window" onClick={() => handleWindowAction("maximize")}>□</button>
            <button type="button" className="close" aria-label="Close window" onClick={() => handleWindowAction("close")}>×</button>
          </div>
        </header>

        <header ref={menuBarRef} className="menu-bar" aria-label="Application menu">
          <div className="menu-left">
            <nav className="main-menu" aria-label="Main menu">
              {menuGroups.map((group) => (
                <div key={group.id} className="menu-root">
                  <button
                    type="button"
                    aria-expanded={openMenuId === group.id}
                    className={openMenuId === group.id ? "menu-root-button open" : "menu-root-button"}
                    onMouseDown={(event) => {
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpenMenuId(group.id);
                    }}
                    onMouseEnter={() => {
                      setOpenMenuId((current) => (current ? group.id : current));
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      setOpenMenuId(group.id);
                    }}
                  >
                    {group.label}
                  </button>
                  {openMenuId === group.id ? (
                    <div className="menu-popover" role="menu">
                      {group.items.map((item) => {
                        const command = item.commandId ? commands[item.commandId] : null;
                        const disabled = item.disabled || !command?.enabled;

                        return (
                          <button
                            key={`${group.id}-${item.label}`}
                            type="button"
                            role="menuitem"
                            disabled={disabled}
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={() => {
                              if (item.commandId) dispatchCommand(item.commandId);
                            }}
                          >
                            <span>{item.label}</span>
                            <kbd>{getShortcutForCommand(shortcuts, item.commandId)}</kbd>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ))}
            </nav>
          </div>

          <div className="menu-status">
            <span>{saveStatus === "saved" ? "Saved" : saveError ?? (savedAt ? `Autosaved ${formatTime(savedAt)}` : "Local draft")}</span>
            <button type="button" onClick={() => dispatchCommand(modeCommandId)}>
              {editorMode === "plain" ? "Rich Edit" : "Plain Edit"}
            </button>
            <button type="button" onClick={() => dispatchCommand("app.openSettings")}>Settings</button>
          </div>
        </header>
      </div>

      {sidebarVisible ? (
        <aside className="left-rail">
          {workspaceMode ? (
            <>
              <div className="panel-heading">
                <span>Workspace</span>
                <button type="button" onClick={() => dispatchCommand("file.openWorkspace")}>Open</button>
              </div>
              <div className="workspace-root" title={workspaceRoot ?? ""}>
                {workspaceTree?.name ?? "No workspace"}
              </div>
              <div className="workspace-toolbar">
                <button type="button" onClick={() => dispatchCommand("file.new")}>New file</button>
                <button type="button" onClick={handleCreateWorkspaceFolder}>New folder</button>
              </div>
              {workspaceError ? <p className="workspace-error">{workspaceError}</p> : null}
              <nav className="workspace-tree" aria-label="Workspace files">
                {workspaceTree ? renderWorkspaceEntry(workspaceTree) : <p className="muted">Loading workspace...</p>}
                {workspaceRecoveryBlocked ? (
                  <button type="button" className="workspace-clear" onClick={clearWorkspaceState}>
                    Clear workspace state
                  </button>
                ) : null}
              </nav>
            </>
          ) : (
            <>
              <div className="panel-heading">
                <span>Cards</span>
                <button type="button" onClick={() => dispatchCommand("file.new")}>+</button>
              </div>
              <nav className="card-list" aria-label="Card list">
                {cards.map((card) => (
                  <button
                    key={card.id}
                    type="button"
                    className={card.id === activeCard.id ? "card-item active" : "card-item"}
                    onClick={() => setActiveCardId(card.id)}
                  >
                    <strong>{card.title}</strong>
                    <span>{card.filePath ?? card.markdown.split("\n").find((line) => line.trim() && !line.startsWith("#")) ?? "Markdown card"}</span>
                  </button>
                ))}
              </nav>
            </>
          )}

          {outlineVisible ? (
            <>
              <div className="panel-heading compact">
                <span>Outline</span>
              </div>
              <div className="outline-list">
                {outline.length ? outline.map((item, index) => (
                  <button
                    key={`${item.text}-${index}`}
                    type="button"
                    className={`outline-item level-${item.level}`}
                    onClick={() => handleOutlineClick(index)}
                  >
                    {item.text}
                  </button>
                )) : <p className="muted">No headings</p>}
              </div>
            </>
          ) : null}
        </aside>
      ) : null}

      {sidebarVisible ? (
        <div
          className="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onPointerDown={handleSidebarPointerDown}
        />
      ) : null}

      <main className="editor-column">
        <section ref={editorSurfaceRef} className="editor-surface" aria-label="Markdown editor">
          {editorMode === "plain" ? (
            <textarea
              ref={plainEditorRef}
              className="markdown-editor"
              value={activeCard.markdown}
              onChange={(event) => handleMarkdownChange(event.target.value)}
              spellCheck
            />
          ) : (
            <Suspense fallback={<div className="editor-loading">Loading rich editor...</div>}>
              <MilkdownEditor
                key={activeCard.id}
                markdown={activeCard.markdown}
                onChange={handleMarkdownChange}
                command={richCommand}
              />
            </Suspense>
          )}
        </section>
      </main>

      {settingsOpen ? (
        <div className="settings-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <section className="settings-panel" role="dialog" aria-modal="true" aria-label="Settings" onMouseDown={(event) => event.stopPropagation()}>
            <div className="settings-header">
              <h2>Settings</h2>
              <button type="button" onClick={() => setSettingsOpen(false)}>Close</button>
            </div>

            <div className="settings-layout">
              <nav className="settings-nav" aria-label="Settings sections">
                {settingsSections.map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    className={settingsSection === section.id ? "selected" : ""}
                    onClick={() => setSettingsSection(section.id)}
                  >
                    {section.label}
                  </button>
                ))}
              </nav>

              <div className="settings-content">
                {settingsSection === "general" ? (
                  <div className="settings-section">
                    <h3>General</h3>
                    <label className="settings-field">
                      <span>Default edit mode</span>
                      <select
                        value={defaultEditorModeSetting}
                        onChange={(event) => setDefaultEditorModeSetting(event.target.value as EditorMode)}
                      >
                        <option value="plain">Plain Edit</option>
                        <option value="rich">Rich Edit</option>
                      </select>
                    </label>
                    <label className="settings-check">
                      <input
                        type="checkbox"
                        checked={restoreWorkspace}
                        onChange={(event) => setRestoreWorkspace(event.target.checked)}
                      />
                      Restore last workspace on startup
                    </label>
                    <label className="settings-check">
                      <input
                        type="checkbox"
                        checked={sidebarVisible}
                        onChange={(event) => setSidebarVisible(event.target.checked)}
                      />
                      Show sidebar
                    </label>
                    <label className="settings-check">
                      <input
                        type="checkbox"
                        checked={outlineVisible}
                        onChange={(event) => setOutlineVisible(event.target.checked)}
                      />
                      Show outline panel
                    </label>
                  </div>
                ) : null}

                {settingsSection === "editor" ? (
                  <div className="settings-section">
                    <h3>Editor</h3>
                    <label className="settings-field">
                      <span>Font size</span>
                      <input
                        type="number"
                        min={14}
                        max={24}
                        value={editorFontSize}
                        onChange={(event) => setEditorFontSize(Number(event.target.value))}
                      />
                    </label>
                    <label className="settings-field">
                      <span>Line height</span>
                      <input
                        type="number"
                        min={1.4}
                        max={2.2}
                        step={0.05}
                        value={editorLineHeight}
                        onChange={(event) => setEditorLineHeight(Number(event.target.value))}
                      />
                    </label>
                    <label className="settings-field">
                      <span>UI font scale</span>
                      <input
                        type="number"
                        min={MIN_UI_SCALE}
                        max={MAX_UI_SCALE}
                        step={5}
                        value={uiScale}
                        onChange={(event) => setUiScale(clampUiScale(Number(event.target.value)))}
                      />
                    </label>
                    <label className="settings-check">
                      <input
                        type="checkbox"
                        checked={zoomWithWheel}
                        onChange={(event) => setZoomWithWheel(event.target.checked)}
                      />
                      Ctrl + mouse wheel changes font scale
                    </label>
                    <label className="settings-check">
                      <input
                        type="checkbox"
                        checked={outlineVisible}
                        onChange={(event) => setOutlineVisible(event.target.checked)}
                      />
                      Show Outline
                    </label>
                    <label className="settings-field">
                      <span>Layout left gap</span>
                      <input
                        type="number"
                        min={MIN_EDITOR_LEFT_GAP}
                        max={MAX_EDITOR_LEFT_GAP}
                        value={editorLeftGap}
                        onChange={(event) => setEditorLeftGap(clampEditorLeftGap(Number(event.target.value)))}
                      />
                    </label>
                    <label className="settings-field">
                      <span>Sidebar width</span>
                      <input
                        type="number"
                        min={MIN_SIDEBAR_WIDTH}
                        max={MAX_SIDEBAR_WIDTH}
                        value={sidebarWidth}
                        onChange={(event) => setSidebarWidth(clampSidebarWidth(Number(event.target.value)))}
                      />
                    </label>
                    <button
                      type="button"
                      className="settings-secondary"
                      onClick={() => {
                        setEditorFontSize(defaultSettings.editorFontSize);
                        setEditorLineHeight(defaultSettings.editorLineHeight);
                        setEditorLeftGap(defaultSettings.editorLeftGap);
                        setUiScale(defaultSettings.uiScale);
                        setSidebarWidth(defaultSettings.sidebarWidth);
                      }}
                    >
                      Reset editor layout
                    </button>
                  </div>
                ) : null}

                {settingsSection === "shortcuts" ? (
                  <div className="settings-section">
                    <div className="settings-section-title">
                      <h3>Shortcuts</h3>
                      <button type="button" onClick={handleShortcutRestoreAll}>Restore defaults</button>
                    </div>
                    {shortcutConflicts.size ? (
                      <p className="shortcut-warning">
                        Shortcut conflict: {Array.from(shortcutConflicts.keys()).join(", ")}
                      </p>
                    ) : null}
                    <div className="shortcut-table">
                      {shortcuts.map((shortcut) => {
                        const rowConflicts = shortcut.currentKeys.some((key) => shortcutConflicts.has(key));

                        return (
                          <div key={shortcut.id} className={rowConflicts ? "shortcut-row conflict" : "shortcut-row"}>
                            <div>
                              <strong>{shortcut.label}</strong>
                              <span>{shortcut.category} · {shortcut.commandId}</span>
                            </div>
                            <input
                              value={shortcutEdits[shortcut.id] ?? ""}
                              disabled={!shortcut.editable}
                              aria-label={`${shortcut.label} shortcut`}
                              onChange={(event) => setShortcutEdits((current) => ({ ...current, [shortcut.id]: event.target.value }))}
                              onKeyDown={(event) => {
                                event.stopPropagation();
                                if (event.key === "Enter") {
                                  event.currentTarget.blur();
                                }
                              }}
                              onBlur={() => handleShortcutInputBlur(shortcut.id)}
                            />
                            <label className="shortcut-enabled">
                              <input
                                type="checkbox"
                                checked={shortcut.enabled}
                                onChange={(event) => updateShortcutEnabled(shortcut.id, event.target.checked)}
                              />
                              Enabled
                            </label>
                            <button type="button" onClick={() => handleShortcutRestore(shortcut.id)}>Default</button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {settingsSection === "appearance" ? (
                  <div className="settings-section">
                    <h3>Appearance</h3>
                    <div className="theme-options">
                      <button type="button" className={theme === "daily" ? "theme-option selected" : "theme-option"} onClick={() => dispatchCommand("theme.daily")}>
                        <span className="theme-swatch daily" />
                        <strong>Daily</strong>
                        <span>Warm paper</span>
                      </button>
                      <button type="button" className={theme === "eye" ? "theme-option selected" : "theme-option"} onClick={() => dispatchCommand("theme.eye")}>
                        <span className="theme-swatch eye" />
                        <strong>Eye Care</strong>
                        <span>Soft green</span>
                      </button>
                      <button type="button" className={theme === "mint" ? "theme-option selected" : "theme-option"} onClick={() => dispatchCommand("theme.mint")}>
                        <span className="theme-swatch mint" />
                        <strong>Mint</strong>
                        <span>v6 aqua glass</span>
                      </button>
                      <button type="button" className={theme === "ink" ? "theme-option selected" : "theme-option"} onClick={() => dispatchCommand("theme.ink")}>
                        <span className="theme-swatch ink" />
                        <strong>Dark</strong>
                        <span>Typora-like dark</span>
                      </button>
                    </div>
                    <label className="settings-field">
                      <span>Interface density</span>
                      <select
                        value={uiDensity}
                        onChange={(event) => setUiDensity(event.target.value as UIDensity)}
                      >
                        <option value="comfortable">Comfortable</option>
                        <option value="compact">Compact</option>
                      </select>
                    </label>
                  </div>
                ) : null}

                {settingsSection === "files" ? (
                  <div className="settings-section">
                    <h3>Files</h3>
                    <label className="settings-field">
                      <span>Default save format</span>
                      <select
                        value={defaultSaveExt}
                        onChange={(event) => setDefaultSaveExt(event.target.value as SaveFileExt)}
                      >
                        <option value="md">.md</option>
                        <option value="txt">.txt</option>
                      </select>
                    </label>
                    <p>Workspace drafts: <code>{WORKSPACE_STORAGE_KEY}</code></p>
                    <p>Workspace root: <code>{workspaceRoot ?? "None"}</code></p>
                    <p>Last opened file: <code>{lastOpenedFile ?? "None"}</code></p>
                    <button type="button" className="settings-danger" onClick={clearWorkspaceState}>
                      Clear last workspace state
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
