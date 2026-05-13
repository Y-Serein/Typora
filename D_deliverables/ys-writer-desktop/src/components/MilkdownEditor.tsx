import { useEffect, useRef } from "react";
import { commandsCtx, defaultValueCtx, Editor, editorViewCtx, rootCtx } from "@milkdown/kit/core";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { history } from "@milkdown/kit/plugin/history";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import {
  createCodeBlockCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from "@milkdown/kit/preset/commonmark";
import { gfm, toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm";
import { lift, selectAll } from "@milkdown/kit/prose/commands";
import { liftListItem, splitListItem } from "@milkdown/kit/prose/schema-list";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { Command } from "@milkdown/kit/prose/state";
import { $shortcut } from "@milkdown/kit/utils";
import { Milkdown, MilkdownProvider, useEditor, useInstance } from "@milkdown/react";
import type { EditorCommandSignal } from "../domain/model";

type MilkdownEditorProps = {
  markdown: string;
  onChange: (markdown: string) => void;
  command: EditorCommandSignal | null;
};

const handleNestedEnter: Command = (state, dispatch) => {
  const { selection } = state;
  if (!selection.empty) return false;

  const { $from } = selection;
  const currentNode = $from.parent;
  const parentNode = $from.depth > 0 ? $from.node($from.depth - 1) : null;
  const isEmptyParagraph = currentNode.type.name === "paragraph" && currentNode.content.size === 0;

  if (!isEmptyParagraph) return false;

  for (let depth = $from.depth - 1; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === "blockquote") {
      const range = $from.blockRange($from, (node) => node.type.name === "blockquote");
      if (!range) return lift(state, dispatch);

      if (dispatch) {
        try {
          dispatch(state.tr.lift(range, depth - 1).scrollIntoView());
        } catch (error) {
          console.warn("Failed to lift blockquote paragraph", error);
          return lift(state, dispatch);
        }
      }
      return true;
    }
  }

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
  Enter: handleNestedEnter,
}));

const selectCurrentCodeBlock: Command = (state, dispatch) => {
  const { $from } = state.selection;

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name !== "code_block") continue;

    const from = $from.start(depth);
    const to = $from.end(depth);
    if (dispatch) {
      dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to)).scrollIntoView());
    }
    return true;
  }

  return false;
};

const smartSelectAllShortcut = $shortcut(() => ({
  "Mod-a": selectCurrentCodeBlock,
}));

function runEditorCommand(editor: Editor, command: EditorCommandSignal) {
  editor.action((ctx) => {
    const commands = ctx.get(commandsCtx);
    const view = ctx.get(editorViewCtx);
    view.focus();

    switch (command.action) {
      case "paragraph":
        commands.call(turnIntoTextCommand.key);
        break;
      case "heading1":
        commands.call(wrapInHeadingCommand.key, 1);
        break;
      case "heading2":
        commands.call(wrapInHeadingCommand.key, 2);
        break;
      case "heading3":
        commands.call(wrapInHeadingCommand.key, 3);
        break;
      case "blockquote":
        commands.call(wrapInBlockquoteCommand.key);
        break;
      case "bulletList":
        commands.call(wrapInBulletListCommand.key);
        break;
      case "orderedList":
        commands.call(wrapInOrderedListCommand.key);
        break;
      case "codeBlock":
        commands.call(createCodeBlockCommand.key);
        break;
      case "bold":
        commands.call(toggleStrongCommand.key);
        break;
      case "italic":
        commands.call(toggleEmphasisCommand.key);
        break;
      case "inlineCode":
        commands.call(toggleInlineCodeCommand.key);
        break;
      case "strike":
        commands.call(toggleStrikethroughCommand.key);
        break;
      case "link":
        if (command.payload) {
          commands.call(toggleLinkCommand.key, { href: command.payload });
        }
        break;
      case "selectAllSmart":
        commands.inline(selectCurrentCodeBlock) || commands.inline(selectAll);
        break;
      default:
        break;
    }
  });
}

function EditorSurface({ markdown, onChange, command }: MilkdownEditorProps) {
  const initialMarkdownRef = useRef(markdown);
  const onChangeRef = useRef(onChange);
  const [loading, getEditor] = useInstance();

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (loading || !command) return;
    const editor = getEditor();
    if (!editor) return;
    runEditorCommand(editor, command);
  }, [command, getEditor, loading]);

  useEffect(() => {
    if (loading) return undefined;
    const editor = getEditor();
    if (!editor) return undefined;

    return editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const handleKeyDown = (event: KeyboardEvent) => {
        const isSelectAll = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "a";
        if (!isSelectAll) return;
        const handled = selectCurrentCodeBlock(view.state, view.dispatch, view);
        if (!handled) return;
        event.preventDefault();
        event.stopPropagation();
      };

      view.dom.addEventListener("keydown", handleKeyDown, { capture: true });
      return () => view.dom.removeEventListener("keydown", handleKeyDown, { capture: true });
    });
  }, [getEditor, loading]);

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
      .use(gfm)
      .use(history)
      .use(nestedEnterShortcut)
      .use(smartSelectAllShortcut)
      .use(listener);
  }, []);

  return <Milkdown />;
}

export function MilkdownEditor({ markdown, onChange, command }: MilkdownEditorProps) {
  return (
    <MilkdownProvider>
      <EditorSurface markdown={markdown} onChange={onChange} command={command} />
    </MilkdownProvider>
  );
}
