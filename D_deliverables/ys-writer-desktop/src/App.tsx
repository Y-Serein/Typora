import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { demoWorkspace } from "./data/demoWorkspace";
import type { Card } from "./domain/model";
import "./styles.css";

const MilkdownEditor = lazy(() => import("./components/MilkdownEditor").then((module) => ({
  default: module.MilkdownEditor,
})));

const WORKSPACE_STORAGE_KEY = "ys-writer.workspace.v1";

type PersistedWorkspace = {
  cards: Card[];
  savedAt: string | null;
};

type InitialWorkspace = PersistedWorkspace & {
  loadError: string | null;
};

type SaveStatus = "idle" | "saved" | "error";

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

export default function App() {
  const [initialWorkspace] = useState(readInitialWorkspace);
  const [cards, setCards] = useState<Card[]>(initialWorkspace.cards);
  const [activeCardId, setActiveCardId] = useState(cards[0]?.id ?? "");
  const [savedAt, setSavedAt] = useState<Date | null>(
    initialWorkspace.savedAt ? new Date(initialWorkspace.savedAt) : null,
  );
  const [saveError, setSaveError] = useState<string | null>(initialWorkspace.loadError);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [theme, setTheme] = useState<"paper" | "ink">("paper");
  const editorSurfaceRef = useRef<HTMLElement | null>(null);

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
    if (saveStatus === "idle") return undefined;

    const timeout = window.setTimeout(() => setSaveStatus("idle"), 1200);
    return () => window.clearTimeout(timeout);
  }, [saveStatus]);

  const handleCreateCard = useCallback(() => {
    const card = createCard();
    setCards((currentCards) => [card, ...currentCards]);
    setActiveCardId(card.id);
  }, []);

  const handleOutlineClick = useCallback((index: number) => {
    const headings = editorSurfaceRef.current?.querySelectorAll(".milkdown h1, .milkdown h2, .milkdown h3");
    const heading = headings?.item(index);
    heading?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <div className="desktop-shell" data-theme={theme}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">YS</span>
          <div>
            <strong>YS Writer</strong>
            <span>Local-first Markdown Desktop</span>
          </div>
        </div>

        <div className="toolbar" aria-label="Primary toolbar">
          <button type="button" className={`save-button ${saveStatus}`} onClick={handleSave}>
            {saveStatus === "saved" ? "Saved" : saveStatus === "error" ? "Failed" : "Save"}
          </button>
          <button type="button" disabled>Export</button>
          <button type="button" disabled>Undo</button>
          <button type="button" disabled>Redo</button>
        </div>

        <div className="topbar-meta">
          <button type="button" onClick={() => setTheme(theme === "paper" ? "ink" : "paper")}>
            {theme === "paper" ? "Ink" : "Paper"}
          </button>
          <span>{saveError ?? (savedAt ? `Saved ${formatTime(savedAt)}` : "Demo data")}</span>
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
          <span>Whiteboards</span>
        </div>
        <div className="placeholder-list">
          <button type="button" disabled>Main Whiteboard</button>
        </div>
      </aside>

      <main className="editor-column">
        <div className="document-strip">
          <div>
            <span className="eyebrow">Card</span>
            <h1>{activeCard.title}</h1>
          </div>
          <div className="doc-actions">
            <span>Markdown</span>
            <span>Milkdown</span>
          </div>
        </div>

        <section ref={editorSurfaceRef} className="editor-surface" aria-label="Markdown editor">
          <Suspense fallback={<div className="editor-loading">Loading editor...</div>}>
            <MilkdownEditor
              key={activeCard.id}
              markdown={activeCard.markdown}
              onChange={handleMarkdownChange}
            />
          </Suspense>
        </section>
      </main>

      <aside className="right-rail">
        <section>
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

        <section>
          <div className="panel-heading">
            <span>Info</span>
          </div>
          <dl className="info-grid">
            <dt>Tags</dt>
            <dd>{activeCard.tagIds.length}</dd>
            <dt>Backlinks</dt>
            <dd>Reserved</dd>
            <dt>Whiteboard</dt>
            <dd>Reserved</dd>
          </dl>
        </section>
      </aside>
    </div>
  );
}
