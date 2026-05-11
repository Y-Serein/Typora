import { useEffect, useRef } from "react";
import { defaultValueCtx, Editor, rootCtx } from "@milkdown/kit/core";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { lift } from "@milkdown/kit/prose/commands";
import type { Command } from "@milkdown/kit/prose/state";
import { $shortcut } from "@milkdown/kit/utils";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";

type MilkdownEditorProps = {
  markdown: string;
  onChange: (markdown: string) => void;
};

const exitEmptyBlockquote: Command = (state, dispatch) => {
  const { selection } = state;
  if (!selection.empty) return false;

  const { $from } = selection;
  const currentNode = $from.parent;
  const parentNode = $from.depth > 0 ? $from.node($from.depth - 1) : null;
  const isEmptyParagraph = currentNode.type.name === "paragraph" && currentNode.content.size === 0;
  const isDirectlyInBlockquote = parentNode?.type.name === "blockquote";

  if (!isEmptyParagraph || !isDirectlyInBlockquote) return false;

  return lift(state, dispatch);
};

const blockquoteExitShortcut = $shortcut(() => ({
  Enter: {
    key: "Enter",
    onRun: () => exitEmptyBlockquote,
    priority: 100,
  },
}));

function EditorSurface({ markdown, onChange }: MilkdownEditorProps) {
  const initialMarkdownRef = useRef(markdown);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEditor((root) => {
    return Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, initialMarkdownRef.current);
        ctx.get(listenerCtx).markdownUpdated((_, nextMarkdown) => {
          onChangeRef.current(nextMarkdown);
        });
      })
      .use(commonmark)
      .use(blockquoteExitShortcut)
      .use(listener);
  }, []);

  return <Milkdown />;
}

export function MilkdownEditor({ markdown, onChange }: MilkdownEditorProps) {
  return (
    <MilkdownProvider>
      <EditorSurface markdown={markdown} onChange={onChange} />
    </MilkdownProvider>
  );
}
