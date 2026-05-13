import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  MAX_EDITOR_LEFT_GAP,
  MAX_SIDEBAR_WIDTH,
  MAX_UI_SCALE,
  MIN_EDITOR_LEFT_GAP,
  MIN_SIDEBAR_WIDTH,
  MIN_UI_SCALE,
  VAULT_DIRECTORY_LIMIT,
  defaultSettings,
  settingsSections,
} from "./app/defaults";
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
  readVaultDirectory,
  renameVaultEntry,
  writeMarkdownFile,
  writeVaultWorkspaceState,
} from "./fs/tauriFs";
import { clampEditorLeftGap, clampSidebarWidth, clampUiScale, readSettings, writeSettings } from "./settings/storage";
import {
  ensureSaveExtension,
  ensureVaultFileName,
  extractFirstLineTitle,
  extractOutline,
  formatTime,
  getHeadingOffsets,
  isSameOrChildPath,
  joinVaultPath,
  parentVaultDir,
  pathFileName,
  stripExtension,
} from "./shared/markdown";
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

function titleFromMarkdown(markdown: string, fallback: string) {
  return extractFirstLineTitle(markdown) ?? fallback;
}

export default function App() {
  const [initialSettings] = useState(readSettings);
  const [initialShortcuts] = useState(readShortcuts);
  const [notes, setNotes] = useState<Note[]>(() => [createDraftNote()]);
  const [activeNoteId, setActiveNoteId] = useState(notes[0]?.id ?? "");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [editorMode, setEditorMode] = useState<EditorMode>(initialSettings.defaultEditorMode);
  const [theme, setTheme] = useState<ThemeStyle>(initialSettings.theme);
  const [uiDensity, setUiDensity] = useState<UIDensity>(initialSettings.uiDensity);
  const [sidebarWidth, setSidebarWidth] = useState(initialSettings.sidebarWidth);
  const [sidebarVisible, setSidebarVisible] = useState(initialSettings.sidebarVisible);
  const [rightPanelVisible, setRightPanelVisible] = useState(initialSettings.rightPanelVisible);
  const [vaultRoot, setVaultRoot] = useState<string | null>(initialSettings.restoreWorkspace ? initialSettings.vaultRoot : null);
  const [vaultTree, setVaultTree] = useState<VaultTreeEntry | null>(null);
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [selectedVaultDir, setSelectedVaultDir] = useState(initialSettings.selectedVaultDir);
  const [lastOpenedFile, setLastOpenedFile] = useState<string | null>(initialSettings.lastOpenedFile);
  const [vaultRecoveryBlocked, setVaultRecoveryBlocked] = useState(initialSettings.vaultRecoveryBlocked);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set([""]));
  const [vaultWorkspace, setVaultWorkspace] = useState<VaultWorkspaceState>(() => mergeWorkspaceState(null, {
    sidebarWidth: initialSettings.sidebarWidth,
    sidebarVisible: initialSettings.sidebarVisible,
    rightPanelVisible: initialSettings.rightPanelVisible,
    editorLeftGap: initialSettings.editorLeftGap,
    uiScale: initialSettings.uiScale,
  }));
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
  const restoredVaultRef = useRef(false);
  const richCommandIdRef = useRef(0);

  const activeNote = notes.find((note) => note.id === activeNoteId) ?? notes[0];
  const outline = useMemo(() => extractOutline(activeNote.markdown), [activeNote.markdown]);
  const shortcutConflicts = useMemo(() => findShortcutConflicts(shortcuts), [shortcuts]);
  const vaultMode = Boolean(vaultRoot);
  const wordCount = useMemo(() => activeNote.markdown.trim().split(/\s+/).filter(Boolean).length, [activeNote.markdown]);
  const lineCount = useMemo(() => activeNote.markdown.split(/\r?\n/).length, [activeNote.markdown]);

  const persistVaultPatch = useCallback((patch: Partial<VaultWorkspaceState>) => {
    setVaultWorkspace((current) => nextWorkspaceState(current, patch));
  }, []);

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
    setNotes((currentNotes) => currentNotes.map((note) => {
      if (note.id !== activeNoteId) return note;
      return {
        ...note,
        title: titleFromMarkdown(markdown, note.title),
        markdown,
        updatedAt: new Date().toISOString(),
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
      const message = relativePath ? "Directory failed to load" : "Vault failed to load; safe mode enabled";
      setVaultError(message);
      if (relativePath === "") setVaultRecoveryBlocked(true);
      setVaultTree((current) => (
        current
          ? updateVaultNode(current, relativePath, (entry) => ({ ...entry, loading: false, loadError: message }))
          : current
      ));
      return null;
    }
  }, [vaultRoot]);

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
      setSaveError("Open failed");
      setSaveStatus("error");
    }
  }, [openMarkdownFile]);

  const activateVault = useCallback(async (root: string) => {
    const initialized = await initVault(root);
    const workspace = mergeWorkspaceState(initialized.workspace, {
      sidebarWidth,
      sidebarVisible,
      rightPanelVisible,
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
    setEditorLeftGap(clampEditorLeftGap(workspace.layout.editorLeftGap));
    setUiScale(clampUiScale(workspace.layout.uiScale));
    setVaultRecoveryBlocked(false);
    setExpandedDirs(new Set(workspace.expandedDirs.length ? workspace.expandedDirs : [""]));
    const draft = createDraftNote();
    setNotes([draft]);
    setActiveNoteId(draft.id);

    const rootDirectory = await loadVaultDirectory("", initialized.root);
    if (rootDirectory) void prefetchInitialDirectories(initialized.root, rootDirectory);
    if (workspace.lastOpenedFile) {
      openMarkdownFile(workspace.lastOpenedFile).catch((error) => {
        console.error("Failed to restore last opened file", error);
        setVaultError("Last file failed to restore");
      });
    }
  }, [
    editorLeftGap,
    loadVaultDirectory,
    openMarkdownFile,
    prefetchInitialDirectories,
    rightPanelVisible,
    sidebarVisible,
    sidebarWidth,
    uiScale,
  ]);

  const handleOpenVault = useCallback(async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (!selected || Array.isArray(selected)) return;
      await activateVault(selected);
    } catch (error) {
      console.error("Failed to open vault", error);
      setVaultError("Open vault failed");
    }
  }, [activateVault]);

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
    };

    setNotes((currentNotes) => currentNotes.map((item) => (item.id === note.id ? nextNote : item)));
    setLastOpenedFile(nextNote.filePath ?? null);
    persistVaultPatch({
      lastOpenedFile: nextNote.filePath ?? null,
      recentFiles: pushRecentFile(vaultWorkspace.recentFiles, nextNote.filePath ?? null),
    });
    if (vaultRoot) await loadVaultDirectory(selectedVaultDir);
    setSavedAt(new Date());
    setSaveError(null);
    setSaveStatus("saved");
  }, [defaultSaveExt, loadVaultDirectory, persistVaultPatch, selectedVaultDir, vaultRoot, vaultWorkspace.recentFiles]);

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
      setSaveError("Save As failed");
      setSaveStatus("error");
    }
  }, [activeNote, defaultSaveExt, saveNoteToPath]);

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
      setSaveError("Save failed");
      setSaveStatus("error");
    }
  }, [activeNote, handleSaveAs, saveNoteToPath]);

  const handleCreateNote = useCallback(() => {
    if (vaultRoot) {
      const input = window.prompt("New note name", `Untitled.${defaultSaveExt}`);
      if (!input) return;

      const fileName = ensureVaultFileName(input, defaultSaveExt);
      const relativePath = joinVaultPath(selectedVaultDir, fileName);
      createVaultEntry(vaultRoot, relativePath, "file")
        .then(async (path) => {
          await loadVaultDirectory(selectedVaultDir);
          await openMarkdownFile(path);
        })
        .catch((error) => {
          console.error("Failed to create vault file", error);
          setVaultError("Create file failed");
        });
      return;
    }

    const note = createDraftNote();
    setNotes((currentNotes) => [note, ...currentNotes]);
    setActiveNoteId(note.id);
  }, [defaultSaveExt, loadVaultDirectory, openMarkdownFile, selectedVaultDir, vaultRoot]);

  const handleCreateVaultFolder = useCallback(() => {
    if (!vaultRoot) return;

    const input = window.prompt("New folder name", "New Folder");
    if (!input) return;

    const relativePath = joinVaultPath(selectedVaultDir, input);
    createVaultEntry(vaultRoot, relativePath, "directory")
      .then(() => loadVaultDirectory(selectedVaultDir))
      .catch((error) => {
        console.error("Failed to create vault folder", error);
        setVaultError("Create folder failed");
      });
  }, [loadVaultDirectory, selectedVaultDir, vaultRoot]);

  const handleRenameVaultEntry = useCallback((entry: VaultTreeEntry) => {
    if (!vaultRoot || !entry.relativePath) return;

    const nextName = window.prompt("Rename", entry.name);
    if (!nextName || nextName === entry.name) return;

    renameVaultEntry(vaultRoot, entry.relativePath, nextName)
      .then(async (nextPath) => {
        await loadVaultDirectory(parentVaultDir(entry.relativePath));
        if (activeNote.filePath === entry.path) {
          await openMarkdownFile(nextPath);
        }
      })
      .catch((error) => {
        console.error("Failed to rename vault entry", error);
        setVaultError("Rename failed");
      });
  }, [activeNote.filePath, loadVaultDirectory, openMarkdownFile, vaultRoot]);

  const handleDeleteVaultEntry = useCallback((entry: VaultTreeEntry) => {
    if (!vaultRoot || !entry.relativePath) return;
    if (!window.confirm(`Delete ${entry.name}? This will delete it from disk.`)) return;

    deleteVaultEntry(vaultRoot, entry.relativePath)
      .then(async () => {
        await loadVaultDirectory(parentVaultDir(entry.relativePath));
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
        setVaultError("Delete failed");
      });
  }, [activeNote.filePath, loadVaultDirectory, persistVaultPatch, vaultRoot]);

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

  const runLinkCommand = useCallback(() => {
    const href = window.prompt("Link URL", "https://");
    if (!href) return;
    runEditorCommand("link", href);
  }, [runEditorCommand]);

  const handleFind = useCallback(() => {
    if (!activeNote) return;
    const query = window.prompt("Find", "");
    if (!query) return;

    if (editorMode === "plain") {
      const textarea = plainEditorRef.current;
      if (!textarea) return;

      const startFrom = textarea.selectionEnd;
      const index = activeNote.markdown.indexOf(query, startFrom);
      const wrappedIndex = index === -1 ? activeNote.markdown.indexOf(query) : index;
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
  }, [activeNote, editorMode, focusEditor]);

  const commands = useMemo<Record<string, CommandDefinition>>(() => ({
    "file.new": { id: "file.new", label: "New note", enabled: true, run: handleCreateNote },
    "file.open": { id: "file.open", label: "Open file", enabled: true, run: handleOpenFile },
    "file.openVault": { id: "file.openVault", label: "Open vault", enabled: true, run: handleOpenVault },
    "file.save": { id: "file.save", label: "Save file", enabled: Boolean(activeNote), run: handleSave },
    "file.saveAs": { id: "file.saveAs", label: "Save as", enabled: Boolean(activeNote), run: handleSaveAs },
    "file.export": { id: "file.export", label: "Export", enabled: Boolean(activeNote), run: handleSaveAs },
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
    "app.about": { id: "app.about", label: "About", enabled: true, run: () => window.alert("Serein 0.0.1") },
    "edit.cut": { id: "edit.cut", label: "Cut", enabled: true, run: () => { focusEditor(); document.execCommand("cut"); } },
    "edit.copy": { id: "edit.copy", label: "Copy", enabled: true, run: () => { focusEditor(); document.execCommand("copy"); } },
    "edit.paste": { id: "edit.paste", label: "Paste", enabled: true, run: () => { focusEditor(); document.execCommand("paste"); } },
    "edit.undo": { id: "edit.undo", label: "Undo", enabled: true, run: () => { focusEditor(); document.execCommand("undo"); } },
    "edit.redo": { id: "edit.redo", label: "Redo", enabled: true, run: () => { focusEditor(); document.execCommand("redo"); } },
    "edit.selectAll": { id: "edit.selectAll", label: "Select all", enabled: true, run: () => runEditorCommand("selectAllSmart") },
    "edit.find": { id: "edit.find", label: "Find", enabled: Boolean(activeNote), run: handleFind },
    "paragraph.text": { id: "paragraph.text", label: "Text", enabled: Boolean(activeNote), run: () => runEditorCommand("paragraph") },
    "paragraph.heading1": { id: "paragraph.heading1", label: "Heading 1", enabled: Boolean(activeNote), run: () => runEditorCommand("heading1") },
    "paragraph.heading2": { id: "paragraph.heading2", label: "Heading 2", enabled: Boolean(activeNote), run: () => runEditorCommand("heading2") },
    "paragraph.heading3": { id: "paragraph.heading3", label: "Heading 3", enabled: Boolean(activeNote), run: () => runEditorCommand("heading3") },
    "paragraph.blockquote": { id: "paragraph.blockquote", label: "Quote", enabled: Boolean(activeNote), run: () => runEditorCommand("blockquote") },
    "paragraph.bulletList": { id: "paragraph.bulletList", label: "Bullet list", enabled: Boolean(activeNote), run: () => runEditorCommand("bulletList") },
    "paragraph.orderedList": { id: "paragraph.orderedList", label: "Ordered list", enabled: Boolean(activeNote), run: () => runEditorCommand("orderedList") },
    "paragraph.codeBlock": { id: "paragraph.codeBlock", label: "Code block", enabled: Boolean(activeNote), run: () => runEditorCommand("codeBlock") },
    "format.bold": { id: "format.bold", label: "Bold", enabled: Boolean(activeNote), run: () => runEditorCommand("bold") },
    "format.italic": { id: "format.italic", label: "Italic", enabled: Boolean(activeNote), run: () => runEditorCommand("italic") },
    "format.inlineCode": { id: "format.inlineCode", label: "Inline code", enabled: Boolean(activeNote), run: () => runEditorCommand("inlineCode") },
    "format.strike": { id: "format.strike", label: "Strikethrough", enabled: Boolean(activeNote), run: () => runEditorCommand("strike") },
    "format.link": { id: "format.link", label: "Link", enabled: Boolean(activeNote), run: runLinkCommand },
    "view.setPlainEdit": { id: "view.setPlainEdit", label: "Plain Edit", enabled: editorMode !== "plain", run: () => setEditorMode("plain") },
    "view.setRichEdit": { id: "view.setRichEdit", label: "Rich Edit", enabled: editorMode !== "rich", run: () => setEditorMode("rich") },
    "view.toggleSidebar": { id: "view.toggleSidebar", label: "Toggle sidebar", enabled: true, run: () => setSidebarVisible((visible) => !visible) },
    "view.toggleRightPanel": { id: "view.toggleRightPanel", label: "Toggle knowledge panel", enabled: true, run: () => setRightPanelVisible((visible) => !visible) },
    "theme.daily": { id: "theme.daily", label: "Daily", enabled: theme !== "daily", run: () => setTheme("daily") },
    "theme.eye": { id: "theme.eye", label: "Eye Care", enabled: theme !== "eye", run: () => setTheme("eye") },
    "theme.mint": { id: "theme.mint", label: "Mint", enabled: theme !== "mint", run: () => setTheme("mint") },
    "theme.ink": { id: "theme.ink", label: "Dark", enabled: theme !== "ink", run: () => setTheme("ink") },
  }), [
    activeNote,
    editorMode,
    focusEditor,
    handleCreateNote,
    handleFind,
    handleOpenFile,
    handleOpenVault,
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
    if (restoredVaultRef.current || !vaultRoot) return;
    restoredVaultRef.current = true;

    if (vaultRecoveryBlocked) {
      setVaultError("Vault recovery is paused after a previous load failure. Reopen or clear the vault.");
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
        loadError: "Recovery paused",
      });
      return;
    }

    activateVault(vaultRoot).catch((error) => {
      console.error("Failed to restore vault", error);
      setVaultError("Vault restore failed");
      setVaultRecoveryBlocked(true);
    });
  }, [activateVault, vaultRecoveryBlocked, vaultRoot]);

  useEffect(() => {
    writeSettings({
      theme,
      uiDensity,
      sidebarWidth,
      sidebarVisible,
      rightPanelVisible,
      vaultRoot,
      lastOpenedFile,
      selectedVaultDir,
      vaultRecoveryBlocked,
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
    defaultEditorModeSetting,
    defaultSaveExt,
    editorFontSize,
    editorLeftGap,
    editorLineHeight,
    lastOpenedFile,
    restoreWorkspace,
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
    persistVaultPatch({
      selectedDir: selectedVaultDir,
      expandedDirs: Array.from(expandedDirs),
      lastOpenedFile,
      layout: {
        sidebarWidth,
        sidebarVisible,
        rightPanelVisible,
        editorLeftGap,
        uiScale,
      },
    });
  }, [
    editorLeftGap,
    expandedDirs,
    lastOpenedFile,
    persistVaultPatch,
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
          setVaultError("Vault workspace state failed to save");
        });
    }, 450);

    return () => window.clearTimeout(timeout);
  }, [vaultRoot, vaultWorkspace]);

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
  }, [commands, dispatchCommand, shortcuts]);

  const handleOutlineClick = useCallback((index: number) => {
    if (editorMode === "plain") {
      const target = getHeadingOffsets(activeNote.markdown)[index];
      if (!target) return;

      plainEditorRef.current?.focus();
      plainEditorRef.current?.setSelectionRange(target.start, target.end);
      return;
    }

    const headings = editorSurfaceRef.current?.querySelectorAll(".milkdown h1, .milkdown h2, .milkdown h3");
    const heading = headings?.item(index);
    heading?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [activeNote.markdown, editorMode]);

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

  const clearVaultState = useCallback(() => {
    setVaultRoot(null);
    setVaultTree(null);
    setVaultError(null);
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
                setVaultError("Open file failed");
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
            <button type="button" title="Rename" onClick={() => handleRenameVaultEntry(entry)}>R</button>
            <button type="button" title="Delete" onClick={() => handleDeleteVaultEntry(entry)}>D</button>
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
          {entry.children.map((child) => renderVaultEntry(child, depth + 1))}
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
      data-right-panel={rightPanelVisible ? "visible" : "hidden"}
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
          <strong className="window-title" data-tauri-drag-region>Serein</strong>
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
            <span>{saveStatus === "saved" ? "Saved" : saveError ?? (savedAt ? `Saved ${formatTime(savedAt)}` : "Memory draft")}</span>
            <button type="button" onClick={() => dispatchCommand(modeCommandId)}>
              {editorMode === "plain" ? "Rich Edit" : "Plain Edit"}
            </button>
            <button type="button" onClick={() => dispatchCommand("app.openSettings")}>Settings</button>
          </div>
        </header>
      </div>

      {sidebarVisible ? (
        <aside className="left-rail">
          <div className="panel-heading">
            <span>Vault</span>
            <button type="button" onClick={() => dispatchCommand("file.openVault")}>Open</button>
          </div>
          {vaultMode ? (
            <>
              <div className="workspace-root" title={vaultRoot ?? ""}>
                {vaultTree?.name ?? "Vault"}
              </div>
              <div className="workspace-toolbar">
                <button type="button" onClick={() => dispatchCommand("file.new")}>New note</button>
                <button type="button" onClick={handleCreateVaultFolder}>New folder</button>
              </div>
              {vaultError ? <p className="workspace-error">{vaultError}</p> : null}
              <nav className="workspace-tree" aria-label="Vault files">
                {vaultTree ? renderVaultEntry(vaultTree) : <p className="muted">Loading vault...</p>}
                {vaultRecoveryBlocked ? (
                  <button type="button" className="workspace-clear" onClick={clearVaultState}>
                    Clear vault state
                  </button>
                ) : null}
              </nav>
            </>
          ) : (
            <div className="placeholder-list">
              <button type="button" onClick={() => dispatchCommand("file.openVault")}>Open local folder as Vault</button>
              <button type="button" onClick={() => dispatchCommand("file.open")}>Open standalone Markdown</button>
            </div>
          )}

          {!vaultMode ? (
            <>
              <div className="panel-heading compact">
                <span>Open Notes</span>
              </div>
              <nav className="card-list" aria-label="Open notes">
                {notes.map((note) => (
                  <button
                    key={note.id}
                    type="button"
                    className={note.id === activeNote.id ? "card-item active" : "card-item"}
                    onClick={() => setActiveNoteId(note.id)}
                  >
                    <strong>{note.title}</strong>
                    <span>{note.filePath ?? note.markdown.split("\n").find((line) => line.trim() && !line.startsWith("#")) ?? "Markdown note"}</span>
                  </button>
                ))}
              </nav>
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
              value={activeNote.markdown}
              onChange={(event) => handleMarkdownChange(event.target.value)}
              spellCheck
            />
          ) : (
            <Suspense fallback={<div className="editor-loading">Loading rich editor...</div>}>
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

      {rightPanelVisible ? (
        <aside className="right-rail" aria-label="Knowledge panels">
          <section className="knowledge-panel">
            <div className="panel-heading">
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
          </section>

          <section className="knowledge-panel">
            <div className="panel-heading compact">
              <span>Backlinks</span>
            </div>
            <div className="placeholder-list panel-note">
              <p className="muted">Reserved for Vault link indexing.</p>
            </div>
          </section>

          <section className="knowledge-panel">
            <div className="panel-heading compact">
              <span>Note Info</span>
            </div>
            <dl className="info-grid">
              <dt>File</dt>
              <dd title={activeNote.filePath ?? ""}>{activeNote.fileName ?? "Unsaved note"}</dd>
              <dt>Type</dt>
              <dd>{activeNote.fileExt ? `.${activeNote.fileExt}` : "Markdown"}</dd>
              <dt>Lines</dt>
              <dd>{lineCount}</dd>
              <dt>Words</dt>
              <dd>{wordCount}</dd>
            </dl>
          </section>
        </aside>
      ) : null}

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
                      <select value={defaultEditorModeSetting} onChange={(event) => setDefaultEditorModeSetting(event.target.value as EditorMode)}>
                        <option value="plain">Plain Edit</option>
                        <option value="rich">Rich Edit</option>
                      </select>
                    </label>
                    <label className="settings-check">
                      <input type="checkbox" checked={restoreWorkspace} onChange={(event) => setRestoreWorkspace(event.target.checked)} />
                      Restore last vault on startup
                    </label>
                    <label className="settings-check">
                      <input type="checkbox" checked={sidebarVisible} onChange={(event) => setSidebarVisible(event.target.checked)} />
                      Show vault sidebar
                    </label>
                    <label className="settings-check">
                      <input type="checkbox" checked={rightPanelVisible} onChange={(event) => setRightPanelVisible(event.target.checked)} />
                      Show knowledge panel
                    </label>
                  </div>
                ) : null}

                {settingsSection === "editor" ? (
                  <div className="settings-section">
                    <h3>Editor</h3>
                    <label className="settings-field">
                      <span>Font size</span>
                      <input type="number" min={14} max={24} value={editorFontSize} onChange={(event) => setEditorFontSize(Number(event.target.value))} />
                    </label>
                    <label className="settings-field">
                      <span>Line height</span>
                      <input type="number" min={1.4} max={2.2} step={0.05} value={editorLineHeight} onChange={(event) => setEditorLineHeight(Number(event.target.value))} />
                    </label>
                    <label className="settings-field">
                      <span>UI font scale</span>
                      <input type="number" min={MIN_UI_SCALE} max={MAX_UI_SCALE} step={5} value={uiScale} onChange={(event) => setUiScale(clampUiScale(Number(event.target.value)))} />
                    </label>
                    <label className="settings-check">
                      <input type="checkbox" checked={zoomWithWheel} onChange={(event) => setZoomWithWheel(event.target.checked)} />
                      Ctrl + mouse wheel changes font scale
                    </label>
                    <label className="settings-field">
                      <span>Layout left gap</span>
                      <input type="number" min={MIN_EDITOR_LEFT_GAP} max={MAX_EDITOR_LEFT_GAP} value={editorLeftGap} onChange={(event) => setEditorLeftGap(clampEditorLeftGap(Number(event.target.value)))} />
                    </label>
                    <label className="settings-field">
                      <span>Sidebar width</span>
                      <input type="number" min={MIN_SIDEBAR_WIDTH} max={MAX_SIDEBAR_WIDTH} value={sidebarWidth} onChange={(event) => setSidebarWidth(clampSidebarWidth(Number(event.target.value)))} />
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
                                if (event.key === "Enter") event.currentTarget.blur();
                              }}
                              onBlur={() => handleShortcutInputBlur(shortcut.id)}
                            />
                            <label className="shortcut-enabled">
                              <input type="checkbox" checked={shortcut.enabled} onChange={(event) => updateShortcutEnabled(shortcut.id, event.target.checked)} />
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
                        <span>Aqua glass</span>
                      </button>
                      <button type="button" className={theme === "ink" ? "theme-option selected" : "theme-option"} onClick={() => dispatchCommand("theme.ink")}>
                        <span className="theme-swatch ink" />
                        <strong>Dark</strong>
                        <span>Low light</span>
                      </button>
                    </div>
                    <label className="settings-field">
                      <span>Interface density</span>
                      <select value={uiDensity} onChange={(event) => setUiDensity(event.target.value as UIDensity)}>
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
                      <select value={defaultSaveExt} onChange={(event) => setDefaultSaveExt(event.target.value as SaveFileExt)}>
                        <option value="md">.md</option>
                        <option value="txt">.txt</option>
                      </select>
                    </label>
                    <p>Vault metadata: <code>.serein/vault.json</code> and <code>.serein/workspace.json</code></p>
                    <p>Vault root: <code>{vaultRoot ?? "None"}</code></p>
                    <p>Last opened file: <code>{lastOpenedFile ?? "None"}</code></p>
                    <button type="button" className="settings-danger" onClick={clearVaultState}>
                      Clear last vault state
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
