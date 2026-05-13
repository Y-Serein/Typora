import { defaultVaultWorkspaceState } from "../app/defaults";
import type { MarkdownFileResponse, VaultWorkspaceState } from "../app/types";
import type { Note } from "../domain/model";
import { extractFirstLineTitle, stripExtension } from "../shared/markdown";

export function createDraftNote(): Note {
  const now = new Date().toISOString();
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `note-${Date.now()}`;

  return {
    id,
    title: "未命名笔记",
    markdown: "# 未命名笔记\n\n开始写作。",
    tagIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createFileNote(file: MarkdownFileResponse): Note {
  const now = new Date().toISOString();
  const titleFromHeading = extractFirstLineTitle(file.content);
  const titleFromFile = stripExtension(file.fileName).trim();
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `note-${Date.now()}`;

  return {
    id,
    title: titleFromFile || titleFromHeading || "未命名笔记",
    markdown: file.content,
    tagIds: [],
    createdAt: now,
    updatedAt: now,
    filePath: file.path,
    fileName: file.fileName,
    fileExt: file.fileExt,
  };
}

export function isEmptyDraft(note: Note) {
  return !note.filePath
    && (note.markdown.trim() === "" || note.markdown === "# 未命名笔记\n\n开始写作。");
}

export function mergeWorkspaceState(
  workspace: VaultWorkspaceState | null | undefined,
  fallbackLayout = defaultVaultWorkspaceState().layout,
): VaultWorkspaceState {
  if (!workspace || workspace.version !== 1) {
    return {
      ...defaultVaultWorkspaceState(),
      layout: fallbackLayout,
    };
  }

  return {
    version: 1,
    recentFiles: Array.isArray(workspace.recentFiles) ? workspace.recentFiles.filter((item) => typeof item === "string") : [],
    lastOpenedFile: typeof workspace.lastOpenedFile === "string" && workspace.lastOpenedFile ? workspace.lastOpenedFile : null,
    selectedDir: typeof workspace.selectedDir === "string" ? workspace.selectedDir : "",
    expandedDirs: Array.isArray(workspace.expandedDirs) && workspace.expandedDirs.length
      ? workspace.expandedDirs.filter((item) => typeof item === "string")
      : [""],
    layout: {
      ...fallbackLayout,
      ...workspace.layout,
    },
  };
}

export function nextWorkspaceState(
  current: VaultWorkspaceState,
  patch: Partial<VaultWorkspaceState>,
): VaultWorkspaceState {
  return {
    ...current,
    ...patch,
    version: 1,
    layout: {
      ...current.layout,
      ...(patch.layout ?? {}),
    },
  };
}

export function pushRecentFile(recentFiles: string[], filePath: string | null) {
  if (!filePath) return recentFiles;
  return [filePath, ...recentFiles.filter((item) => item !== filePath)].slice(0, 12);
}
