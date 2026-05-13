import {
  LEGACY_SETTINGS_STORAGE_KEY,
  MAX_EDITOR_LEFT_GAP,
  MAX_SIDEBAR_WIDTH,
  MAX_UI_SCALE,
  MIN_EDITOR_LEFT_GAP,
  MIN_SIDEBAR_WIDTH,
  MIN_UI_SCALE,
  SETTINGS_STORAGE_KEY,
  defaultSettings,
} from "../app/defaults";
import type { AppSettings, EditorMode, ThemeStyle, UIDensity } from "../app/types";

export function clampSidebarWidth(width: number) {
  if (!Number.isFinite(width)) return defaultSettings.sidebarWidth;
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width));
}

export function clampEditorLeftGap(value: number) {
  if (!Number.isFinite(value)) return defaultSettings.editorLeftGap;
  return Math.min(MAX_EDITOR_LEFT_GAP, Math.max(MIN_EDITOR_LEFT_GAP, value));
}

export function clampUiScale(value: number) {
  if (!Number.isFinite(value)) return defaultSettings.uiScale;
  return Math.min(MAX_UI_SCALE, Math.max(MIN_UI_SCALE, value));
}

export function readSettings(): AppSettings {
  if (typeof window === "undefined") return defaultSettings;

  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY)
      ?? window.localStorage.getItem(LEGACY_SETTINGS_STORAGE_KEY);
    if (!raw) return defaultSettings;

    const parsed = JSON.parse(raw) as Partial<AppSettings> & {
      workspaceRoot?: string | null;
      outlineVisible?: boolean;
      selectedWorkspaceDir?: string;
      workspaceRecoveryBlocked?: boolean;
    };
    const theme: ThemeStyle = parsed.theme === "eye" || parsed.theme === "ink" || parsed.theme === "mint"
      ? parsed.theme
      : "daily";
    const uiDensity: UIDensity = parsed.uiDensity === "compact" ? "compact" : "comfortable";
    const defaultEditorMode: EditorMode = parsed.defaultEditorMode === "plain" || parsed.defaultEditorMode === "rich"
      ? parsed.defaultEditorMode
      : defaultSettings.defaultEditorMode;

    return {
      theme,
      uiDensity,
      sidebarWidth: typeof parsed.sidebarWidth === "number" ? clampSidebarWidth(parsed.sidebarWidth) : defaultSettings.sidebarWidth,
      sidebarVisible: typeof parsed.sidebarVisible === "boolean" ? parsed.sidebarVisible : defaultSettings.sidebarVisible,
      rightPanelVisible: typeof parsed.rightPanelVisible === "boolean"
        ? parsed.rightPanelVisible
        : typeof parsed.outlineVisible === "boolean"
          ? parsed.outlineVisible
          : defaultSettings.rightPanelVisible,
      vaultRoot: typeof parsed.vaultRoot === "string" && parsed.vaultRoot
        ? parsed.vaultRoot
        : typeof parsed.workspaceRoot === "string" && parsed.workspaceRoot
          ? parsed.workspaceRoot
          : null,
      lastOpenedFile: typeof parsed.lastOpenedFile === "string" && parsed.lastOpenedFile ? parsed.lastOpenedFile : null,
      selectedVaultDir: typeof parsed.selectedVaultDir === "string"
        ? parsed.selectedVaultDir
        : typeof parsed.selectedWorkspaceDir === "string"
          ? parsed.selectedWorkspaceDir
          : "",
      vaultRecoveryBlocked: typeof parsed.vaultRecoveryBlocked === "boolean"
        ? parsed.vaultRecoveryBlocked
        : typeof parsed.workspaceRecoveryBlocked === "boolean"
          ? parsed.workspaceRecoveryBlocked
          : defaultSettings.vaultRecoveryBlocked,
      defaultEditorMode,
      restoreWorkspace: typeof parsed.restoreWorkspace === "boolean" ? parsed.restoreWorkspace : defaultSettings.restoreWorkspace,
      editorFontSize: typeof parsed.editorFontSize === "number" ? parsed.editorFontSize : defaultSettings.editorFontSize,
      editorLineHeight: typeof parsed.editorLineHeight === "number" ? parsed.editorLineHeight : defaultSettings.editorLineHeight,
      editorLeftGap: typeof parsed.editorLeftGap === "number" ? clampEditorLeftGap(parsed.editorLeftGap) : defaultSettings.editorLeftGap,
      uiScale: typeof parsed.uiScale === "number" ? clampUiScale(parsed.uiScale) : defaultSettings.uiScale,
      zoomWithWheel: typeof parsed.zoomWithWheel === "boolean" ? parsed.zoomWithWheel : defaultSettings.zoomWithWheel,
      defaultSaveExt: parsed.defaultSaveExt === "txt" ? "txt" : "md",
    };
  } catch (error) {
    console.warn("Failed to read settings", error);
    return defaultSettings;
  }
}

export function writeSettings(settings: AppSettings) {
  window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}
