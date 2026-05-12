import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { demoWorkspace } from "./data/demoWorkspace";
import type { Card } from "./domain/model";
import "./styles.css";

const MilkdownEditor = lazy(() => import("./components/MilkdownEditor").then((module) => ({
  default: module.MilkdownEditor,
})));

const WORKSPACE_STORAGE_KEY = "ys-writer.workspace.v1";
const SETTINGS_STORAGE_KEY = "ys-writer.settings.v1";
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 360;

type PersistedWorkspace = {
  cards: Card[];
  savedAt: string | null;
};

type InitialWorkspace = PersistedWorkspace & {
  loadError: string | null;
};

type SaveStatus = "idle" | "saved" | "error";
type EditorMode = "plain" | "rich";
type ThemeStyle = "daily" | "eye" | "ink";

type AppSettings = {
  theme: ThemeStyle;
  sidebarWidth: number;
};

const defaultEditorMode: EditorMode = import.meta.env.PROD ? "rich" : "plain";
const defaultSettings: AppSettings = {
  theme: "daily",
  sidebarWidth: 220,
};

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

function readInitialWorkspace(): InitialWorkspace {
  const fallback = {
    cards: demoWorkspace.cards,
    savedAt: null,
    loadError: null,
  };

  if (typeof window === "undefined") return fallback;

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

function writeWorkspace(cards: Card[]) {
  const savedAt = new Date();
  const payload: PersistedWorkspace = {
    cards,
    savedAt: savedAt.toISOString(),
  };

  window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(payload));
  return savedAt;
}

function clampSidebarWidth(width: number) {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width));
}

function readSettings(): AppSettings {
  if (typeof window === "undefined") return defaultSettings;

  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return defaultSettings;

    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const theme: ThemeStyle = parsed.theme === "eye" || parsed.theme === "ink" ? parsed.theme : "daily";
    const sidebarWidth = typeof parsed.sidebarWidth === "number"
      ? clampSidebarWidth(parsed.sidebarWidth)
      : defaultSettings.sidebarWidth;

    return { theme, sidebarWidth };
  } catch (error) {
    console.warn("Failed to read settings", error);
    return defaultSettings;
  }
}

function writeSettings(settings: AppSettings) {
  window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

export default function App() {
  const [initialWorkspace] = useState(readInitialWorkspace);
  const [initialSettings] = useState(readSettings);
  const [cards, setCards] = useState<Card[]>(initialWorkspace.cards);
  const [activeCardId, setActiveCardId] = useState(cards[0]?.id ?? "");
  const [savedAt, setSavedAt] = useState<Date | null>(
    initialWorkspace.savedAt ? new Date(initialWorkspace.savedAt) : null,
  );
  const [saveError, setSaveError] = useState<string | null>(initialWorkspace.loadError);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [editorMode, setEditorMode] = useState<EditorMode>(defaultEditorMode);
  const [theme, setTheme] = useState<ThemeStyle>(initialSettings.theme);
  const [sidebarWidth, setSidebarWidth] = useState(initialSettings.sidebarWidth);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const editorSurfaceRef = useRef<HTMLElement | null>(null);
  const plainEditorRef = useRef<HTMLTextAreaElement | null>(null);

  const activeCard = cards.find((card) => card.id === activeCardId) ?? cards[0];
  const outline = useMemo(() => extractOutline(activeCard.markdown), [activeCard.markdown]);

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

  const handleSave = useCallback(() => {
    try {
      const nextSavedAt = writeWorkspace(cards);
      setSavedAt(nextSavedAt);
      setSaveError(null);
      setSaveStatus("saved");
    } catch (error) {
      console.error("Failed to save workspace", error);
      setSaveError("Save failed");
      setSaveStatus("error");
    }
  }, [cards]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        const nextSavedAt = writeWorkspace(cards);
        setSavedAt(nextSavedAt);
        setSaveError(null);
      } catch (error) {
        console.error("Failed to autosave workspace", error);
        setSaveError("Autosave failed");
      }
    }, 700);

    return () => window.clearTimeout(timeout);
  }, [cards]);

  useEffect(() => {
    writeSettings({ theme, sidebarWidth });
  }, [theme, sidebarWidth]);

  useEffect(() => {
    if (saveStatus === "idle") return undefined;

    const timeout = window.setTimeout(() => setSaveStatus("idle"), 1200);
    return () => window.clearTimeout(timeout);
  }, [saveStatus]);

  const handleCreateCard = useCallback(() => {
    const card = createCard();
    setCards((currentCards) => [card, ...currentCards]);
    setActiveCardId(card.id);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const command = event.ctrlKey || event.metaKey;

      if (!command) {
        if (event.key === "Escape") setSettingsOpen(false);
        return;
      }

      if (key === "s") {
        event.preventDefault();
        handleSave();
      } else if (key === "n") {
        event.preventDefault();
        handleCreateCard();
      } else if (key === ",") {
        event.preventDefault();
        setSettingsOpen((open) => !open);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleCreateCard, handleSave]);

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

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setSidebarWidth(clampSidebarWidth(startWidth + moveEvent.clientX - startX));
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }, [sidebarWidth]);

  return (
    <div
      className="desktop-shell"
      data-theme={theme}
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <header className="menu-bar" aria-label="Application menu">
        <div className="menu-group">
          <strong className="menu-title">YS Writer</strong>
          <button
            type="button"
            className={editorMode === "rich" ? "active-mode" : ""}
            onClick={() => setEditorMode(editorMode === "plain" ? "rich" : "plain")}
          >
            {editorMode === "plain" ? "Rich Edit" : "Plain Edit"}
          </button>
        </div>

        <div className="menu-status">
          <span>{saveStatus === "saved" ? "Saved" : saveError ?? (savedAt ? `Autosaved ${formatTime(savedAt)}` : "Local draft")}</span>
          <button type="button" onClick={() => setSettingsOpen(true)}>Settings</button>
        </div>
      </header>

      <aside className="left-rail">
        <div className="panel-heading">
          <span>Cards</span>
          <button type="button" onClick={handleCreateCard}>+</button>
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
              <span>{card.markdown.split("\n").find((line) => line.trim() && !line.startsWith("#")) ?? "Markdown card"}</span>
            </button>
          ))}
        </nav>

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
        <div
          className="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onPointerDown={handleSidebarPointerDown}
        />
      </aside>

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

            <div className="settings-section">
              <h3>Theme</h3>
              <div className="theme-options">
                <button type="button" className={theme === "daily" ? "selected" : ""} onClick={() => setTheme("daily")}>Daily</button>
                <button type="button" className={theme === "eye" ? "selected" : ""} onClick={() => setTheme("eye")}>Eye Care</button>
                <button type="button" className={theme === "ink" ? "selected" : ""} onClick={() => setTheme("ink")}>Dark</button>
              </div>
            </div>

            <div className="settings-section">
              <h3>Storage</h3>
              <p>Current: localStorage key <code>{WORKSPACE_STORAGE_KEY}</code></p>
              <p>File path save is reserved for the next storage milestone.</p>
            </div>

            <div className="settings-section">
              <h3>Shortcuts</h3>
              <dl className="shortcut-list">
                <dt>Ctrl+S</dt><dd>Save current workspace</dd>
                <dt>Ctrl+N</dt><dd>New card</dd>
                <dt>Ctrl+,</dt><dd>Open settings</dd>
                <dt>Ctrl+Z / X / C / V</dt><dd>Native editor undo, cut, copy, paste</dd>
                <dt>Esc</dt><dd>Close settings</dd>
              </dl>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
