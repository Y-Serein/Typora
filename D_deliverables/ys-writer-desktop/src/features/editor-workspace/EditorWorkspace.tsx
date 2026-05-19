import { lazy, Suspense, type RefObject } from "react";
import type { EditorCommandSignal, Note } from "../../domain/model";
import type { EditorMode } from "../../app/types";
import type { AppLanguage, appText } from "../../app/i18n";

const MilkdownEditor = lazy(() => import("../../components/MilkdownEditor").then((module) => ({
  default: module.MilkdownEditor,
})));

type TextBundle = (typeof appText)[AppLanguage];

type EditorWorkspaceProps = {
  t: TextBundle;
  activeNote: Note;
  hasActiveDocument: boolean;
  editorMode: EditorMode;
  richCommand: EditorCommandSignal | null;
  editorSurfaceRef: RefObject<HTMLElement>;
  plainEditorRef: RefObject<HTMLTextAreaElement>;
  onMarkdownChange: (markdown: string) => void;
  onOpenLink: (href: string) => boolean;
};

export function EditorWorkspace({
  t,
  activeNote,
  hasActiveDocument,
  editorMode,
  richCommand,
  editorSurfaceRef,
  plainEditorRef,
  onMarkdownChange,
  onOpenLink,
}: EditorWorkspaceProps) {
  return (
    <main className="editor-column">
      <section ref={editorSurfaceRef} className="editor-surface" aria-label={t.aria.markdownEditor}>
        {!hasActiveDocument ? (
          <div className="editor-empty-state">{t.editor.emptyHint}</div>
        ) : editorMode === "plain" ? (
          <textarea
            ref={plainEditorRef}
            className="markdown-editor"
            value={activeNote.markdown}
            onChange={(event) => onMarkdownChange(event.target.value)}
            spellCheck
          />
        ) : (
          <Suspense fallback={<div className="editor-loading">{t.aria.loadingRichEditor}</div>}>
            <MilkdownEditor
              key={activeNote.id}
              markdown={activeNote.markdown}
              onChange={onMarkdownChange}
              command={richCommand}
              onOpenLink={onOpenLink}
            />
          </Suspense>
        )}
      </section>
    </main>
  );
}
