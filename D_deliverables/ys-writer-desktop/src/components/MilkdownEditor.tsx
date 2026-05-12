import { useEffect, useRef } from "react";
import { defaultValueCtx, Editor, rootCtx } from "@milkdown/kit/core";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { history } from "@milkdown/kit/plugin/history";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { lift } from "@milkdown/kit/prose/commands";
import { liftListItem, splitListItem } from "@milkdown/kit/prose/schema-list";
import type { Command } from "@milkdown/kit/prose/state";
import { $shortcut } from "@milkdown/kit/utils";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";

type MilkdownEditorProps = {
  markdown: string;
  onChange: (markdown: string) => void;
};

const handleNestedEnter: Command = (state, dispatch) => {
  const { selection } = state;
  if (!selection.empty) return false;

  const { $from } = selection;
  const currentNode = $from.parent;
  const parentNode = $from.depth > 0 ? $from.node($from.depth - 1) : null;
  const isEmptyParagraph = currentNode.type.name === "paragraph" && currentNode.content.size === 0;

  if (!isEmptyParagraph) return false;

  if (parentNode?.type.name === "blockquote") return lift(state, dispatch);

  const listItemType = state.schema.nodes.list_item;
  if (!listItemType) return false;
  if (parentNode?.type !== listItemType) return false;

  const listItemNode = parentNode;
  const isOnlyEmptyParagraph = listItemNode.childCount === 1
    && listItemNode.child(0).type.name === "paragraph"
    && listItemNode.child(0).content.size === 0;

  if (isOnlyEmptyParagraph) return liftListItem(listItemType)(state, dispatch);
  return splitListItem(listItemType)(state, dispatch);
};

const nestedEnterShortcut = $shortcut(() => ({
  Enter: {
    key: "Enter",
    onRun: () => handleNestedEnter,
    priority: 1000,
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
      .use(history)
      .use(nestedEnterShortcut)
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
