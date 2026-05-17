import type { VaultIndexFileResponse, VaultIndexResponse } from "../app/types";
import { extractFirstLineTitle, normalizeFilePath, parentVaultDir, pathFileName, stripExtension } from "../shared/markdown";

export type VaultHeading = {
  level: number;
  text: string;
  slug: string;
};

export type VaultLink = {
  kind: "wiki" | "markdown";
  label: string;
  rawTarget: string;
  targetPath: string | null;
  targetHeading: string | null;
  unresolvedReason: string | null;
};

export type VaultIndexedFile = {
  path: string;
  relativePath: string;
  fileName: string;
  fileExt: string;
  title: string;
  headings: VaultHeading[];
  tags: string[];
  outgoingLinks: VaultLink[];
};

export type VaultGraphNode = {
  path: string;
  title: string;
  relativePath: string;
  role: "current" | "neighbor";
  x: number;
  y: number;
};

export type VaultGraphEdge = {
  id: string;
  sourcePath: string;
  targetPath: string;
};

export type VaultIndex = {
  root: string;
  files: VaultIndexedFile[];
  filesByPath: Map<string, VaultIndexedFile>;
  filesByRelativePath: Map<string, VaultIndexedFile>;
  backlinksByPath: Map<string, VaultLink[]>;
  truncated: boolean;
  skippedFiles: number;
};

type RawVaultLink = {
  kind: "wiki" | "markdown";
  label: string;
  rawTarget: string;
  sourceRelativePath: string;
};

type ParsedVaultFile = Omit<VaultIndexedFile, "outgoingLinks"> & {
  rawLinks: RawVaultLink[];
};

const INDEX_FILE_NAMES = ["index.md", "index.markdown", "index.txt", "readme.md", "readme.markdown", "readme.txt"];

export function buildVaultIndex(root: string, response: VaultIndexResponse): VaultIndex {
  const rootPath = normalizeFilePath(root);
  const parsedFiles = response.files.map((file) => parseVaultFile(file));
  const filesByRelativePath = new Map<string, ParsedVaultFile>();
  const filesByPath = new Map<string, ParsedVaultFile>();
  const candidates = new Map<string, ParsedVaultFile>();

  for (const file of parsedFiles) {
    filesByPath.set(normalizeFilePath(file.path), file);
    filesByRelativePath.set(normalizeVaultPath(file.relativePath).toLowerCase(), file);
    addCandidate(candidates, file.relativePath, file);
    addCandidate(candidates, stripExtension(file.relativePath), file);
    addCandidate(candidates, stripExtension(pathFileName(file.relativePath)), file);
  }

  const indexedFiles = parsedFiles.map((file) => ({
    ...file,
    outgoingLinks: file.rawLinks.map((link) => ({
      kind: link.kind,
      label: link.label,
      rawTarget: link.rawTarget,
      targetPath: resolveLinkTarget(link, candidates)?.path ?? null,
      targetHeading: targetHeading(link.rawTarget),
      unresolvedReason: unresolvedReason(link, candidates),
    })),
  }));

  const indexedFilesByPath = new Map(indexedFiles.map((file) => [normalizeFilePath(file.path), file]));
  const indexedFilesByRelativePath = new Map(indexedFiles.map((file) => [normalizeVaultPath(file.relativePath).toLowerCase(), file]));
  const backlinksByPath = new Map<string, VaultLink[]>();

  for (const file of indexedFiles) {
    backlinksByPath.set(normalizeFilePath(file.path), []);
  }

  for (const source of indexedFiles) {
    for (const link of source.outgoingLinks) {
      if (!link.targetPath) continue;
      const backlink: VaultLink = {
        ...link,
        label: source.title,
        rawTarget: source.relativePath,
        targetPath: source.path,
      };
      const targetPath = normalizeFilePath(link.targetPath);
      backlinksByPath.set(targetPath, [...(backlinksByPath.get(targetPath) ?? []), backlink]);
    }
  }

  return {
    root: rootPath,
    files: indexedFiles,
    filesByPath: indexedFilesByPath,
    filesByRelativePath: indexedFilesByRelativePath,
    backlinksByPath,
    truncated: response.truncated,
    skippedFiles: response.skippedFiles,
  };
}

export function findIndexedFile(index: VaultIndex | null, path: string | null | undefined) {
  if (!index || !path) return null;
  return index.filesByPath.get(normalizeFilePath(path)) ?? null;
}

export function getBacklinks(index: VaultIndex | null, path: string | null | undefined) {
  if (!index || !path) return [];
  return index.backlinksByPath.get(normalizeFilePath(path)) ?? [];
}

export function createLocalGraph(index: VaultIndex | null, path: string | null | undefined) {
  const currentFile = findIndexedFile(index, path);
  if (!index || !currentFile) return { nodes: [], edges: [] };

  const currentPath = normalizeFilePath(currentFile.path);
  const nodePaths = new Set<string>([currentPath]);

  for (const link of currentFile.outgoingLinks) {
    if (link.targetPath) nodePaths.add(normalizeFilePath(link.targetPath));
  }

  for (const backlink of getBacklinks(index, currentPath)) {
    if (backlink.targetPath) nodePaths.add(normalizeFilePath(backlink.targetPath));
  }

  const neighborPaths = [...nodePaths].filter((nodePath) => nodePath !== currentPath);
  const nodes: VaultGraphNode[] = [
    graphNode(currentFile, "current", 50, 50),
    ...neighborPaths.map((nodePath, indexOffset) => {
      const file = index.filesByPath.get(nodePath);
      const angle = (Math.PI * 2 * indexOffset) / Math.max(neighborPaths.length, 1) - Math.PI / 2;
      const radius = neighborPaths.length <= 2 ? 30 : 34;
      return graphNode(
        file,
        "neighbor",
        50 + Math.cos(angle) * radius,
        50 + Math.sin(angle) * radius,
        nodePath,
      );
    }),
  ];

  const edges: VaultGraphEdge[] = [];
  const edgeIds = new Set<string>();
  for (const source of index.files) {
    const sourcePath = normalizeFilePath(source.path);
    if (!nodePaths.has(sourcePath)) continue;

    for (const link of source.outgoingLinks) {
      if (!link.targetPath) continue;
      const targetPath = normalizeFilePath(link.targetPath);
      if (!nodePaths.has(targetPath)) continue;

      const id = `${sourcePath}->${targetPath}`;
      if (edgeIds.has(id)) continue;
      edgeIds.add(id);
      edges.push({ id, sourcePath, targetPath });
    }
  }

  return { nodes, edges };
}

function parseVaultFile(file: VaultIndexFileResponse): ParsedVaultFile {
  const title = extractFirstLineTitle(file.content) ?? stripExtension(file.fileName);

  return {
    path: file.path,
    relativePath: normalizeVaultPath(file.relativePath),
    fileName: file.fileName,
    fileExt: file.fileExt,
    title,
    headings: extractHeadings(file.content),
    tags: extractTags(file.content),
    rawLinks: extractRawLinks(file.content, normalizeVaultPath(file.relativePath)),
  };
}

function extractHeadings(markdown: string): VaultHeading[] {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => {
      const text = match[2].trim();
      return {
        level: match[1].length,
        text,
        slug: slugHeading(text),
      };
    });
}

function extractTags(markdown: string): string[] {
  const tags = new Set<string>();
  const tagPattern = /(^|[\s([{])#([A-Za-z0-9_/-]+)/g;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(markdown)) !== null) {
    tags.add(match[2]);
  }

  return [...tags].sort((left, right) => left.localeCompare(right));
}

function extractRawLinks(markdown: string, sourceRelativePath: string): RawVaultLink[] {
  const links: RawVaultLink[] = [];
  const wikiPattern = /\[\[([^\]]+)\]\]/g;
  const markdownPattern = /\[[^\]]+\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = wikiPattern.exec(markdown)) !== null) {
    const raw = match[1].trim();
    if (!raw) continue;
    const [target, alias] = raw.split("|", 2).map((part) => part.trim());
    links.push({
      kind: "wiki",
      label: alias || stripWikiTarget(target),
      rawTarget: target,
      sourceRelativePath,
    });
  }

  while ((match = markdownPattern.exec(markdown)) !== null) {
    const rawTarget = normalizeMarkdownTarget(match[1]);
    if (!rawTarget || isExternalTarget(rawTarget)) {
      continue;
    }

    links.push({
      kind: "markdown",
      label: pathFileName(stripTargetMeta(rawTarget)) || rawTarget,
      rawTarget,
      sourceRelativePath,
    });
  }

  return links;
}

function resolveLinkTarget(link: RawVaultLink, candidates: Map<string, ParsedVaultFile>) {
  if (link.kind === "markdown") {
    const targetPath = stripTargetMeta(link.rawTarget);
    const sourceDir = parentVaultDir(link.sourceRelativePath);
    const relativeTarget = joinRelativePath(sourceDir, targetPath);
    return candidates.get(relativeTarget.toLowerCase())
      ?? candidates.get(stripExtension(relativeTarget).toLowerCase())
      ?? resolveDirectoryIndex(relativeTarget, candidates)
      ?? null;
  }

  const target = stripWikiTarget(link.rawTarget);
  return candidates.get(normalizeVaultPath(target).toLowerCase())
    ?? candidates.get(stripExtension(normalizeVaultPath(target)).toLowerCase())
    ?? null;
}

function unresolvedReason(link: RawVaultLink, candidates: Map<string, ParsedVaultFile>) {
  if (resolveLinkTarget(link, candidates)) return null;
  if (link.kind === "markdown") {
    const target = stripTargetMeta(link.rawTarget);
    if (isDirectoryTarget(target)) {
      return "Directory link; add index.md or README.md in that folder to show it in Graph.";
    }
  }
  return "No matching vault file found.";
}

function addCandidate(candidates: Map<string, ParsedVaultFile>, key: string, file: ParsedVaultFile) {
  const normalized = normalizeVaultPath(key).toLowerCase();
  if (!normalized || candidates.has(normalized)) return;
  candidates.set(normalized, file);
}

function graphNode(
  file: VaultIndexedFile | undefined,
  role: "current" | "neighbor",
  x: number,
  y: number,
  fallbackPath?: string,
): VaultGraphNode {
  const path = normalizeFilePath(file?.path ?? fallbackPath ?? "");
  return {
    path,
    title: truncateGraphTitle(file?.title ?? stripExtension(pathFileName(path))),
    relativePath: file?.relativePath ?? path,
    role,
    x,
    y,
  };
}

function truncateGraphTitle(title: string) {
  const trimmed = title.trim() || "Untitled";
  return trimmed.length > 18 ? `${trimmed.slice(0, 17)}...` : trimmed;
}

function normalizeMarkdownTarget(target: string) {
  const trimmed = target.trim().replace(/^<|>$/g, "");
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function isExternalTarget(target: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#");
}

function stripTargetMeta(target: string) {
  return target.split("#", 1)[0].split("?", 1)[0].trim();
}

function stripWikiTarget(target: string) {
  return stripTargetMeta(target).replace(/^\/+/, "").trim();
}

function targetHeading(target: string) {
  const heading = target.split("#", 2)[1]?.split("|", 1)[0]?.trim();
  return heading || null;
}

function normalizeVaultPath(path: string) {
  return path
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/+$/, "");
}

function isDirectoryTarget(target: string) {
  const normalized = normalizeVaultPath(target);
  return !normalized || target.endsWith("/") || target === "." || target === "./";
}

function resolveDirectoryIndex(relativeTarget: string, candidates: Map<string, ParsedVaultFile>) {
  const directory = normalizeVaultPath(relativeTarget);
  if (!directory && relativeTarget !== "." && relativeTarget !== "./") return null;

  for (const fileName of INDEX_FILE_NAMES) {
    const candidate = normalizeVaultPath(directory ? `${directory}/${fileName}` : fileName).toLowerCase();
    const file = candidates.get(candidate);
    if (file) return file;
  }

  return null;
}

function joinRelativePath(directory: string, target: string) {
  const parts = [...normalizeVaultPath(directory).split("/"), ...normalizeVaultPath(target).split("/")]
    .filter(Boolean);
  const output: string[] = [];

  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") {
      output.pop();
      continue;
    }
    output.push(part);
  }

  return output.join("/");
}

function slugHeading(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .replace(/\s+/g, "-");
}
