import type { VaultDirectoryResponse, VaultTreeEntry } from "../app/types";

export function toLazyVaultEntry(entry: VaultTreeEntry): VaultTreeEntry {
  return {
    ...entry,
    children: [],
    loaded: entry.kind === "file",
    loading: false,
    hasMore: false,
    truncated: false,
    loadError: null,
  };
}

export function directoryFromResponse(response: VaultDirectoryResponse): VaultTreeEntry {
  return {
    name: response.name,
    path: response.path,
    relativePath: response.relativePath,
    kind: "directory",
    fileExt: null,
    children: response.children.map(toLazyVaultEntry),
    loaded: true,
    loading: false,
    hasMore: response.hasMore,
    truncated: response.truncated,
    loadError: response.error,
  };
}

export function updateVaultNode(
  node: VaultTreeEntry,
  relativePath: string,
  updater: (entry: VaultTreeEntry) => VaultTreeEntry,
): VaultTreeEntry {
  if (node.relativePath === relativePath) return updater(node);

  return {
    ...node,
    children: node.children.map((child) => (
      child.kind === "directory" ? updateVaultNode(child, relativePath, updater) : child
    )),
  };
}
