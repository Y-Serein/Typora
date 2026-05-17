import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  MAX_EDITOR_LEFT_GAP,
  MAX_RIGHT_PANEL_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MAX_UI_SCALE,
  MIN_EDITOR_LEFT_GAP,
  MIN_RIGHT_PANEL_WIDTH,
  MIN_SIDEBAR_WIDTH,
  MIN_UI_SCALE,
  VAULT_DIRECTORY_LIMIT,
  defaultSettings,
  settingsSections,
} from "./app/defaults";
import { APP_NAME } from "./app/metadata";
import {
  appLanguages,
  appText,
  editorCjkFontOptions,
  editorFontSizeOptions,
  editorLatinFontOptions,
} from "./app/i18n";
import type { AppLanguage } from "./app/i18n";
import type {
  CommandDefinition,
  EditorMode,
  SaveFileExt,
  SaveStatus,
  SettingsSection,
  ThemeStyle,
  UIDensity,
  VaultDirectoryResponse,
  VaultTreeEntry,
  VaultWorkspaceState,
} from "./app/types";
import {
  defaultShortcutRegistry,
  findShortcutConflicts,
  getShortcutForCommand,
  menuGroups,
  normalizeShortcutList,
  readShortcuts,
  shortcutFromEvent,
  writeShortcuts,
} from "./command/shortcuts";
import type { ShortcutEntry } from "./command/shortcuts";
import type { EditorCommandAction, EditorCommandSignal, Note } from "./domain/model";
import { applyPlainEditorCommand } from "./editor/plainCommands";
import { directoryFromResponse, updateVaultNode } from "./explorer/tree";
import {
  createVaultEntry,
  deleteVaultEntry,
  initVault,
  readMarkdownFile,
  readVaultIndexFiles,
  readVaultDirectory,
  renameVaultEntry,
  writeMarkdownFile,
  writeVaultWorkspaceState,
} from "./fs/tauriFs";
import {
  clampEditorLeftGap,
  clampRightPanelWidth,
  clampSidebarWidth,
  clampUiScale,
  normalizeDefaultNewNoteName,
  normalizeEditorFontFamily,
  readSettings,
  writeSettings,
} from "./settings/storage";
import {
  countDocumentText,
  ensureSaveExtension,
  extractFirstLineTitle,
  extractOutline,
  formatTime,
  getHeadingOffsets,
  isSameOrChildPath,
  joinVaultPath,
  normalizeFilePath,
  parentVaultDir,
  pathFileName,
  stripExtension,
  vaultFileNameCandidate,
} from "./shared/markdown";
import { buildVaultIndex, createLocalGraph, findIndexedFile, getBacklinks } from "./vault/index";
import type { VaultIndex } from "./vault/index";
import {
  createDraftNote,
  createFileNote,
  isEmptyDraft,
  mergeWorkspaceState,
  nextWorkspaceState,
  pushRecentFile,
} from "./vault/workspace";
import "./styles.css";

const MilkdownEditor = lazy(() => import("./components/MilkdownEditor").then((module) => ({
  default: module.MilkdownEditor,
})));

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

function isWindowDragBlockedTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    && Boolean(target.closest("button, input, textarea, select, [role='menu'], .menu-popover, .window-controls"));
}

function titleFromMarkdown(markdown: string, fallback: string) {
  return extractFirstLineTitle(markdown) ?? fallback;
}

function quoteCssFontFamily(fontFamily: string) {
  return `"${fontFamily.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

type LeftPanelTab = "files" | "outline";
type KnowledgePanelTab = "backlinks" | "graph";
type VaultIndexStatus = "idle" | "indexing" | "ready" | "error";
type AppDialog = {
  id: number;
  kind: "input" | "confirm" | "alert";
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
};
type AppDialogResult = string | boolean | null;

export default function App() {
  const [initialSettings] = useState(readSettings);
  const [initialShortcuts] = useState(readShortcuts);
  const [notes, setNotes] = useState<Note[]>(() => [createDraftNote()]);
  const [activeNoteId, setActiveNoteId] = useState(notes[0]?.id ?? "");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [editorMode, setEditorMode] = useState<EditorMode>(initialSettings.defaultEditorMode);
  const [language, setLanguage] = useState<AppLanguage>(initialSettings.language);
  const [theme, setTheme] = useState<ThemeStyle>(initialSettings.theme);
  const [uiDensity, setUiDensity] = useState<UIDensity>(initialSettings.uiDensity);
  const [sidebarWidth, setSidebarWidth] = useState(initialSettings.sidebarWidth);
  const [sidebarVisible, setSidebarVisible] = useState(initialSettings.sidebarVisible);
  const [rightPanelVisible, setRightPanelVisible] = useState(initialSettings.rightPanelVisible);
  const [rightPanelWidth, setRightPanelWidth] = useState(initialSettings.rightPanelWidth);
  const [vaultRoot, setVaultRoot] = useState<string | null>(initialSettings.restoreWorkspace ? initialSettings.vaultRoot : null);
  const [vaultTree, setVaultTree] = useState<VaultTreeEntry | null>(null);
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [vaultIndex, setVaultIndex] = useState<VaultIndex | null>(null);
  const [vaultIndexStatus, setVaultIndexStatus] = useState<VaultIndexStatus>("idle");
  const [vaultIndexError, setVaultIndexError] = useState<string | null>(null);
  const [leftPanelTab, setLeftPanelTab] = useState<LeftPanelTab>("files");
  const [knowledgePanelTab, setKnowledgePanelTab] = useState<KnowledgePanelTab>("backlinks");
  const [knowledgePanelFloating, setKnowledgePanelFloating] = useState(false);
  const [floatingPanelPosition, setFloatingPanelPosition] = useState({ x: 920, y: 112 });
  const [selectedVaultDir, setSelectedVaultDir] = useState(initialSettings.selectedVaultDir);
  const [lastOpenedFile, setLastOpenedFile] = useState<string | null>(initialSettings.lastOpenedFile);
  const [vaultRecoveryBlocked, setVaultRecoveryBlocked] = useState(initialSettings.vaultRecoveryBlocked);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set([""]));
  const [vaultWorkspace, setVaultWorkspace] = useState<VaultWorkspaceState>(() => mergeWorkspaceState(null, {
    sidebarWidth: initialSettings.sidebarWidth,
    sidebarVisible: initialSettings.sidebarVisible,
    rightPanelVisible: initialSettings.rightPanelVisible,
    rightPanelWidth: initialSettings.rightPanelWidth,
    editorLeftGap: initialSettings.editorLeftGap,
    uiScale: initialSettings.uiScale,
  }));
  const [defaultEditorModeSetting, setDefaultEditorModeSetting] = useState<EditorMode>(initialSettings.defaultEditorMode);
  const [restoreWorkspace, setRestoreWorkspace] = useState(initialSettings.restoreWorkspace);
  const [editorLatinFont, setEditorLatinFont] = useState(initialSettings.editorLatinFont);
  const [editorCjkFont, setEditorCjkFont] = useState(initialSettings.editorCjkFont);
  const [editorFontSize, setEditorFontSize] = useState(initialSettings.editorFontSize);
  const [editorLineHeight, setEditorLineHeight] = useState(initialSettings.editorLineHeight);
  const [editorLeftGap, setEditorLeftGap] = useState(initialSettings.editorLeftGap);
  const [uiScale, setUiScale] = useState(initialSettings.uiScale);
  const [zoomWithWheel, setZoomWithWheel] = useState(initialSettings.zoomWithWheel);
  const [richCommand, setRichCommand] = useState<EditorCommandSignal | null>(null);
  const [defaultSaveExt, setDefaultSaveExt] = useState<SaveFileExt>(initialSettings.defaultSaveExt);
  const [defaultNewNoteName, setDefaultNewNoteName] = useState(initialSettings.defaultNewNoteName);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [appDialog, setAppDialog] = useState<AppDialog | null>(null);
  const [appDialogInput, setAppDialogInput] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [shortcuts, setShortcuts] = useState<ShortcutEntry[]>(initialShortcuts);
  const [shortcutEdits, setShortcutEdits] = useState<Record<string, string>>(
    () => Object.fromEntries(initialShortcuts.map((shortcut) => [shortcut.id, shortcut.currentKeys.join(", ")])),
  );
  const menuBarRef = useRef<HTMLElement | null>(null);
  const appDialogInputRef = useRef<HTMLInputElement | null>(null);
  const appDialogResolverRef = useRef<((value: AppDialogResult) => void) | null>(null);
  const editorSurfaceRef = useRef<HTMLElement | null>(null);
  const plainEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const restoredVaultRef = useRef(false);
  const richCommandIdRef = useRef(0);
  const vaultIndexRefreshIdRef = useRef(0);
  const windowActionPendingRef = useRef(false);

  const activeNote = notes.find((note) => note.id === activeNoteId) ?? notes[0];
  const t = appText[language];
  const outline = useMemo(() => extractOutline(activeNote.markdown), [activeNote.markdown]);
  const activeIndexedFile = useMemo(() => findIndexedFile(vaultIndex, activeNote.filePath), [activeNote.filePath, vaultIndex]);
  const activeBacklinks = useMemo(() => getBacklinks(vaultIndex, activeNote.filePath), [activeNote.filePath, vaultIndex]);
  const activeOutgoingLinks = activeIndexedFile?.outgoingLinks ?? [];
  const activeResolvedLinks = activeOutgoingLinks.filter((link) => link.targetPath);
  const activeUnresolvedLinks = activeOutgoingLinks.filter((link) => !link.targetPath);
  const localGraph = useMemo(() => createLocalGraph(vaultIndex, activeNote.filePath), [activeNote.filePath, vaultIndex]);
  const localGraphNodeMap = useMemo(
    () => new Map(localGraph.nodes.map((node) => [normalizeFilePath(node.path), node])),
    [localGraph.nodes],
  );
  const shortcutConflicts = useMemo(() => findShortcutConflicts(shortcuts), [shortcuts]);
  const vaultMode = Boolean(vaultRoot);
  const windowTitle = `${activeNote.dirty ? "● " : ""}${activeNote.fileName ?? activeNote.title} — ${APP_NAME}`;
  const textStats = useMemo(() => countDocumentText(activeNote.markdown), [activeNote.markdown]);
  const lineCount = useMemo(() => activeNote.markdown.split(/\r?\n/).length, [activeNote.markdown]);

  const persistVaultPatch = useCallback((patch: Partial<VaultWorkspaceState>) => {
    setVaultWorkspace((current) => nextWorkspaceState(current, patch));
  }, []);

  const closeAppDialog = useCallback((result: AppDialogResult) => {
    const resolve = appDialogResolverRef.current;
    appDialogResolverRef.current = null;
    setAppDialog(null);
    setAppDialogInput("");
    resolve?.(result);
  }, []);

  const showInputDialog = useCallback((title: string, defaultValue = "", message?: string) => (
    new Promise<string | null>((resolve) => {
      appDialogResolverRef.current = (value) => resolve(typeof value === "string" ? value : null);
      setAppDialogInput(defaultValue);
      setAppDialog({
        id: Date.now(),
        kind: "input",
        title,
        message,
        confirmLabel: t.dialog.ok,
        cancelLabel: t.dialog.cancel,
      });
    })
  ), [t.dialog.cancel, t.dialog.ok]);

  const showConfirmDialog = useCallback((title: string, message: string, danger = false) => (
    new Promise<boolean>((resolve) => {
      appDialogResolverRef.current = (value) => resolve(value === true);
      setAppDialog({
        id: Date.now(),
        kind: "confirm",
        title,
        message,
        confirmLabel: danger ? t.dialog.deleteConfirm : t.dialog.confirm,
        cancelLabel: t.dialog.cancel,
        danger,
      });
    })
  ), [t.dialog.cancel, t.dialog.confirm, t.dialog.deleteConfirm]);

  const showMessageDialog = useCallback((title: string, message?: string) => (
    new Promise<void>((resolve) => {
      appDialogResolverRef.current = () => resolve();
      setAppDialog({
        id: Date.now(),
        kind: "alert",
        title,
        message,
        confirmLabel: t.dialog.close,
      });
    })
  ), [t.dialog.close]);

  const handleWindowAction = useCallback((action: "minimize" | "maximize" | "close") => {
    const run = async () => {
      if (windowActionPendingRef.current) return;
      windowActionPendingRef.current = true;

      try {
        const currentWindow = getCurrentWindow();
        if (action === "minimize") await currentWindow.minimize();
        if (action === "maximize") {
          const maximized = await currentWindow.isMaximized();
          if (maximized) {
            await currentWindow.unmaximize();
          } else {
            await currentWindow.maximize();
          }
        }
        if (action === "close") await currentWindow.close();
      } catch (error) {
        console.warn("Window action is only available inside Tauri", error);
      } finally {
        windowActionPendingRef.current = false;
      }
    };

    void run();
  }, []);

  const handleChromeDragMouseDown = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0 || event.detail > 1) return;
    if (isWindowDragBlockedTarget(event.target)) return;

    try {
      void getCurrentWindow().startDragging();
    } catch (error) {
      console.warn("Window dragging is only available inside Tauri", error);
    }
  }, []);

  const handleChromeDoubleClick = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (isWindowDragBlockedTarget(event.target)) return;
    handleWindowAction("maximize");
  }, [handleWindowAction]);

  const handleMarkdownChange = useCallback((markdown: string) => {
    setNotes((currentNotes) => currentNotes.map((note) => {
      if (note.id !== activeNoteId) return note;
      return {
        ...note,
        title: titleFromMarkdown(markdown, note.title),
        markdown,
        updatedAt: new Date().toISOString(),
        dirty: true,
      };
    }));
  }, [activeNoteId]);

  const loadVaultDirectory = useCallback(async (relativePath = "", root = vaultRoot) => {
    if (!root) {
      setVaultTree(null);
      return null;
    }

    setVaultTree((current) => {
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
        ? updateVaultNode(current, relativePath, (entry) => ({ ...entry, loading: true, loadError: null }))
        : current;
    });

    try {
      const directory = await readVaultDirectory(root, relativePath, VAULT_DIRECTORY_LIMIT);
      const nextDirectory = directoryFromResponse(directory);
      setVaultTree((current) => {
        if (!current || relativePath === "") return nextDirectory;
        return updateVaultNode(current, relativePath, () => nextDirectory);
      });
      setVaultError(null);
      setVaultRecoveryBlocked(false);
      return directory;
    } catch (error) {
      console.error("Failed to read vault directory", error);
      const message = relativePath ? t.errors.readDirectoryFailed : t.errors.vaultLoadFailed;
      setVaultError(message);
      if (relativePath === "") setVaultRecoveryBlocked(true);
      setVaultTree((current) => (
        current
          ? updateVaultNode(current, relativePath, (entry) => ({ ...entry, loading: false, loadError: message }))
          : current
      ));
      return null;
    }
  }, [t.errors.readDirectoryFailed, t.errors.vaultLoadFailed, vaultRoot]);

  const refreshVaultIndex = useCallback(async (root = vaultRoot) => {
    if (!root) {
      setVaultIndex(null);
      setVaultIndexStatus("idle");
      setVaultIndexError(null);
      return;
    }

    const refreshId = vaultIndexRefreshIdRef.current + 1;
    vaultIndexRefreshIdRef.current = refreshId;
    setVaultIndexStatus("indexing");
    setVaultIndexError(null);

    try {
      const response = await readVaultIndexFiles(root);
      if (vaultIndexRefreshIdRef.current !== refreshId) return;
      setVaultIndex(buildVaultIndex(root, response));
      setVaultIndexStatus("ready");
    } catch (error) {
      if (vaultIndexRefreshIdRef.current !== refreshId) return;
      console.error("Failed to index vault", error);
      setVaultIndex(null);
      setVaultIndexStatus("error");
      setVaultIndexError(t.errors.vaultIndexFailed);
    }
  }, [t.errors.vaultIndexFailed, vaultRoot]);

  const prefetchInitialDirectories = useCallback(async (root: string, rootDirectory: VaultDirectoryResponse) => {
    let loadedCount = 0;
    const rootDirs = rootDirectory.children.filter((entry) => entry.kind === "directory");

    for (const directory of rootDirs) {
      if (loadedCount >= 3) return;

      setExpandedDirs((current) => new Set(current).add(directory.relativePath));
      const response = await loadVaultDirectory(directory.relativePath, root);
      loadedCount += 1;

      const firstChildDir = response?.children.find((entry) => entry.kind === "directory");
      if (!firstChildDir || loadedCount >= 3) continue;

      setExpandedDirs((current) => new Set(current).add(firstChildDir.relativePath));
      await loadVaultDirectory(firstChildDir.relativePath, root);
      loadedCount += 1;
    }
  }, [loadVaultDirectory]);

  const applyOpenedFile = useCallback((file: Awaited<ReturnType<typeof readMarkdownFile>>) => {
    const nextNote = createFileNote(file);

    setNotes((currentNotes) => {
      if (vaultRoot) return [nextNote];

      if (activeNote && isEmptyDraft(activeNote)) {
        return currentNotes.map((note) => (note.id === activeNote.id ? nextNote : note));
      }

      return [nextNote, ...currentNotes.filter((note) => note.filePath !== nextNote.filePath)];
    });
    setActiveNoteId(nextNote.id);
    setLastOpenedFile(nextNote.filePath ?? null);
    persistVaultPatch({
      lastOpenedFile: nextNote.filePath ?? null,
      recentFiles: pushRecentFile(vaultWorkspace.recentFiles, nextNote.filePath ?? null),
    });
    setSaveError(null);
    setSaveStatus("saved");
  }, [activeNote, persistVaultPatch, vaultRoot, vaultWorkspace.recentFiles]);

  const openMarkdownFile = useCallback(async (path: string) => {
    const file = await readMarkdownFile(path);
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
      setSaveError(t.errors.openFileFailed);
      setSaveStatus("error");
    }
  }, [openMarkdownFile, t.errors.openFileFailed]);

  const activateVault = useCallback(async (root: string) => {
    const initialized = await initVault(root);
    const workspace = mergeWorkspaceState(initialized.workspace, {
      sidebarWidth,
      sidebarVisible,
      rightPanelVisible,
      rightPanelWidth,
      editorLeftGap,
      uiScale,
    });

    setVaultRoot(initialized.root);
    setVaultWorkspace(workspace);
    setSelectedVaultDir(workspace.selectedDir);
    setLastOpenedFile(workspace.lastOpenedFile);
    setSidebarWidth(clampSidebarWidth(workspace.layout.sidebarWidth));
    setSidebarVisible(workspace.layout.sidebarVisible);
    setRightPanelVisible(workspace.layout.rightPanelVisible);
    setRightPanelWidth(clampRightPanelWidth(workspace.layout.rightPanelWidth));
    setEditorLeftGap(clampEditorLeftGap(workspace.layout.editorLeftGap));
    setUiScale(clampUiScale(workspace.layout.uiScale));
    setVaultRecoveryBlocked(false);
    setExpandedDirs(new Set(workspace.expandedDirs.length ? workspace.expandedDirs : [""]));
    const draft = createDraftNote();
    setNotes([draft]);
    setActiveNoteId(draft.id);

    const rootDirectory = await loadVaultDirectory("", initialized.root);
    void refreshVaultIndex(initialized.root);
    if (rootDirectory) void prefetchInitialDirectories(initialized.root, rootDirectory);
    if (workspace.lastOpenedFile) {
      openMarkdownFile(workspace.lastOpenedFile).catch((error) => {
        console.error("Failed to restore last opened file", error);
        setVaultError(t.errors.restoreLastFileFailed);
      });
    }
  }, [
    editorLeftGap,
    loadVaultDirectory,
    openMarkdownFile,
    prefetchInitialDirectories,
    refreshVaultIndex,
    rightPanelVisible,
    rightPanelWidth,
    sidebarVisible,
    sidebarWidth,
    t.errors.restoreLastFileFailed,
    uiScale,
  ]);

  const handleOpenVault = useCallback(async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (!selected || Array.isArray(selected)) return;
      await activateVault(selected);
    } catch (error) {
      console.error("Failed to open vault", error);
      setVaultError(t.errors.openVaultFailed);
    }
  }, [activateVault, t.errors.openVaultFailed]);

  const saveNoteToPath = useCallback(async (note: Note, path: string) => {
    const normalizedPath = ensureSaveExtension(path, defaultSaveExt);
    const file = await writeMarkdownFile(normalizedPath, note.markdown);
    const nextNote: Note = {
      ...note,
      title: stripExtension(file.fileName) || extractFirstLineTitle(note.markdown) || note.title,
      filePath: file.path,
      fileName: file.fileName,
      fileExt: file.fileExt,
      updatedAt: new Date().toISOString(),
      dirty: false,
    };

    setNotes((currentNotes) => currentNotes.map((item) => (item.id === note.id ? nextNote : item)));
    setLastOpenedFile(nextNote.filePath ?? null);
    persistVaultPatch({
      lastOpenedFile: nextNote.filePath ?? null,
      recentFiles: pushRecentFile(vaultWorkspace.recentFiles, nextNote.filePath ?? null),
    });
    if (vaultRoot) {
      await loadVaultDirectory(selectedVaultDir);
      await refreshVaultIndex(vaultRoot);
    }
    setSavedAt(new Date());
    setSaveError(null);
    setSaveStatus("saved");
  }, [defaultSaveExt, loadVaultDirectory, persistVaultPatch, refreshVaultIndex, selectedVaultDir, vaultRoot, vaultWorkspace.recentFiles]);

  const handleSaveAs = useCallback(async () => {
    if (!activeNote) return;

    try {
      const fallbackName = `${activeNote.fileName ? stripExtension(activeNote.fileName) : activeNote.title || "Untitled"}.${defaultSaveExt}`;
      const selected = await save({
        defaultPath: fallbackName,
        filters: [{ name: "Markdown/Text", extensions: ["md", "markdown", "txt"] }],
      });

      if (!selected) return;
      await saveNoteToPath(activeNote, selected);
    } catch (error) {
      console.error("Failed to save file as", error);
      setSaveError(t.errors.saveAsFailed);
      setSaveStatus("error");
    }
  }, [activeNote, defaultSaveExt, saveNoteToPath, t.errors.saveAsFailed]);

  const handleSave = useCallback(async () => {
    if (!activeNote) return;

    try {
      if (activeNote.filePath) {
        await saveNoteToPath(activeNote, activeNote.filePath);
      } else {
        await handleSaveAs();
      }
    } catch (error) {
      console.error("Failed to save file", error);
      setSaveError(t.errors.saveFailed);
      setSaveStatus("error");
    }
  }, [activeNote, handleSaveAs, saveNoteToPath, t.errors.saveFailed]);

  const createVaultNoteFromDefaultName = useCallback(async () => {
    if (!vaultRoot) return;

    const baseName = normalizeDefaultNewNoteName(defaultNewNoteName);

    for (let index = 0; index < 100; index += 1) {
      const fileName = vaultFileNameCandidate(baseName, defaultSaveExt, index);
      const relativePath = joinVaultPath(selectedVaultDir, fileName);

      try {
        const path = await createVaultEntry(vaultRoot, relativePath, "file");
        const title = stripExtension(fileName).trim() || t.sidebar.markdownNote;
        const file = await writeMarkdownFile(path, `# ${title}\n\n`);
        await loadVaultDirectory(selectedVaultDir);
        await refreshVaultIndex(vaultRoot);
        applyOpenedFile(file);
        return;
      } catch (error) {
        if (String(error).includes("already exists")) continue;
        throw error;
      }
    }

    throw new Error(t.errors.tooManyDefaultNames);
  }, [
    defaultNewNoteName,
    defaultSaveExt,
    applyOpenedFile,
    loadVaultDirectory,
    refreshVaultIndex,
    selectedVaultDir,
    t.errors.tooManyDefaultNames,
    t.sidebar.markdownNote,
    vaultRoot,
  ]);

  const handleCreateNote = useCallback(() => {
    if (vaultRoot) {
      createVaultNoteFromDefaultName()
        .catch((error) => {
          console.error("Failed to create vault file", error);
          setVaultError(t.errors.createFileFailed);
        });
      return;
    }

    const note = createDraftNote(defaultNewNoteName, defaultSaveExt);
    setNotes((currentNotes) => [note, ...currentNotes]);
    setActiveNoteId(note.id);
  }, [createVaultNoteFromDefaultName, defaultNewNoteName, defaultSaveExt, t.errors.createFileFailed, vaultRoot]);

  const handleCreateVaultFolder = useCallback(async () => {
    if (!vaultRoot) return;

    const input = await showInputDialog(t.prompts.newFolderName, t.prompts.defaultNewFolderName);
    if (!input) return;

    const relativePath = joinVaultPath(selectedVaultDir, input);
    createVaultEntry(vaultRoot, relativePath, "directory")
      .then(async () => {
        await loadVaultDirectory(selectedVaultDir);
        await refreshVaultIndex(vaultRoot);
      })
      .catch((error) => {
        console.error("Failed to create vault folder", error);
        setVaultError(t.errors.createFolderFailed);
      });
  }, [
    loadVaultDirectory,
    refreshVaultIndex,
    selectedVaultDir,
    showInputDialog,
    t.errors.createFolderFailed,
    t.prompts.defaultNewFolderName,
    t.prompts.newFolderName,
    vaultRoot,
  ]);

  const handleRenameVaultEntry = useCallback(async (entry: VaultTreeEntry) => {
    if (!vaultRoot || !entry.relativePath) return;

    const nextName = await showInputDialog(t.prompts.rename, entry.name);
    if (!nextName || nextName === entry.name) return;

    renameVaultEntry(vaultRoot, entry.relativePath, nextName)
      .then(async (nextPath) => {
        await loadVaultDirectory(parentVaultDir(entry.relativePath));
        await refreshVaultIndex(vaultRoot);
        if (activeNote.filePath === entry.path) {
          await openMarkdownFile(nextPath);
        }
      })
      .catch((error) => {
        console.error("Failed to rename vault entry", error);
        setVaultError(t.errors.renameFailed);
      });
  }, [activeNote.filePath, loadVaultDirectory, openMarkdownFile, refreshVaultIndex, showInputDialog, t.errors.renameFailed, t.prompts.rename, vaultRoot]);

  const handleDeleteVaultEntry = useCallback(async (entry: VaultTreeEntry) => {
    if (!vaultRoot || !entry.relativePath) return;
    const confirmed = await showConfirmDialog(t.prompts.deleteAction, t.prompts.deleteEntry(entry.name), true);
    if (!confirmed) return;

    deleteVaultEntry(vaultRoot, entry.relativePath)
      .then(async () => {
        await loadVaultDirectory(parentVaultDir(entry.relativePath));
        await refreshVaultIndex(vaultRoot);
        if (isSameOrChildPath(activeNote.filePath, entry.path)) {
          const note = createDraftNote();
          setNotes([note]);
          setActiveNoteId(note.id);
          setLastOpenedFile(null);
          persistVaultPatch({ lastOpenedFile: null });
        }
      })
      .catch((error) => {
        console.error("Failed to delete vault entry", error);
        setVaultError(t.errors.deleteFailed);
      });
  }, [activeNote.filePath, loadVaultDirectory, persistVaultPatch, refreshVaultIndex, showConfirmDialog, t.errors.deleteFailed, t.prompts, vaultRoot]);

  const focusEditor = useCallback(() => {
    if (editorMode === "plain") {
      plainEditorRef.current?.focus();
      return;
    }

    const proseMirror = editorSurfaceRef.current?.querySelector<HTMLElement>(".ProseMirror");
    proseMirror?.focus();
  }, [editorMode]);

  const runEditorCommand = useCallback((action: EditorCommandAction, payload?: string) => {
    if (!activeNote) return;

    if (editorMode === "plain") {
      const textarea = plainEditorRef.current;
      if (!textarea) return;

      const result = applyPlainEditorCommand(
        activeNote.markdown,
        textarea.selectionStart,
        textarea.selectionEnd,
        action,
        payload,
      );

      setNotes((currentNotes) => currentNotes.map((note) => {
        if (note.id !== activeNote.id) return note;
        return {
          ...note,
          title: titleFromMarkdown(result.markdown, note.title),
          markdown: result.markdown,
          updatedAt: new Date().toISOString(),
          dirty: true,
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
  }, [activeNote, editorMode]);

  const runLinkCommand = useCallback(async () => {
    const href = await showInputDialog(t.prompts.linkUrl, "https://");
    if (!href) return;
    runEditorCommand("link", href);
  }, [runEditorCommand, showInputDialog, t.prompts.linkUrl]);

  const handleFind = useCallback(async () => {
    if (!activeNote) return;
    const query = await showInputDialog(t.prompts.find, "");
    if (!query) return;

    if (editorMode === "plain") {
      const textarea = plainEditorRef.current;
      if (!textarea) return;

      const startFrom = textarea.selectionEnd;
      const index = activeNote.markdown.indexOf(query, startFrom);
      const wrappedIndex = index === -1 ? activeNote.markdown.indexOf(query) : index;
      if (wrappedIndex === -1) {
        await showMessageDialog(t.prompts.noMatches);
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
    if (!found) await showMessageDialog(t.prompts.noMatches);
  }, [activeNote, editorMode, focusEditor, showInputDialog, showMessageDialog, t.prompts.find, t.prompts.noMatches]);

  const commands = useMemo<Record<string, CommandDefinition>>(() => ({
    "file.new": { id: "file.new", label: t.commandLabels["file.new"], enabled: true, run: handleCreateNote },
    "file.newFolder": { id: "file.newFolder", label: t.commandLabels["file.newFolder"], enabled: Boolean(vaultRoot), run: handleCreateVaultFolder },
    "file.open": { id: "file.open", label: t.commandLabels["file.open"], enabled: true, run: handleOpenFile },
    "file.openVault": { id: "file.openVault", label: t.commandLabels["file.openVault"], enabled: true, run: handleOpenVault },
    "file.save": { id: "file.save", label: t.commandLabels["file.save"], enabled: Boolean(activeNote), run: handleSave },
    "file.saveAs": { id: "file.saveAs", label: t.commandLabels["file.saveAs"], enabled: Boolean(activeNote), run: handleSaveAs },
    "file.export": { id: "file.export", label: t.commandLabels["file.export"], enabled: Boolean(activeNote), run: handleSaveAs },
    "app.openSettings": {
      id: "app.openSettings",
      label: t.commandLabels["app.openSettings"],
      enabled: true,
      run: () => {
        setSettingsSection("general");
        setSettingsOpen(true);
      },
    },
    "app.openShortcuts": {
      id: "app.openShortcuts",
      label: t.commandLabels["app.openShortcuts"],
      enabled: true,
      run: () => {
        setSettingsSection("shortcuts");
        setSettingsOpen(true);
      },
    },
    "app.about": { id: "app.about", label: t.commandLabels["app.about"], enabled: true, run: () => showMessageDialog(t.commandLabels["app.about"], t.prompts.about) },
    "edit.cut": { id: "edit.cut", label: t.commandLabels["edit.cut"], enabled: true, run: () => { focusEditor(); document.execCommand("cut"); } },
    "edit.copy": { id: "edit.copy", label: t.commandLabels["edit.copy"], enabled: true, run: () => { focusEditor(); document.execCommand("copy"); } },
    "edit.paste": { id: "edit.paste", label: t.commandLabels["edit.paste"], enabled: true, run: () => { focusEditor(); document.execCommand("paste"); } },
    "edit.undo": { id: "edit.undo", label: t.commandLabels["edit.undo"], enabled: true, run: () => { focusEditor(); document.execCommand("undo"); } },
    "edit.redo": { id: "edit.redo", label: t.commandLabels["edit.redo"], enabled: true, run: () => { focusEditor(); document.execCommand("redo"); } },
    "edit.selectAll": { id: "edit.selectAll", label: t.commandLabels["edit.selectAll"], enabled: true, run: () => runEditorCommand("selectAllSmart") },
    "edit.find": { id: "edit.find", label: t.commandLabels["edit.find"], enabled: Boolean(activeNote), run: handleFind },
    "paragraph.text": { id: "paragraph.text", label: t.commandLabels["paragraph.text"], enabled: Boolean(activeNote), run: () => runEditorCommand("paragraph") },
    "paragraph.heading1": { id: "paragraph.heading1", label: t.commandLabels["paragraph.heading1"], enabled: Boolean(activeNote), run: () => runEditorCommand("heading1") },
    "paragraph.heading2": { id: "paragraph.heading2", label: t.commandLabels["paragraph.heading2"], enabled: Boolean(activeNote), run: () => runEditorCommand("heading2") },
    "paragraph.heading3": { id: "paragraph.heading3", label: t.commandLabels["paragraph.heading3"], enabled: Boolean(activeNote), run: () => runEditorCommand("heading3") },
    "paragraph.blockquote": { id: "paragraph.blockquote", label: t.commandLabels["paragraph.blockquote"], enabled: Boolean(activeNote), run: () => runEditorCommand("blockquote") },
    "paragraph.bulletList": { id: "paragraph.bulletList", label: t.commandLabels["paragraph.bulletList"], enabled: Boolean(activeNote), run: () => runEditorCommand("bulletList") },
    "paragraph.orderedList": { id: "paragraph.orderedList", label: t.commandLabels["paragraph.orderedList"], enabled: Boolean(activeNote), run: () => runEditorCommand("orderedList") },
    "paragraph.codeBlock": { id: "paragraph.codeBlock", label: t.commandLabels["paragraph.codeBlock"], enabled: Boolean(activeNote), run: () => runEditorCommand("codeBlock") },
    "format.bold": { id: "format.bold", label: t.commandLabels["format.bold"], enabled: Boolean(activeNote), run: () => runEditorCommand("bold") },
    "format.italic": { id: "format.italic", label: t.commandLabels["format.italic"], enabled: Boolean(activeNote), run: () => runEditorCommand("italic") },
    "format.inlineCode": { id: "format.inlineCode", label: t.commandLabels["format.inlineCode"], enabled: Boolean(activeNote), run: () => runEditorCommand("inlineCode") },
    "format.strike": { id: "format.strike", label: t.commandLabels["format.strike"], enabled: Boolean(activeNote), run: () => runEditorCommand("strike") },
    "format.link": { id: "format.link", label: t.commandLabels["format.link"], enabled: Boolean(activeNote), run: runLinkCommand },
    "view.setPlainEdit": { id: "view.setPlainEdit", label: t.commandLabels["view.setPlainEdit"], enabled: editorMode !== "plain", run: () => setEditorMode("plain") },
    "view.setRichEdit": { id: "view.setRichEdit", label: t.commandLabels["view.setRichEdit"], enabled: editorMode !== "rich", run: () => setEditorMode("rich") },
    "view.toggleSidebar": { id: "view.toggleSidebar", label: t.commandLabels["view.toggleSidebar"], enabled: true, run: () => setSidebarVisible((visible) => !visible) },
    "view.toggleRightPanel": { id: "view.toggleRightPanel", label: t.commandLabels["view.toggleRightPanel"], enabled: true, run: () => setRightPanelVisible((visible) => !visible) },
    "theme.daily": { id: "theme.daily", label: t.commandLabels["theme.daily"], enabled: theme !== "daily", run: () => setTheme("daily") },
    "theme.eye": { id: "theme.eye", label: t.commandLabels["theme.eye"], enabled: theme !== "eye", run: () => setTheme("eye") },
    "theme.mint": { id: "theme.mint", label: t.commandLabels["theme.mint"], enabled: theme !== "mint", run: () => setTheme("mint") },
    "theme.ink": { id: "theme.ink", label: t.commandLabels["theme.ink"], enabled: theme !== "ink", run: () => setTheme("ink") },
  }), [
    activeNote,
    editorMode,
    focusEditor,
    handleCreateVaultFolder,
    handleCreateNote,
    handleFind,
    handleOpenFile,
    handleOpenVault,
    handleSave,
    handleSaveAs,
    runEditorCommand,
    runLinkCommand,
    showMessageDialog,
    t,
    theme,
  ]);

  const dispatchCommand = useCallback(async (commandId: string) => {
    const command = commands[commandId];
    if (!command?.enabled) return;
    await command.run();
    setOpenMenuId(null);
  }, [commands]);

  useEffect(() => {
    if (restoredVaultRef.current || !vaultRoot) return;
    restoredVaultRef.current = true;

    if (vaultRecoveryBlocked) {
      setVaultError(t.errors.recoveryPaused);
      setVaultTree({
        name: pathFileName(vaultRoot),
        path: vaultRoot,
        relativePath: "",
        kind: "directory",
        fileExt: null,
        children: [],
        loaded: false,
        loading: false,
        hasMore: false,
        truncated: false,
        loadError: t.errors.recoveryPausedLabel,
      });
      return;
    }

    activateVault(vaultRoot).catch((error) => {
      console.error("Failed to restore vault", error);
      setVaultError(t.errors.restoreVaultFailed);
      setVaultRecoveryBlocked(true);
    });
  }, [activateVault, t.errors.recoveryPaused, t.errors.recoveryPausedLabel, t.errors.restoreVaultFailed, vaultRecoveryBlocked, vaultRoot]);

  useEffect(() => {
    writeSettings({
      theme,
      language,
      uiDensity,
      sidebarWidth,
      sidebarVisible,
      rightPanelVisible,
      rightPanelWidth,
      vaultRoot,
      lastOpenedFile,
      selectedVaultDir,
      vaultRecoveryBlocked,
      defaultEditorMode: defaultEditorModeSetting,
      restoreWorkspace,
      editorLatinFont: normalizeEditorFontFamily(editorLatinFont, defaultSettings.editorLatinFont),
      editorCjkFont: normalizeEditorFontFamily(editorCjkFont, defaultSettings.editorCjkFont),
      editorFontSize,
      editorLineHeight,
      editorLeftGap,
      uiScale,
      zoomWithWheel,
      defaultSaveExt,
      defaultNewNoteName: normalizeDefaultNewNoteName(defaultNewNoteName),
    });
  }, [
    defaultEditorModeSetting,
    defaultNewNoteName,
    defaultSaveExt,
    editorCjkFont,
    editorFontSize,
    editorLatinFont,
    editorLeftGap,
    editorLineHeight,
    language,
    lastOpenedFile,
    restoreWorkspace,
    rightPanelWidth,
    rightPanelVisible,
    selectedVaultDir,
    sidebarVisible,
    sidebarWidth,
    theme,
    uiDensity,
    uiScale,
    vaultRecoveryBlocked,
    vaultRoot,
    zoomWithWheel,
  ]);

  useEffect(() => {
    writeShortcuts(shortcuts);
  }, [shortcuts]);

  useEffect(() => {
    if (!appDialog || appDialog.kind !== "input") return undefined;
    const frame = window.requestAnimationFrame(() => {
      appDialogInputRef.current?.focus();
      appDialogInputRef.current?.select();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [appDialog]);

  useEffect(() => {
    persistVaultPatch({
      selectedDir: selectedVaultDir,
      expandedDirs: Array.from(expandedDirs),
      lastOpenedFile,
      layout: {
        sidebarWidth,
        sidebarVisible,
        rightPanelVisible,
        rightPanelWidth,
        editorLeftGap,
        uiScale,
      },
    });
  }, [
    editorLeftGap,
    expandedDirs,
    lastOpenedFile,
    persistVaultPatch,
    rightPanelWidth,
    rightPanelVisible,
    selectedVaultDir,
    sidebarVisible,
    sidebarWidth,
    uiScale,
  ]);

  useEffect(() => {
    if (!vaultRoot) return undefined;

    const timeout = window.setTimeout(() => {
      writeVaultWorkspaceState(vaultRoot, vaultWorkspace)
        .catch((error) => {
          console.error("Failed to write vault workspace state", error);
          setVaultError(t.errors.workspaceSaveFailed);
        });
    }, 450);

    return () => window.clearTimeout(timeout);
  }, [t.errors.workspaceSaveFailed, vaultRoot, vaultWorkspace]);

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
        if (appDialog) {
          closeAppDialog(null);
          return;
        }
        setOpenMenuId(null);
        setSettingsOpen(false);
        return;
      }

      if (appDialog) return;

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
        && shortcut.commandId !== "file.openVault"
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
  }, [appDialog, closeAppDialog, commands, dispatchCommand, shortcuts]);

  const handleOutlineClick = useCallback((index: number) => {
    if (editorMode === "plain") {
      const target = getHeadingOffsets(activeNote.markdown)[index];
      if (!target) return;

      plainEditorRef.current?.focus();
      plainEditorRef.current?.setSelectionRange(target.start, target.end);
      return;
    }

    const headings = editorSurfaceRef.current?.querySelectorAll(".milkdown h1, .milkdown h2, .milkdown h3, .milkdown h4, .milkdown h5, .milkdown h6");
    const heading = headings?.item(index);
    heading?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [activeNote.markdown, editorMode]);

  const handleGraphNodeClick = useCallback((path: string) => {
    const file = vaultIndex?.filesByPath.get(normalizeFilePath(path));
    if (!file) return;
    openMarkdownFile(file.path).catch((error) => {
      console.error("Failed to open graph node", error);
      setVaultError(t.errors.openGraphNodeFailed);
    });
  }, [openMarkdownFile, t.errors.openGraphNodeFailed, vaultIndex]);

  const handleFloatingPanelPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if (event.target instanceof HTMLElement && event.target.closest("button")) return;

    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startPosition = floatingPanelPosition;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "move";
    document.body.style.userSelect = "none";

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const maxX = Math.max(window.innerWidth - 320, 12);
      const maxY = Math.max(window.innerHeight - 220, 72);
      setFloatingPanelPosition({
        x: Math.min(Math.max(startPosition.x + moveEvent.clientX - startX, 12), maxX),
        y: Math.min(Math.max(startPosition.y + moveEvent.clientY - startY, 72), maxY),
      });
    };

    const handlePointerUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }, [floatingPanelPosition]);

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

  const handleRightPanelPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = rightPanelWidth;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setRightPanelWidth(clampRightPanelWidth(startWidth - (moveEvent.clientX - startX)));
    };

    const handlePointerUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }, [rightPanelWidth]);

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

  const clearVaultState = useCallback(() => {
    setVaultRoot(null);
    setVaultTree(null);
    setVaultError(null);
    setVaultIndex(null);
    setVaultIndexStatus("idle");
    setVaultIndexError(null);
    setVaultRecoveryBlocked(false);
    setSelectedVaultDir("");
    setLastOpenedFile(null);
    setExpandedDirs(new Set([""]));
    const note = createDraftNote();
    setNotes([note]);
    setActiveNoteId(note.id);
    restoredVaultRef.current = false;
  }, []);

  const handleVaultDirectoryClick = useCallback((entry: VaultTreeEntry) => {
    setSelectedVaultDir(entry.relativePath);
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
      loadVaultDirectory(entry.relativePath);
    }
  }, [expandedDirs, loadVaultDirectory]);

  const modeCommandId = editorMode === "plain" ? "view.setRichEdit" : "view.setPlainEdit";
  const renderVaultEntry = (entry: VaultTreeEntry, depth = 0) => (
    <div key={entry.path} className="workspace-entry">
      <div
        className={[
          "workspace-row",
          entry.kind,
          entry.path === activeNote.filePath ? "active" : "",
          entry.kind === "directory" && entry.relativePath === selectedVaultDir ? "selected" : "",
        ].filter(Boolean).join(" ")}
        style={{ "--tree-depth": depth } as CSSProperties}
      >
        <button
          type="button"
          className="workspace-name"
          onClick={() => {
            if (entry.kind === "directory") {
              handleVaultDirectoryClick(entry);
            } else {
              openMarkdownFile(entry.path).catch((error) => {
                console.error("Failed to open vault file", error);
                setVaultError(t.errors.openVaultFileFailed);
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
            <button type="button" title={t.prompts.renameAction} onClick={() => handleRenameVaultEntry(entry)}>
              {t.prompts.renameShort}
            </button>
            <button type="button" title={t.prompts.deleteAction} onClick={() => handleDeleteVaultEntry(entry)}>
              {t.prompts.deleteShort}
            </button>
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
          {t.sidebar.resultLimitReached}
        </p>
      ) : null}
      {entry.kind === "directory" && (entry.relativePath === "" || expandedDirs.has(entry.relativePath)) && entry.children.length ? (
        <div className="workspace-children">
          {entry.children.map((child) => renderVaultEntry(child, depth + 1))}
        </div>
      ) : null}
    </div>
  );

  const renderKnowledgePanel = (mode: "docked" | "floating") => (
    <section className={`knowledge-panel ${mode}`}>
      {mode === "floating" ? (
        <div
          className="floating-panel-titlebar"
          onPointerDown={handleFloatingPanelPointerDown}
          onDoubleClick={() => setKnowledgePanelFloating(false)}
        >
          <strong>{t.knowledge.title}</strong>
          <button type="button" onClick={() => setKnowledgePanelFloating(false)}>{t.knowledge.dock}</button>
        </div>
      ) : null}

      <div className="knowledge-tabs" role="tablist" aria-label={t.knowledge.tabsAria}>
        {(["backlinks", "graph"] as KnowledgePanelTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={knowledgePanelTab === tab}
            className={knowledgePanelTab === tab ? "selected" : ""}
            onClick={() => setKnowledgePanelTab(tab)}
          >
            {tab === "backlinks" ? t.knowledge.backlinks : t.knowledge.graph}
          </button>
        ))}
        <button
          type="button"
          className="panel-mode-button"
          onClick={() => setKnowledgePanelFloating((floating) => !floating)}
        >
          {mode === "floating" ? t.knowledge.dock : t.knowledge.float}
        </button>
      </div>

      {vaultMode ? (
        <div className="index-status">
          {vaultIndexStatus === "indexing" ? t.knowledge.indexing : null}
          {vaultIndexStatus === "error" ? vaultIndexError : null}
          {vaultIndex?.truncated ? t.knowledge.indexPartial : null}
          {vaultIndex?.skippedFiles ? t.knowledge.skippedFiles(vaultIndex.skippedFiles) : null}
        </div>
      ) : null}

      {knowledgePanelTab === "backlinks" ? (
        <div className="link-list" role="tabpanel">
          {activeBacklinks.length ? activeBacklinks.map((backlink, index) => (
            <button
              key={`${backlink.targetPath}-${index}`}
              type="button"
              className="link-item"
              onClick={() => backlink.targetPath && handleGraphNodeClick(backlink.targetPath)}
            >
              <strong>{backlink.label}</strong>
              <span>{backlink.rawTarget}</span>
            </button>
          )) : (
            <p className="muted">
              {vaultMode ? t.knowledge.noBacklinks : t.knowledge.openVaultForBacklinks}
            </p>
          )}
        </div>
      ) : null}

      {knowledgePanelTab === "graph" ? (
        <div className="local-graph" role="tabpanel">
          {localGraph.nodes.length ? (
            <>
              <svg viewBox="0 0 100 100" role="img" aria-label={t.knowledge.localGraphAria}>
                {localGraph.edges.map((edge) => {
                  const source = localGraphNodeMap.get(normalizeFilePath(edge.sourcePath));
                  const target = localGraphNodeMap.get(normalizeFilePath(edge.targetPath));
                  if (!source || !target) return null;
                  return (
                    <line
                      key={edge.id}
                      x1={source.x}
                      y1={source.y}
                      x2={target.x}
                      y2={target.y}
                      className="graph-edge"
                    />
                  );
                })}
                {localGraph.nodes.map((node) => (
                  <g
                    key={node.path}
                    className={`graph-node ${node.role}`}
                    transform={`translate(${node.x} ${node.y})`}
                    onClick={() => handleGraphNodeClick(node.path)}
                  >
                    <circle r={node.role === "current" ? 5.4 : 4.2} />
                    <text y={node.role === "current" ? -8 : -6}>{node.title}</text>
                  </g>
                ))}
              </svg>
              <p className="graph-note">
                {localGraph.edges.length
                  ? t.knowledge.graphSummary(localGraph.nodes.length, localGraph.edges.length)
                  : t.knowledge.graphOnlyCurrent}
              </p>
            </>
          ) : (
            <p className="muted">
              {!vaultMode
                ? t.knowledge.openVaultForGraph
                : vaultIndexStatus === "indexing"
                  ? t.knowledge.indexing
                  : t.knowledge.currentFileNotIndexed}
            </p>
          )}
          {activeUnresolvedLinks.length ? (
            <div className="unresolved-links">
              <strong>{t.knowledge.unresolvedLinks}</strong>
              {activeUnresolvedLinks.slice(0, 5).map((link, index) => (
                <span key={`${link.rawTarget}-${index}`} title={link.unresolvedReason ?? ""}>
                  {link.rawTarget}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <dl className="info-grid compact">
        <dt>{t.knowledge.file}</dt>
        <dd title={activeNote.filePath ?? ""}>{activeNote.fileName ?? t.knowledge.unsavedNote}</dd>
        <dt>{t.knowledge.type}</dt>
        <dd>{activeNote.fileExt ? `.${activeNote.fileExt}` : "Markdown"}</dd>
        <dt>{t.knowledge.lines}</dt>
        <dd>{lineCount}</dd>
        <dt>{t.knowledge.words}</dt>
        <dd>{textStats.words}</dd>
        <dt>{t.knowledge.characters}</dt>
        <dd>{textStats.characters}</dd>
        <dt>{t.knowledge.links}</dt>
        <dd>{activeResolvedLinks.length}/{activeOutgoingLinks.length}</dd>
        <dt>{t.knowledge.tags}</dt>
        <dd>{activeIndexedFile?.tags.length ? activeIndexedFile.tags.map((tag) => `#${tag}`).join(", ") : t.knowledge.none}</dd>
      </dl>
    </section>
  );

  return (
    <div
      className="desktop-shell"
      data-theme={theme}
      data-density={uiDensity}
      data-sidebar={sidebarVisible ? "visible" : "hidden"}
      data-right-panel={rightPanelVisible && !knowledgePanelFloating ? "visible" : "hidden"}
      style={{
        "--sidebar-width": `${sidebarWidth}px`,
        "--right-panel-width": `${rightPanelWidth}px`,
        "--ui-scale": String(uiScale / 100),
        "--editor-font-latin": quoteCssFontFamily(normalizeEditorFontFamily(editorLatinFont, defaultSettings.editorLatinFont)),
        "--editor-font-cjk": quoteCssFontFamily(normalizeEditorFontFamily(editorCjkFont, defaultSettings.editorCjkFont)),
        "--editor-font-size": `${editorFontSize * (uiScale / 100)}px`,
        "--editor-line-height": String(editorLineHeight),
        "--editor-left-gap": `${editorLeftGap}px`,
      } as CSSProperties}
    >
      <div className="app-chrome">
        <header
          className="window-titlebar"
          aria-label={t.aria.titlebar}
          onMouseDown={handleChromeDragMouseDown}
          onDoubleClick={handleChromeDoubleClick}
        >
          <strong className="window-title" title={windowTitle} data-tauri-drag-region>{windowTitle}</strong>
          <div className="titlebar-drag-region" data-tauri-drag-region />
          <div className="window-controls" aria-label={t.aria.windowControls}>
            <button type="button" aria-label={t.aria.minimize} onClick={() => handleWindowAction("minimize")}>-</button>
            <button type="button" aria-label={t.aria.maximize} onClick={() => handleWindowAction("maximize")}>□</button>
            <button type="button" className="close" aria-label={t.aria.closeWindow} onClick={() => handleWindowAction("close")}>×</button>
          </div>
        </header>

        <header
          ref={menuBarRef}
          className="menu-bar"
          aria-label={t.aria.appMenu}
          onMouseDown={handleChromeDragMouseDown}
          onDoubleClick={handleChromeDoubleClick}
        >
          <div className="menu-left">
            <nav className="main-menu" aria-label={t.aria.mainMenu}>
              {menuGroups.map((group) => (
                <div key={group.id} className="menu-root">
                  <button
                    type="button"
                    aria-expanded={openMenuId === group.id}
                    className={openMenuId === group.id ? "menu-root-button open" : "menu-root-button"}
                    onMouseDown={(event) => event.stopPropagation()}
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
                    {t.menuGroups[group.id as keyof typeof t.menuGroups] ?? group.label}
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
                            <span>{item.commandId ? (t.commandLabels[item.commandId as keyof typeof t.commandLabels] ?? item.label) : item.label}</span>
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
            <span>{saveStatus === "saved" ? t.status.saved : saveError ?? (savedAt ? `${t.status.saved} ${formatTime(savedAt)}` : t.status.memoryDraft)}</span>
            <button type="button" onClick={() => dispatchCommand(modeCommandId)}>
              {editorMode === "plain" ? t.modeNames.rich : t.modeNames.plain}
            </button>
            <button type="button" onClick={() => dispatchCommand("app.openSettings")}>{t.commandLabels["app.openSettings"]}</button>
          </div>
        </header>
      </div>

      {sidebarVisible ? (
        <aside className="left-rail">
          <div className="sidebar-tabs" role="tablist" aria-label={t.aria.sidebarSections}>
            <button
              type="button"
              role="tab"
              aria-selected={leftPanelTab === "files"}
              className={leftPanelTab === "files" ? "selected" : ""}
              onClick={() => setLeftPanelTab("files")}
            >
              {t.sidebar.files}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={leftPanelTab === "outline"}
              className={leftPanelTab === "outline" ? "selected" : ""}
              onClick={() => setLeftPanelTab("outline")}
            >
              {t.sidebar.outline}
            </button>
          </div>

          {leftPanelTab === "files" && vaultMode ? (
            <>
              <div className="workspace-root" title={vaultRoot ?? ""}>
                {vaultTree?.name ?? t.sidebar.vault}
                <button type="button" onClick={() => dispatchCommand("file.openVault")}>{t.sidebar.open}</button>
              </div>
              {vaultError ? <p className="workspace-error">{vaultError}</p> : null}
              <nav className="workspace-tree" aria-label={t.sidebar.vaultFiles}>
                {vaultTree ? renderVaultEntry(vaultTree) : <p className="muted">{t.sidebar.loadingVault}</p>}
                {vaultRecoveryBlocked ? (
                  <button type="button" className="workspace-clear" onClick={clearVaultState}>
                    {t.sidebar.clearVaultState}
                  </button>
                ) : null}
              </nav>
            </>
          ) : null}

          {leftPanelTab === "files" && !vaultMode ? (
            <div className="placeholder-list">
              <button type="button" onClick={() => dispatchCommand("file.openVault")}>{t.sidebar.openLocalFolder}</button>
              <button type="button" onClick={() => dispatchCommand("file.open")}>{t.sidebar.openStandaloneMarkdown}</button>
            </div>
          ) : null}

          {leftPanelTab === "outline" ? (
            <div className="outline-list sidebar-outline" role="tabpanel">
              {outline.length ? outline.map((item, index) => (
                <button
                  key={`${item.text}-${index}`}
                  type="button"
                  className={`outline-item level-${item.level}`}
                  onClick={() => handleOutlineClick(index)}
                >
                  {item.text}
                </button>
              )) : <p className="muted">{t.sidebar.noHeadings}</p>}
            </div>
          ) : null}

          {leftPanelTab === "files" && !vaultMode ? (
            <>
              <div className="panel-heading compact">
                <span>{t.sidebar.openNotes}</span>
              </div>
              <nav className="card-list" aria-label={t.sidebar.openNotes}>
                {notes.map((note) => (
                  <button
                    key={note.id}
                    type="button"
                    className={note.id === activeNote.id ? "card-item active" : "card-item"}
                    onClick={() => setActiveNoteId(note.id)}
                  >
                    <strong>{note.title}</strong>
                    <span>{note.filePath ?? note.markdown.split("\n").find((line) => line.trim() && !line.startsWith("#")) ?? t.sidebar.markdownNote}</span>
                  </button>
                ))}
              </nav>
            </>
          ) : null}

          {leftPanelTab === "files" ? (
            <button type="button" className="new-note-fab" aria-label={t.sidebar.newNote} onClick={() => dispatchCommand("file.new")}>+</button>
          ) : null}
        </aside>
      ) : null}

      {sidebarVisible ? (
        <div
          className="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label={t.sidebar.resizeSidebar}
          onPointerDown={handleSidebarPointerDown}
        />
      ) : null}

      <main className="editor-column">
        <section ref={editorSurfaceRef} className="editor-surface" aria-label={t.aria.markdownEditor}>
          {editorMode === "plain" ? (
            <textarea
              ref={plainEditorRef}
              className="markdown-editor"
              value={activeNote.markdown}
              onChange={(event) => handleMarkdownChange(event.target.value)}
              spellCheck
            />
          ) : (
            <Suspense fallback={<div className="editor-loading">{t.aria.loadingRichEditor}</div>}>
              <MilkdownEditor
                key={activeNote.id}
                markdown={activeNote.markdown}
                onChange={handleMarkdownChange}
                command={richCommand}
              />
            </Suspense>
          )}
        </section>
      </main>

      {rightPanelVisible && !knowledgePanelFloating ? (
        <div
          className="right-panel-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label={t.aria.resizeKnowledgePanel}
          onPointerDown={handleRightPanelPointerDown}
        />
      ) : null}

      {rightPanelVisible && !knowledgePanelFloating ? (
        <aside className="right-rail" aria-label={t.aria.knowledgePanels}>
          {renderKnowledgePanel("docked")}
        </aside>
      ) : null}

      {rightPanelVisible && knowledgePanelFloating ? (
        <aside
          className="floating-knowledge-panel"
          aria-label={t.aria.floatingKnowledgePanel}
          style={{
            "--floating-panel-x": `${floatingPanelPosition.x}px`,
            "--floating-panel-y": `${floatingPanelPosition.y}px`,
          } as CSSProperties}
        >
          {renderKnowledgePanel("floating")}
        </aside>
      ) : null}

      {appDialog ? (
        <div className="app-dialog-backdrop" role="presentation" onMouseDown={() => closeAppDialog(appDialog.kind === "confirm" ? false : null)}>
          <form
            className="app-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={appDialog.title}
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              if (appDialog.kind === "input") {
                closeAppDialog(appDialogInput);
                return;
              }
              closeAppDialog(true);
            }}
          >
            <div className="app-dialog-header">
              <h2>{appDialog.title}</h2>
            </div>
            {appDialog.message ? <p className="app-dialog-message">{appDialog.message}</p> : null}
            {appDialog.kind === "input" ? (
              <input
                ref={appDialogInputRef}
                value={appDialogInput}
                onChange={(event) => setAppDialogInput(event.target.value)}
              />
            ) : null}
            <div className="app-dialog-actions">
              {appDialog.cancelLabel ? (
                <button
                  type="button"
                  className="app-dialog-secondary"
                  onClick={() => closeAppDialog(appDialog.kind === "confirm" ? false : null)}
                >
                  {appDialog.cancelLabel}
                </button>
              ) : null}
              <button type="submit" className={appDialog.danger ? "app-dialog-danger" : "app-dialog-primary"}>
                {appDialog.confirmLabel}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {settingsOpen ? (
        <div className="settings-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <section className="settings-panel" role="dialog" aria-modal="true" aria-label={t.aria.settingsDialog} onMouseDown={(event) => event.stopPropagation()}>
            <div className="settings-header">
              <h2>{t.settings.title}</h2>
              <button type="button" onClick={() => setSettingsOpen(false)}>{t.settings.close}</button>
            </div>

            <div className="settings-layout">
              <nav className="settings-nav" aria-label={t.settings.navAria}>
                {settingsSections.map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    className={settingsSection === section.id ? "selected" : ""}
                    onClick={() => setSettingsSection(section.id)}
                  >
                    {t.sectionLabels[section.id]}
                  </button>
                ))}
              </nav>

              <div className="settings-content">
                {settingsSection === "general" ? (
                  <div className="settings-section">
                    <h3>{t.settings.general}</h3>
                    <label className="settings-field">
                      <span>{t.settings.language}</span>
                      <select value={language} onChange={(event) => setLanguage(event.target.value as AppLanguage)}>
                        {appLanguages.map((item) => (
                          <option key={item.id} value={item.id}>{item.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="settings-field">
                      <span>{t.settings.defaultEditMode}</span>
                      <select value={defaultEditorModeSetting} onChange={(event) => setDefaultEditorModeSetting(event.target.value as EditorMode)}>
                        <option value="plain">{t.modeNames.plain}</option>
                        <option value="rich">{t.modeNames.rich}</option>
                      </select>
                    </label>
                    <label className="settings-check">
                      <input type="checkbox" checked={restoreWorkspace} onChange={(event) => setRestoreWorkspace(event.target.checked)} />
                      {t.settings.restoreLastVault}
                    </label>
                    <label className="settings-check">
                      <input type="checkbox" checked={sidebarVisible} onChange={(event) => setSidebarVisible(event.target.checked)} />
                      {t.settings.showVaultSidebar}
                    </label>
                    <label className="settings-check">
                      <input type="checkbox" checked={rightPanelVisible} onChange={(event) => setRightPanelVisible(event.target.checked)} />
                      {t.settings.showKnowledgePanel}
                    </label>
                  </div>
                ) : null}

                {settingsSection === "editor" ? (
                  <div className="settings-section">
                    <h3>{t.settings.editor}</h3>
                    <label className="settings-field">
                      <span>{t.settings.englishFont}</span>
                      <select
                        value={editorLatinFont}
                        onChange={(event) => setEditorLatinFont(event.target.value)}
                      >
                        {editorLatinFontOptions.map((font) => (
                          <option key={font} value={font}>{font}</option>
                        ))}
                      </select>
                    </label>
                    <label className="settings-field">
                      <span>{t.settings.chineseFont}</span>
                      <select
                        value={editorCjkFont}
                        onChange={(event) => setEditorCjkFont(event.target.value)}
                      >
                        {editorCjkFontOptions.map((font) => (
                          <option key={font} value={font}>{font}</option>
                        ))}
                      </select>
                    </label>
                    <label className="settings-field">
                      <span>{t.settings.fontSize}</span>
                      <select value={editorFontSize} onChange={(event) => setEditorFontSize(Number(event.target.value))}>
                        {editorFontSizeOptions.map((item) => (
                          <option key={item.value} value={item.value}>
                            {language === "zh-CN" ? item.zh : item.en}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="settings-field">
                      <span>{t.settings.lineHeight}</span>
                      <input type="number" min={1.4} max={2.2} step={0.05} value={editorLineHeight} onChange={(event) => setEditorLineHeight(Number(event.target.value))} />
                    </label>
                    <label className="settings-field">
                      <span>{t.settings.uiFontScale}</span>
                      <input type="number" min={MIN_UI_SCALE} max={MAX_UI_SCALE} step={5} value={uiScale} onChange={(event) => setUiScale(clampUiScale(Number(event.target.value)))} />
                    </label>
                    <label className="settings-check">
                      <input type="checkbox" checked={zoomWithWheel} onChange={(event) => setZoomWithWheel(event.target.checked)} />
                      {t.settings.zoomWithWheel}
                    </label>
                    <label className="settings-field">
                      <span>{t.settings.layoutLeftGap}</span>
                      <input type="number" min={MIN_EDITOR_LEFT_GAP} max={MAX_EDITOR_LEFT_GAP} value={editorLeftGap} onChange={(event) => setEditorLeftGap(clampEditorLeftGap(Number(event.target.value)))} />
                    </label>
                    <label className="settings-field">
                      <span>{t.settings.sidebarWidth}</span>
                      <input type="number" min={MIN_SIDEBAR_WIDTH} max={MAX_SIDEBAR_WIDTH} value={sidebarWidth} onChange={(event) => setSidebarWidth(clampSidebarWidth(Number(event.target.value)))} />
                    </label>
                    <label className="settings-field">
                      <span>{t.settings.rightPanelWidth}</span>
                      <input type="number" min={MIN_RIGHT_PANEL_WIDTH} max={MAX_RIGHT_PANEL_WIDTH} value={rightPanelWidth} onChange={(event) => setRightPanelWidth(clampRightPanelWidth(Number(event.target.value)))} />
                    </label>
                    <button
                      type="button"
                      className="settings-secondary"
                      onClick={() => {
                        setEditorLatinFont(defaultSettings.editorLatinFont);
                        setEditorCjkFont(defaultSettings.editorCjkFont);
                        setEditorFontSize(defaultSettings.editorFontSize);
                        setEditorLineHeight(defaultSettings.editorLineHeight);
                        setEditorLeftGap(defaultSettings.editorLeftGap);
                        setUiScale(defaultSettings.uiScale);
                        setSidebarWidth(defaultSettings.sidebarWidth);
                        setRightPanelWidth(defaultSettings.rightPanelWidth);
                      }}
                    >
                      {t.settings.resetEditorLayout}
                    </button>
                  </div>
                ) : null}

                {settingsSection === "shortcuts" ? (
                  <div className="settings-section">
                    <div className="settings-section-title">
                      <h3>{t.settings.shortcuts}</h3>
                      <button type="button" onClick={handleShortcutRestoreAll}>{t.settings.restoreDefaults}</button>
                    </div>
                    {shortcutConflicts.size ? (
                      <p className="shortcut-warning">
                        {t.settings.shortcutConflict}: {Array.from(shortcutConflicts.keys()).join(", ")}
                      </p>
                    ) : null}
                    <div className="shortcut-table">
                      {shortcuts.map((shortcut) => {
                        const rowConflicts = shortcut.currentKeys.some((key) => shortcutConflicts.has(key));

                        return (
                          <div key={shortcut.id} className={rowConflicts ? "shortcut-row conflict" : "shortcut-row"}>
                            <div>
                              <strong>{t.commandLabels[shortcut.commandId as keyof typeof t.commandLabels] ?? shortcut.label}</strong>
                              <span>{t.shortcutCategories[shortcut.category]} · {shortcut.commandId}</span>
                            </div>
                            <input
                              value={shortcutEdits[shortcut.id] ?? ""}
                              disabled={!shortcut.editable}
                              aria-label={t.aria.shortcutInput(t.commandLabels[shortcut.commandId as keyof typeof t.commandLabels] ?? shortcut.label)}
                              onChange={(event) => setShortcutEdits((current) => ({ ...current, [shortcut.id]: event.target.value }))}
                              onKeyDown={(event) => {
                                event.stopPropagation();
                                if (event.key === "Enter") event.currentTarget.blur();
                              }}
                              onBlur={() => handleShortcutInputBlur(shortcut.id)}
                            />
                            <label className="shortcut-enabled">
                              <input type="checkbox" checked={shortcut.enabled} onChange={(event) => updateShortcutEnabled(shortcut.id, event.target.checked)} />
                              {t.settings.enabled}
                            </label>
                            <button type="button" onClick={() => handleShortcutRestore(shortcut.id)}>{t.settings.default}</button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {settingsSection === "appearance" ? (
                  <div className="settings-section">
                    <h3>{t.settings.appearance}</h3>
                    <div className="theme-options">
                      <button type="button" className={theme === "daily" ? "theme-option selected" : "theme-option"} onClick={() => dispatchCommand("theme.daily")}>
                        <span className="theme-swatch daily" />
                        <strong>Daily</strong>
                        <span>{t.themeDescriptions.daily}</span>
                      </button>
                      <button type="button" className={theme === "eye" ? "theme-option selected" : "theme-option"} onClick={() => dispatchCommand("theme.eye")}>
                        <span className="theme-swatch eye" />
                        <strong>Eye Care</strong>
                        <span>{t.themeDescriptions.eye}</span>
                      </button>
                      <button type="button" className={theme === "mint" ? "theme-option selected" : "theme-option"} onClick={() => dispatchCommand("theme.mint")}>
                        <span className="theme-swatch mint" />
                        <strong>Mint</strong>
                        <span>{t.themeDescriptions.mint}</span>
                      </button>
                      <button type="button" className={theme === "ink" ? "theme-option selected" : "theme-option"} onClick={() => dispatchCommand("theme.ink")}>
                        <span className="theme-swatch ink" />
                        <strong>Dark</strong>
                        <span>{t.themeDescriptions.ink}</span>
                      </button>
                    </div>
                    <label className="settings-field">
                      <span>{t.settings.interfaceDensity}</span>
                      <select value={uiDensity} onChange={(event) => setUiDensity(event.target.value as UIDensity)}>
                        <option value="comfortable">{t.settings.comfortable}</option>
                        <option value="compact">{t.settings.compact}</option>
                      </select>
                    </label>
                  </div>
                ) : null}

                {settingsSection === "files" ? (
                  <div className="settings-section">
                    <h3>{t.settings.files}</h3>
                    <label className="settings-field">
                      <span>{t.settings.defaultSaveFormat}</span>
                      <select value={defaultSaveExt} onChange={(event) => setDefaultSaveExt(event.target.value as SaveFileExt)}>
                        <option value="md">.md</option>
                        <option value="txt">.txt</option>
                      </select>
                    </label>
                    <label className="settings-field">
                      <span>{t.settings.defaultNewNoteName}</span>
                      <input
                        value={defaultNewNoteName}
                        onChange={(event) => setDefaultNewNoteName(event.target.value)}
                        onBlur={() => setDefaultNewNoteName((current) => normalizeDefaultNewNoteName(current))}
                      />
                    </label>
                    <p>{t.settings.vaultMetadata}: <code>.serein/vault.json</code> / <code>.serein/workspace.json</code></p>
                    <p>{t.settings.vaultRoot}: <code>{vaultRoot ?? t.settings.none}</code></p>
                    <p>{t.settings.lastOpenedFile}: <code>{lastOpenedFile ?? t.settings.none}</code></p>
                    <button type="button" className="settings-danger" onClick={clearVaultState}>
                      {t.settings.clearLastVaultState}
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
