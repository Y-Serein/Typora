import { useCallback, useMemo, useState } from "react";
import { MilkdownEditor } from "./components/MilkdownEditor";
import { demoWorkspace } from "./data/demoWorkspace";
import type { Card } from "./domain/model";
import "./styles.css";

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

export default function App() {
  const [cards, setCards] = useState<Card[]>(demoWorkspace.cards);
  const [activeCardId, setActiveCardId] = useState(cards[0]?.id ?? "");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [theme, setTheme] = useState<"paper" | "ink">("paper");

  const activeCard = cards.find((card) => card.id === activeCardId) ?? cards[0];
  const outline = useMemo(() => extractOutline(activeCard.markdown), [activeCard.markdown]);
  const handleMarkdownChange = useCallback((markdown: string) => {
    setCards((currentCards) => currentCards.map((card) => {
      if (card.id !== activeCardId) return card;
      return {
        ...card,
        markdown,
        updatedAt: new Date().toISOString(),
      };
    }));
  }, [activeCardId]);

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
          <button type="button" onClick={() => setSavedAt(new Date())}>Save</button>
          <button type="button" disabled>Export</button>
          <button type="button" disabled>Undo</button>
          <button type="button" disabled>Redo</button>
        </div>

        <div className="topbar-meta">
          <button type="button" onClick={() => setTheme(theme === "paper" ? "ink" : "paper")}>
            {theme === "paper" ? "Ink" : "Paper"}
          </button>
          <span>{savedAt ? `Saved ${formatTime(savedAt)}` : "Demo data"}</span>
        </div>
      </header>

      <aside className="left-rail">
        <div className="panel-heading">
          <span>Cards</span>
          <button type="button" disabled>+</button>
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

        <section className="editor-surface" aria-label="Markdown editor">
          <MilkdownEditor
            key={activeCard.id}
            markdown={activeCard.markdown}
            onChange={handleMarkdownChange}
          />
        </section>
      </main>

      <aside className="right-rail">
        <section>
          <div className="panel-heading">
            <span>Outline</span>
          </div>
          <div className="outline-list">
            {outline.length ? outline.map((item, index) => (
              <button key={`${item.text}-${index}`} type="button" className={`outline-item level-${item.level}`}>
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
