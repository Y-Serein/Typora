import type { AppSettings, EditorMode, SettingsSection, VaultWorkspaceState } from "./types";

export const SETTINGS_STORAGE_KEY = "serein.settings.v1";
export const LEGACY_SETTINGS_STORAGE_KEY = "ys-writer.settings.v1";
export const SHORTCUTS_STORAGE_KEY = "serein.shortcuts.v1";
export const LEGACY_SHORTCUTS_STORAGE_KEY = "ys-writer.shortcuts.v1";

export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = 360;
export const MIN_EDITOR_LEFT_GAP = 16;
export const MAX_EDITOR_LEFT_GAP = 140;
export const MIN_UI_SCALE = 85;
export const MAX_UI_SCALE = 130;
export const VAULT_DIRECTORY_LIMIT = 300;

export const defaultEditorMode: EditorMode = import.meta.env.PROD ? "rich" : "plain";

export const defaultSettings: AppSettings = {
  theme: "daily",
  uiDensity: "comfortable",
  sidebarWidth: 240,
  sidebarVisible: true,
  rightPanelVisible: true,
  vaultRoot: null,
  lastOpenedFile: null,
  selectedVaultDir: "",
  vaultRecoveryBlocked: false,
  defaultEditorMode,
  restoreWorkspace: true,
  editorFontSize: 18,
  editorLineHeight: 1.76,
  editorLeftGap: 42,
  uiScale: 100,
  zoomWithWheel: true,
  defaultSaveExt: "md",
};

export const settingsSections: Array<{ id: SettingsSection; label: string }> = [
  { id: "general", label: "General" },
  { id: "editor", label: "Editor" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "appearance", label: "Appearance" },
  { id: "files", label: "Files" },
];

export function defaultVaultWorkspaceState(layout = defaultSettings): VaultWorkspaceState {
  return {
    version: 1,
    recentFiles: [],
    lastOpenedFile: null,
    selectedDir: "",
    expandedDirs: [""],
    layout: {
      sidebarWidth: layout.sidebarWidth,
      sidebarVisible: layout.sidebarVisible,
      rightPanelVisible: layout.rightPanelVisible,
      editorLeftGap: layout.editorLeftGap,
      uiScale: layout.uiScale,
    },
  };
}
