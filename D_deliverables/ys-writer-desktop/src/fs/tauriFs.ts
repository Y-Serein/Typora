import { invoke } from "@tauri-apps/api/core";
import type {
  MarkdownFileResponse,
  VaultDirectoryResponse,
  VaultInitResponse,
  VaultIndexResponse,
  VaultWorkspaceState,
} from "../app/types";

export function readMarkdownFile(path: string) {
  return invoke<MarkdownFileResponse>("read_markdown_file", { path });
}

export function writeMarkdownFile(
  path: string,
  content: string,
  expectedModifiedAtMs?: number | null,
  expectedSize?: number | null,
) {
  return invoke<MarkdownFileResponse>("write_markdown_file", {
    path,
    content,
    expectedModifiedAtMs: expectedModifiedAtMs ?? null,
    expectedSize: expectedSize ?? null,
  });
}

export function initVault(root: string) {
  return invoke<VaultInitResponse>("init_vault", { root });
}

export function readVaultDirectory(root: string, relativePath: string, limit: number) {
  return invoke<VaultDirectoryResponse>("read_vault_directory", { root, relativePath, limit });
}

export function readVaultIndexFiles(root: string) {
  return invoke<VaultIndexResponse>("read_vault_index_files", { root });
}

export function createVaultEntry(root: string, relativePath: string, kind: "file" | "directory") {
  return invoke<string>("create_vault_entry", { root, relativePath, kind });
}

export function renameVaultEntry(root: string, relativePath: string, newName: string) {
  return invoke<string>("rename_vault_entry", { root, relativePath, newName });
}

export function deleteVaultEntry(root: string, relativePath: string) {
  return invoke<void>("delete_vault_entry", { root, relativePath });
}

export function writeVaultWorkspaceState(root: string, workspace: VaultWorkspaceState) {
  return invoke<void>("write_vault_workspace_state", { root, workspace });
}

export function openExternalTarget(target: string) {
  return invoke<void>("open_external_target", { target });
}
