import { useEffect, useRef } from "react";
import { defaultHighlightStyle, LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages as codeMirrorLanguages } from "@codemirror/language-data";
import { EditorView as CodeMirrorView } from "@codemirror/view";
import { commandsCtx, defaultValueCtx, Editor, editorViewCtx, rootCtx } from "@milkdown/kit/core";
import { codeBlockComponent, codeBlockConfig } from "@milkdown/kit/component/code-block";
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
import type { EditorView } from "@milkdown/kit/prose/view";
import { $shortcut } from "@milkdown/kit/utils";
import { Milkdown, MilkdownProvider, useEditor, useInstance } from "@milkdown/react";
import type { EditorCommandSignal } from "../domain/model";

type MilkdownEditorProps = {
  markdown: string;
  onChange: (markdown: string) => void;
  command: EditorCommandSignal | null;
  onOpenLink: (href: string) => boolean;
};

type LinkRange = {
  from: number;
  to: number;
  href: string;
  attrs: Record<string, unknown>;
};

type ExpandedLinkRange = {
  from: number;
  to: number;
};

const codeBlockLanguages = codeMirrorLanguages.map((language) => {
  if (language.name !== "Shell") return language;
  return LanguageDescription.of({
    name: "bash",
    alias: ["bash", "sh", "zsh", "shell"],
    extensions: ["sh", "ksh", "bash"],
    load: () => language.load(),
  });
});

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

const moveWithinMarkdownLink = (direction: -1 | 1 | "start" | "end"): Command => (_state, dispatch, view) => {
  if (!view || !view.state.selection.empty) return false;

  const range = markdownLinkTextRangeAtCursor(view);
  if (!range) return false;

  const cursorPos = view.state.selection.from;
  let nextPos: number;
  if (direction === "start") {
    nextPos = range.from;
  } else if (direction === "end") {
    nextPos = range.to;
  } else {
    if (direction < 0 && cursorPos <= range.from) return false;
    if (direction > 0 && cursorPos >= range.to) return false;
    nextPos = cursorPos + direction;
  }

  if (dispatch) {
    dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, nextPos)).scrollIntoView());
  }
  return true;
};

const markdownLinkNavigationShortcut = $shortcut(() => ({
  ArrowLeft: { key: "ArrowLeft", priority: 100, onRun: () => moveWithinMarkdownLink(-1) },
  ArrowRight: { key: "ArrowRight", priority: 100, onRun: () => moveWithinMarkdownLink(1) },
  Home: { key: "Home", priority: 100, onRun: () => moveWithinMarkdownLink("start") },
  End: { key: "End", priority: 100, onRun: () => moveWithinMarkdownLink("end") },
}));

function findCodeBlockPos(view: EditorView, codeBlockDom: HTMLElement) {
  let found: number | null = null;
  view.state.doc.descendants((node, pos) => {
    if (found !== null || node.type.name !== "code_block") return false;
    const dom = view.nodeDOM(pos);
    if (dom instanceof HTMLElement && (dom === codeBlockDom || dom.contains(codeBlockDom))) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}

function exitCodeBlockAfter(view: EditorView, codeBlockDom: HTMLElement) {
  const pos = findCodeBlockPos(view, codeBlockDom);
  if (pos === null) return false;

  const node = view.state.doc.nodeAt(pos);
  const paragraph = view.state.schema.nodes.paragraph;
  if (!node || node.type.name !== "code_block" || !paragraph) return false;

  const after = pos + node.nodeSize;
  let tr = view.state.tr;

  if (after >= view.state.doc.content.size) {
    tr = tr.insert(after, paragraph.create());
    tr = tr.setSelection(TextSelection.create(tr.doc, after + 1));
  } else {
    tr = tr.setSelection(TextSelection.near(tr.doc.resolve(after), 1));
  }

  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

function updateCodeBlockLanguage(view: EditorView, codeBlockDom: HTMLElement, language: string) {
  const pos = findCodeBlockPos(view, codeBlockDom);
  if (pos === null) return false;

  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "code_block") return false;

  view.dispatch(view.state.tr.setNodeAttribute(pos, "language", language.trim()).scrollIntoView());
  return true;
}

function activeCodeMirrorLine(codeBlockDom: HTMLElement) {
  const cm = CodeMirrorView.findFromDOM(codeBlockDom);
  if (cm) {
    const line = cm.state.doc.lineAt(cm.state.selection.main.head);
    return {
      isLastLine: line.number === cm.state.doc.lines,
      isBlank: line.text.trim() === "",
    };
  }

  const activeLine = document.getSelection()?.anchorNode instanceof Node
    ? document.getSelection()?.anchorNode?.parentElement?.closest<HTMLElement>(".cm-line")
    : null;
  const lines = [...codeBlockDom.querySelectorAll<HTMLElement>(".cm-line")];

  return {
    isLastLine: Boolean(activeLine && lines[lines.length - 1] === activeLine),
    isBlank: (activeLine?.textContent ?? "").trim() === "",
  };
}

function currentLanguageText(button: HTMLButtonElement) {
  return button.getAttribute("data-language-draft") ?? button.textContent?.trim() ?? "";
}

function beginLanguageEdit(button: HTMLButtonElement, initialValue?: string) {
  const value = initialValue ?? button.textContent?.trim() ?? "";
  button.setAttribute("data-language-draft", value);
  button.setAttribute("data-language-fresh", "true");
}

function setLanguageDraft(button: HTMLButtonElement, value: string, fresh = false) {
  button.setAttribute("data-language-draft", value);
  button.setAttribute("data-language-fresh", fresh ? "true" : "false");
}

function finishLanguageEdit(button: HTMLButtonElement) {
  button.removeAttribute("data-language-draft");
  button.removeAttribute("data-language-fresh");
}

function isLanguagePickerOpen(button: HTMLButtonElement) {
  return button.getAttribute("data-expanded") === "true";
}

function closeLanguagePicker(button: HTMLButtonElement) {
  if (isLanguagePickerOpen(button)) button.click();
}

function languagePickerItems(codeBlockDom: HTMLElement) {
  return [...codeBlockDom.querySelectorAll<HTMLElement>(".language-list-item[data-language]")]
    .filter((item) => !item.classList.contains("no-result"));
}

function focusLanguagePickerItem(codeBlockDom: HTMLElement, direction: 1 | -1) {
  const items = languagePickerItems(codeBlockDom);
  if (!items.length) return false;

  const activeElement = document.activeElement;
  const currentIndex = activeElement instanceof HTMLElement ? items.indexOf(activeElement) : -1;
  const nextIndex = currentIndex === -1
    ? (direction > 0 ? 0 : items.length - 1)
    : Math.min(Math.max(currentIndex + direction, 0), items.length - 1);

  items[nextIndex]?.focus();
  return true;
}

function commitLanguageDraft(view: EditorView, codeBlockDom: HTMLElement, button: HTMLButtonElement) {
  updateCodeBlockLanguage(view, codeBlockDom, currentLanguageText(button));
  finishLanguageEdit(button);
  closeLanguagePicker(button);
  CodeMirrorView.findFromDOM(codeBlockDom)?.focus();
}

function convertTypedMarkdownLink(view: EditorView) {
  const { state } = view;
  const { selection } = state;
  if (!selection.empty) return false;

  const $from = selection.$from;
  if ($from.parent.type.name !== "paragraph") return false;

  const textBefore = $from.parent.textBetween(0, $from.parentOffset, "\n", "\n");
  const match = textBefore.match(/\[([^\]\n]+)\]\(([^)\n]+)\)$/);
  if (!match) return false;

  const [, label, rawHref] = match;
  const href = rawHref.trim();
  if (!label || !href) return false;

  const link = state.schema.marks.link;
  if (!link) return false;

  const from = selection.from - match[0].length;
  const to = selection.from;
  let tr = state.tr.insertText(label, from, to);
  tr = tr.addMark(from, from + label.length, link.create({ href, title: null }));
  tr = tr.setSelection(TextSelection.create(tr.doc, from + label.length));
  view.dispatch(tr.scrollIntoView());
  return true;
}

function sameLinkAttrs(left: Record<string, unknown>, right: Record<string, unknown>) {
  return String(left.href ?? "") === String(right.href ?? "")
    && String(left.title ?? "") === String(right.title ?? "");
}

function activeLinkRange(view: EditorView): LinkRange | null {
  const { state } = view;
  const { selection } = state;
  if (!selection.empty) return null;

  const linkType = state.schema.marks.link;
  if (!linkType) return null;

  const { from: cursorPos } = selection;
  const $pos = state.doc.resolve(cursorPos);
  const parent = $pos.parent;
  if (!parent.inlineContent) return null;

  const parentStart = $pos.start();
  let activeRange: { from: number; to: number; attrs: Record<string, unknown> } | null = null;
  let currentRange: { from: number; to: number; attrs: Record<string, unknown> } | null = null;

  parent.forEach((node, offset) => {
    const mark = linkType.isInSet(node.marks);
    const nodeFrom = parentStart + offset;
    const nodeTo = nodeFrom + node.nodeSize;

    if (!mark) {
      currentRange = null;
      return;
    }

    const attrs = mark.attrs as Record<string, unknown>;
    if (currentRange && sameLinkAttrs(currentRange.attrs, attrs) && currentRange.to === nodeFrom) {
      currentRange.to = nodeTo;
    } else {
      currentRange = { from: nodeFrom, to: nodeTo, attrs };
    }

    if (cursorPos >= currentRange.from && cursorPos <= currentRange.to) {
      activeRange = { ...currentRange };
    }
  });

  const range = activeRange as { from: number; to: number; attrs: Record<string, unknown> } | null;
  if (!range) return null;

  return {
    from: range.from,
    to: range.to,
    href: String(range.attrs.href ?? ""),
    attrs: range.attrs,
  };
}

function markdownLinkTextRangeAtCursor(view: EditorView): ExpandedLinkRange | null {
  const { state } = view;
  const { selection } = state;
  if (!selection.empty) return null;

  const $from = selection.$from;
  if ($from.parent.type.name !== "paragraph") return null;

  const parentText = $from.parent.textBetween(0, $from.parent.content.size, "\n", "\n");
  const pattern = /\[([^\]\n]+)\]\(([^)\n]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(parentText)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if ($from.parentOffset < start || $from.parentOffset > end) continue;
    return {
      from: $from.start() + start,
      to: $from.start() + end,
    };
  }

  return null;
}

function convertMarkdownLinkRange(view: EditorView, range: ExpandedLinkRange | null) {
  if (!range) return false;

  const cursorPos = view.state.selection.empty ? view.state.selection.from : null;
  const text = view.state.doc.textBetween(range.from, range.to, "\n", "\n");
  const match = text.match(/^\[([^\]\n]+)\]\(([^)\n]+)\)$/);
  if (!match) return false;

  const [, label, rawHref] = match;
  const href = rawHref.trim();
  if (!label || !href) return false;

  const link = view.state.schema.marks.link;
  if (!link) return false;

  let tr = view.state.tr.insertText(label, range.from, range.to);
  tr = tr.addMark(range.from, range.from + label.length, link.create({ href, title: null }));
  if (cursorPos !== null) {
    const removedLength = text.length - label.length;
    let nextPos = range.from + label.length;

    if (cursorPos <= range.from) {
      nextPos = cursorPos;
    } else if (cursorPos >= range.to) {
      nextPos = cursorPos - removedLength;
    } else if (cursorPos <= range.from + 1) {
      nextPos = range.from;
    } else if (cursorPos <= range.from + 1 + label.length) {
      nextPos = range.from + Math.max(0, Math.min(label.length, cursorPos - range.from - 1));
    }

    tr = tr.setSelection(TextSelection.create(tr.doc, Math.max(0, Math.min(tr.doc.content.size, nextPos))));
  }
  view.dispatch(tr.scrollIntoView());
  return true;
}

function expandActiveLinkToMarkdown(view: EditorView, expandedRange: ExpandedLinkRange | null) {
  const { selection } = view.state;
  if (!selection.empty) return null;
  if (expandedRange && selection.from >= expandedRange.from && selection.from <= expandedRange.to) {
    return expandedRange;
  }

  const range = activeLinkRange(view);
  if (!range) return null;

  const label = view.state.doc.textBetween(range.from, range.to, "\n", "\n");
  if (!label || !range.href) return null;

  const labelOffset = Math.max(0, Math.min(selection.from - range.from, label.length));
  const markdown = `[${label}](${range.href})`;
  const textNode = view.state.schema.text(markdown);
  const linkType = view.state.schema.marks.link;
  let tr = view.state.tr.replaceWith(range.from, range.to, textNode);
  tr = tr.setSelection(TextSelection.create(tr.doc, range.from + 1 + labelOffset));
  view.dispatch(tr.scrollIntoView());

  if (linkType) {
    const removeMarkTr = view.state.tr
      .removeMark(range.from, range.from + markdown.length)
      .setSelection(TextSelection.create(view.state.doc, range.from + 1 + labelOffset));
    view.dispatch(removeMarkTr);
  }

  return {
    from: range.from,
    to: range.from + markdown.length,
  };
}

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

function EditorSurface({ markdown, onChange, command, onOpenLink }: MilkdownEditorProps) {
  const initialMarkdownRef = useRef(markdown);
  const onChangeRef = useRef(onChange);
  const onOpenLinkRef = useRef(onOpenLink);
  const editorViewRef = useRef<EditorView | null>(null);
  const [loading, getEditor] = useInstance();

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onOpenLinkRef.current = onOpenLink;
  }, [onOpenLink]);

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
      editorViewRef.current = view;
      const maybeConvertBeforeCursorMove = (event: KeyboardEvent) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown", "Tab"].includes(event.key)) return false;
        return convertTypedMarkdownLink(view);
      };
      let linkExpandFrame = 0;
      let expandedLinkRange: ExpandedLinkRange | null = null;
      let suppressNextLinkExpand = false;
      let suppressPointerLinkExpand = false;
      const moveInsideExpandedLink = (pos: number) => {
        if (!expandedLinkRange) return false;
        const nextPos = Math.max(expandedLinkRange.from, Math.min(expandedLinkRange.to, pos));
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, nextPos)).scrollIntoView());
        expandedLinkRange = markdownLinkTextRangeAtCursor(view) ?? expandedLinkRange;
        return true;
      };
      const selectionInsideExpandedLink = () => (
        Boolean(expandedLinkRange)
        && view.state.selection.empty
        && view.state.selection.from >= expandedLinkRange!.from
        && view.state.selection.from <= expandedLinkRange!.to
      );
      const convertExpandedLink = () => {
        if (!expandedLinkRange) return false;
        const handled = convertMarkdownLinkRange(view, expandedLinkRange);
        expandedLinkRange = null;
        if (handled) suppressNextLinkExpand = true;
        return handled;
      };
      const refreshExpandedLink = () => {
        if (suppressPointerLinkExpand) return;
        if (suppressNextLinkExpand) {
          suppressNextLinkExpand = false;
          return;
        }

        if (expandedLinkRange) {
          const currentRawRange = markdownLinkTextRangeAtCursor(view);
          if (currentRawRange) {
            expandedLinkRange = currentRawRange;
            return;
          }
          convertExpandedLink();
          return;
        }

        const next = expandActiveLinkToMarkdown(view, expandedLinkRange);
        if (next) expandedLinkRange = next;
      };
      const scheduleLinkExpandRefresh = () => {
        window.cancelAnimationFrame(linkExpandFrame);
        linkExpandFrame = window.requestAnimationFrame(refreshExpandedLink);
      };
      const handleKeyDown = (event: KeyboardEvent) => {
        if (!selectionInsideExpandedLink()) maybeConvertBeforeCursorMove(event);

        if (
          expandedLinkRange
          && selectionInsideExpandedLink()
          && !event.altKey
          && !event.ctrlKey
          && !event.metaKey
          && !event.shiftKey
        ) {
          const cursorPos = view.state.selection.from;
          const stopExpandedLinkNavigation = () => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
          };

          if (event.key === "Home") {
            stopExpandedLinkNavigation();
            moveInsideExpandedLink(expandedLinkRange.from);
            return;
          }

          if (event.key === "End") {
            stopExpandedLinkNavigation();
            moveInsideExpandedLink(expandedLinkRange.to);
            return;
          }

          if (event.key === "ArrowLeft" && cursorPos > expandedLinkRange.from) {
            stopExpandedLinkNavigation();
            moveInsideExpandedLink(cursorPos - 1);
            return;
          }

          if (event.key === "ArrowRight" && cursorPos < expandedLinkRange.to) {
            stopExpandedLinkNavigation();
            moveInsideExpandedLink(cursorPos + 1);
            return;
          }

          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            convertExpandedLink();
            view.focus();
            return;
          }

          if (event.key === "Enter") {
            convertExpandedLink();
          }
        }

        const target = event.target instanceof HTMLElement ? event.target : null;
        const codeBlock = target?.closest<HTMLElement>(".milkdown-code-block") ?? null;
        const languageButton = target?.closest<HTMLButtonElement>(".language-button") ?? null;
        const isPlainArrowDown = event.key === "ArrowDown" && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;

        if (codeBlock && languageButton) {
          if (!languageButton.hasAttribute("data-language-draft")) beginLanguageEdit(languageButton);

          if (isPlainArrowDown) {
            event.preventDefault();
            event.stopPropagation();
            if (isLanguagePickerOpen(languageButton) && focusLanguagePickerItem(codeBlock, 1)) return;

            updateCodeBlockLanguage(view, codeBlock, currentLanguageText(languageButton));
            finishLanguageEdit(languageButton);
            closeLanguagePicker(languageButton);
            exitCodeBlockAfter(view, codeBlock);
            return;
          }

          if (event.key === "Enter" && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
            event.preventDefault();
            event.stopPropagation();
            commitLanguageDraft(view, codeBlock, languageButton);
            return;
          }

          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            finishLanguageEdit(languageButton);
            closeLanguagePicker(languageButton);
            const cm = CodeMirrorView.findFromDOM(codeBlock);
            cm?.focus();
            return;
          }

          if (event.key === "Backspace" && !event.altKey && !event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            event.stopPropagation();
            setLanguageDraft(languageButton, currentLanguageText(languageButton).slice(0, -1));
            return;
          }

          if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            event.stopPropagation();
            const fresh = languageButton.getAttribute("data-language-fresh") === "true";
            const nextLanguage = fresh ? event.key : `${currentLanguageText(languageButton)}${event.key}`;
            setLanguageDraft(languageButton, nextLanguage);
            return;
          }
        }

        const languageSearchInput = target?.closest<HTMLInputElement>(".search-input") ?? null;
        if (codeBlock && languageSearchInput) {
          const button = codeBlock.querySelector<HTMLButtonElement>(".language-button");
          if (!button) return;

          if (isPlainArrowDown) {
            event.preventDefault();
            event.stopPropagation();
            focusLanguagePickerItem(codeBlock, 1);
            return;
          }

          if (event.key === "Enter" && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
            event.preventDefault();
            event.stopPropagation();
            commitLanguageDraft(view, codeBlock, button);
            return;
          }
        }

        const languagePickerItem = target?.closest<HTMLElement>(".language-list-item[data-language]") ?? null;
        if (codeBlock && languagePickerItem) {
          if (isPlainArrowDown) {
            event.preventDefault();
            event.stopPropagation();
            focusLanguagePickerItem(codeBlock, 1);
            return;
          }

          if (event.key === "ArrowUp" && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
            event.preventDefault();
            event.stopPropagation();
            focusLanguagePickerItem(codeBlock, -1);
            return;
          }

          if (event.key === "Enter" && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
            event.preventDefault();
            event.stopPropagation();
            languagePickerItem.click();
            CodeMirrorView.findFromDOM(codeBlock)?.focus();
            return;
          }
        }

        if (event.key === "Enter" && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && convertTypedMarkdownLink(view)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }

        if (codeBlock && isPlainArrowDown && target?.closest(".cm-editor")) {
          const { isLastLine } = activeCodeMirrorLine(codeBlock);
          if (!isLastLine) return;

          const languageButton = codeBlock.querySelector<HTMLButtonElement>(".language-button");
          if (!languageButton) return;

          event.preventDefault();
          event.stopPropagation();
          beginLanguageEdit(languageButton);
          languageButton.focus();
          return;
        }

        if (codeBlock && event.key === "Enter" && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && target?.closest(".cm-editor")) {
          const { isLastLine, isBlank } = activeCodeMirrorLine(codeBlock);
          if (!isLastLine || !isBlank) return;

          event.preventDefault();
          event.stopPropagation();
          exitCodeBlockAfter(view, codeBlock);
          return;
        }

        const isSelectAll = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "a";
        if (isSelectAll) {
          const handled = selectCurrentCodeBlock(view.state, view.dispatch, view);
          if (!handled) return;
          event.preventDefault();
          event.stopPropagation();
        }
      };
      const handleKeyUp = (event: KeyboardEvent) => {
        if (event.key === ")") {
          if (convertTypedMarkdownLink(view)) {
            suppressNextLinkExpand = true;
            return;
          }
        }

        if (expandedLinkRange && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
          expandedLinkRange = markdownLinkTextRangeAtCursor(view) ?? expandedLinkRange;
          return;
        }

        if (selectionInsideExpandedLink()) {
          expandedLinkRange = markdownLinkTextRangeAtCursor(view) ?? expandedLinkRange;
          return;
        }

        scheduleLinkExpandRefresh();
      };
      const handlePointerDown = (event: PointerEvent) => {
        const target = event.target instanceof HTMLElement ? event.target : null;
        suppressPointerLinkExpand = Boolean((event.ctrlKey || event.metaKey) && target?.closest("a[href]"));

        const anchor = target?.closest<HTMLAnchorElement>("a[href]");
        if (anchor && !event.ctrlKey && !event.metaKey) {
          event.preventDefault();
          event.stopPropagation();
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
          if (pos !== undefined) {
            view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)).scrollIntoView());
          }
          const next = expandActiveLinkToMarkdown(view, expandedLinkRange);
          if (next) expandedLinkRange = next;
          view.focus();
          return;
        }

        if (!selectionInsideExpandedLink()) convertTypedMarkdownLink(view);
      };
      const handleDocumentPointerDown = (event: PointerEvent) => {
        if (view.dom.contains(event.target as Node)) return;
        if (!convertExpandedLink()) convertTypedMarkdownLink(view);
      };
      const handleFocusOut = () => {
        if (!convertExpandedLink()) convertTypedMarkdownLink(view);
      };
      const handleClick = (event: MouseEvent) => {
        const target = event.target instanceof HTMLElement ? event.target : null;
        const languageButton = target?.closest<HTMLButtonElement>(".language-button");
        if (languageButton) {
          finishLanguageEdit(languageButton);
          return;
        }

        const anchor = target?.closest<HTMLAnchorElement>("a[href]");
        if (!anchor) return;
        if (!event.ctrlKey && !event.metaKey) {
          event.preventDefault();
          event.stopPropagation();
          scheduleLinkExpandRefresh();
          return;
        }

        const href = anchor.getAttribute("href");
        if (!href) return;

        if (onOpenLinkRef.current(href)) {
          suppressPointerLinkExpand = false;
          event.preventDefault();
          event.stopPropagation();
        }
      };

      view.dom.addEventListener("keydown", handleKeyDown, { capture: true });
      view.dom.addEventListener("keyup", handleKeyUp, { capture: true });
      view.dom.addEventListener("pointerdown", handlePointerDown, { capture: true });
      view.dom.addEventListener("pointerup", scheduleLinkExpandRefresh, { capture: true });
      view.dom.addEventListener("focusout", handleFocusOut, { capture: true });
      view.dom.addEventListener("click", handleClick, { capture: true });
      document.addEventListener("selectionchange", scheduleLinkExpandRefresh);
      document.addEventListener("pointerdown", handleDocumentPointerDown, { capture: true });
      return () => {
        window.cancelAnimationFrame(linkExpandFrame);
        view.dom.removeEventListener("keydown", handleKeyDown, { capture: true });
        view.dom.removeEventListener("keyup", handleKeyUp, { capture: true });
        view.dom.removeEventListener("pointerdown", handlePointerDown, { capture: true });
        view.dom.removeEventListener("pointerup", scheduleLinkExpandRefresh, { capture: true });
        view.dom.removeEventListener("focusout", handleFocusOut, { capture: true });
        view.dom.removeEventListener("click", handleClick, { capture: true });
        document.removeEventListener("selectionchange", scheduleLinkExpandRefresh);
        document.removeEventListener("pointerdown", handleDocumentPointerDown, { capture: true });
        if (editorViewRef.current === view) editorViewRef.current = null;
      };
    });
  }, [getEditor, loading]);

  useEditor((root) => {
    return Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, initialMarkdownRef.current);
        ctx.update(codeBlockConfig.key, (defaultConfig) => ({
          ...defaultConfig,
          extensions: [
            syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
            CodeMirrorView.lineWrapping,
          ],
          languages: codeBlockLanguages,
          expandIcon: "",
          searchIcon: "",
          clearSearchIcon: "",
          searchPlaceholder: "",
          noResultText: "No result",
          copyText: "",
          copyIcon: "",
        }));
        ctx.get(listenerCtx).markdownUpdated((_, nextMarkdown) => {
          onChangeRef.current(nextMarkdown);
        });
      })
      .use(commonmark)
      .use(gfm)
      .use(codeBlockComponent)
      .use(history)
      .use(nestedEnterShortcut)
      .use(smartSelectAllShortcut)
      .use(markdownLinkNavigationShortcut)
      .use(listener);
  }, []);

  return <Milkdown />;
}

export function MilkdownEditor({ markdown, onChange, command, onOpenLink }: MilkdownEditorProps) {
  return (
    <MilkdownProvider>
      <EditorSurface markdown={markdown} onChange={onChange} command={command} onOpenLink={onOpenLink} />
    </MilkdownProvider>
  );
}
