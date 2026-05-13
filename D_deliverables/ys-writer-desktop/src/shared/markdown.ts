import type { SaveFileExt } from "../app/types";

export function formatTime(date: Date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function extractOutline(markdown: string) {
  return markdown
    .split("\n")
    .map((line) => line.match(/^(#{1,3})\s+(.+)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({
      level: match[1].length,
      text: match[2],
    }));
}

export function extractFirstLineTitle(markdown: string) {
  const firstLine = markdown.split(/\r?\n/, 1)[0] ?? "";
  const match = firstLine.match(/^#(?!#)\s+(.+?)\s*$/);
  return match?.[1].trim() || null;
}

export function getHeadingOffsets(markdown: string) {
  let offset = 0;
  const offsets: Array<{ start: number; end: number }> = [];

  for (const line of markdown.split("\n")) {
    if (/^(#{1,3})\s+(.+)$/.test(line)) {
      offsets.push({ start: offset, end: offset + line.length });
    }
    offset += line.length + 1;
  }

  return offsets;
}

export function stripExtension(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "");
}

export function pathFileName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? "Untitled.md";
}

export function pathExtension(path: string) {
  const match = pathFileName(path).match(/\.([^.]+)$/);
  return match?.[1]?.toLowerCase() ?? "";
}

export function ensureSaveExtension(path: string, defaultExt: SaveFileExt) {
  const extension = pathExtension(path);
  if (extension === "md" || extension === "markdown" || extension === "txt") return path;
  return `${path}.${defaultExt}`;
}

export function ensureVaultFileName(name: string, defaultExt: SaveFileExt) {
  const cleanName = name.trim();
  const extension = pathExtension(cleanName);
  if (extension === "md" || extension === "markdown" || extension === "txt") return cleanName;
  return `${cleanName}.${defaultExt}`;
}

export function joinVaultPath(directory: string, name: string) {
  const cleanName = name.trim();
  return directory ? `${directory}/${cleanName}` : cleanName;
}

export function normalizeFilePath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function isSameOrChildPath(path: string | undefined, parentPath: string) {
  if (!path) return false;

  const normalizedPath = normalizeFilePath(path);
  const normalizedParent = normalizeFilePath(parentPath);
  return normalizedPath === normalizedParent || normalizedPath.startsWith(`${normalizedParent}/`);
}

export function parentVaultDir(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index > -1 ? normalized.slice(0, index) : "";
}
