import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { ArrowUpRight, GitBranch, Link2, Pin, PinOff } from "lucide-react";
import type { KnowledgePanelTab, VaultIndexStatus } from "../../app/store/appStore";
import type { AppLanguage, appText } from "../../app/i18n";
import type { Note } from "../../domain/model";
import type { VaultIndex, VaultIndexedFile, VaultLink } from "../../vault";
import type { LocalGraph } from "../../vault";
import { normalizeFilePath } from "../../shared/markdown";
import { Button, SegmentedTabs, cx } from "../../shared/ui";

type TextBundle = (typeof appText)[AppLanguage];

type KnowledgeRailProps = {
  t: TextBundle;
  mode: "docked" | "floating";
  tab: KnowledgePanelTab;
  vaultMode: boolean;
  vaultIndex: VaultIndex | null;
  vaultIndexStatus: VaultIndexStatus;
  vaultIndexError: string | null;
  activeNote: Note;
  activeIndexedFile: VaultIndexedFile | null | undefined;
  activeBacklinks: VaultLink[];
  activeOutgoingLinks: VaultLink[];
  activeResolvedLinks: VaultLink[];
  activeUnresolvedLinks: VaultLink[];
  localGraph: LocalGraph;
  lineCount: number;
  textStats: { words: number; characters: number };
  floatingPanelPosition?: { x: number; y: number };
  onTabChange: (tab: KnowledgePanelTab) => void;
  onToggleFloating: () => void;
  onFloatingPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onGraphNodeClick: (path: string) => void;
};

export function KnowledgeRail({
  t,
  mode,
  tab,
  vaultMode,
  vaultIndex,
  vaultIndexStatus,
  vaultIndexError,
  activeNote,
  activeIndexedFile,
  activeBacklinks,
  activeOutgoingLinks,
  activeResolvedLinks,
  activeUnresolvedLinks,
  localGraph,
  lineCount,
  textStats,
  floatingPanelPosition,
  onTabChange,
  onToggleFloating,
  onFloatingPointerDown,
  onGraphNodeClick,
}: KnowledgeRailProps) {
  const localGraphNodeMap = new Map(localGraph.nodes.map((node) => [normalizeFilePath(node.path), node]));
  const indexMessages = [
    vaultIndexStatus === "indexing" ? t.knowledge.indexing : null,
    vaultIndexStatus === "error" ? vaultIndexError : null,
    vaultIndex?.truncated ? t.knowledge.indexPartial : null,
    vaultIndex?.skippedFiles ? t.knowledge.skippedFiles(vaultIndex.skippedFiles) : null,
  ].filter((message): message is string => Boolean(message));
  const currentPath = activeNote.filePath ? normalizeFilePath(activeNote.filePath) : null;
  const backlinkCount = activeBacklinks.length;
  const outgoingCount = activeResolvedLinks.length;
  const panel = (
    <section className={cx("knowledge-panel", mode)}>
      {mode === "floating" ? (
        <div
          className="floating-panel-titlebar"
          onPointerDown={onFloatingPointerDown}
          onDoubleClick={onToggleFloating}
        >
          <strong>{t.knowledge.title}</strong>
          <Button variant="ghost" icon={<Pin size={14} />} onClick={onToggleFloating}>{t.knowledge.dock}</Button>
        </div>
      ) : null}

      <SegmentedTabs
        className="knowledge-tabs"
        label={t.knowledge.tabsAria}
        value={tab}
        items={[
          { id: "backlinks", label: t.knowledge.backlinks },
          { id: "outgoing", label: t.knowledge.outgoing },
          { id: "graph", label: t.knowledge.graph },
        ]}
        onChange={onTabChange}
      />
      <Button
        className="panel-mode-button"
        variant="ghost"
        icon={mode === "floating" ? <Pin size={14} /> : <PinOff size={14} />}
        onClick={onToggleFloating}
      >
        {mode === "floating" ? t.knowledge.dock : t.knowledge.float}
      </Button>

      <div className="knowledge-summary" aria-label={t.knowledge.relationshipSummary(backlinkCount, outgoingCount)}>
        <span>{backlinkCount}</span>
        <small>{t.knowledge.backlinks}</small>
        <span>{outgoingCount}</span>
        <small>{t.knowledge.outgoing}</small>
      </div>

      {vaultMode && indexMessages.length ? (
        <div className="index-status">
          {indexMessages.map((message) => <span key={message}>{message}</span>)}
        </div>
      ) : null}

      {tab === "backlinks" ? (
        <div className="knowledge-section" role="tabpanel">
          <h3>{t.knowledge.linkedMentions}</h3>
          <div className="link-list">
            {activeBacklinks.length ? activeBacklinks.map((backlink, index) => (
              <button
                key={`${backlink.targetPath}-${index}`}
                type="button"
                className="link-item relation-item"
                onClick={() => backlink.targetPath && onGraphNodeClick(backlink.targetPath)}
              >
                <Link2 size={14} aria-hidden="true" />
                <strong>{backlink.label}</strong>
                <span>{backlink.rawTarget}</span>
              </button>
            )) : (
              <p className="muted">
                {vaultMode ? t.knowledge.noBacklinks : t.knowledge.openVaultForBacklinks}
              </p>
            )}
          </div>
        </div>
      ) : null}

      {tab === "outgoing" ? (
        <div className="knowledge-section" role="tabpanel">
          <h3>{t.knowledge.outgoingLinks}</h3>
          <div className="link-list">
            {activeResolvedLinks.length ? activeResolvedLinks.map((link, index) => (
              <button
                key={`${link.targetPath}-${index}`}
                type="button"
                className="link-item relation-item"
                onClick={() => link.targetPath && onGraphNodeClick(link.targetPath)}
              >
                <ArrowUpRight size={14} aria-hidden="true" />
                <strong>{link.label || link.rawTarget}</strong>
                <span>{link.rawTarget}</span>
              </button>
            )) : (
              <p className="muted">{vaultMode ? t.knowledge.noOutgoingLinks : t.knowledge.openVaultForGraph}</p>
            )}
          </div>
          {activeUnresolvedLinks.length ? (
            <div className="unresolved-links">
              <strong>{t.knowledge.unresolvedMentions}</strong>
              {activeUnresolvedLinks.slice(0, 8).map((link, index) => (
                <span key={`${link.rawTarget}-${index}`} title={link.unresolvedReason ?? ""}>{link.rawTarget}</span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "graph" ? (
        <div className="knowledge-section local-graph" role="tabpanel">
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
                    onClick={() => onGraphNodeClick(node.path)}
                  >
                    <circle r={node.role === "current" ? 5.4 : 4.2} />
                    <text y={node.role === "current" ? -8 : -6}>{node.title}</text>
                  </g>
                ))}
              </svg>
              <p className="graph-note">
                <GitBranch size={14} aria-hidden="true" />
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
        </div>
      ) : null}

      <footer className="note-metadata">
        <strong title={activeNote.filePath ?? ""}>{activeNote.fileName ?? t.knowledge.unsavedNote}</strong>
        <span>{activeNote.fileExt ? `.${activeNote.fileExt}` : "Markdown"}</span>
        <span>{lineCount} {t.knowledge.lines}</span>
        <span>{textStats.words} {t.knowledge.words}</span>
        <span>{textStats.characters} {t.knowledge.characters}</span>
        <span>{activeResolvedLinks.length}/{activeOutgoingLinks.length} {t.knowledge.links}</span>
        <span>{activeIndexedFile?.tags.length ? activeIndexedFile.tags.map((tag) => `#${tag}`).join(", ") : t.knowledge.none}</span>
        {currentPath ? null : <span>{t.knowledge.currentFileNotIndexed}</span>}
      </footer>
    </section>
  );

  if (mode === "floating") {
    return (
      <aside
        className="floating-knowledge-panel"
        aria-label={t.aria.floatingKnowledgePanel}
        style={{
          "--floating-panel-x": `${floatingPanelPosition?.x ?? 920}px`,
          "--floating-panel-y": `${floatingPanelPosition?.y ?? 112}px`,
        } as CSSProperties}
      >
        {panel}
      </aside>
    );
  }

  return <aside className="right-rail" aria-label={t.aria.knowledgePanels}>{panel}</aside>;
}
