export function currentDesktopPlatform() {
  return typeof window !== "undefined" ? (window.chengjing?.platform || "web") : "web";
}

export function isWindows(platform = currentDesktopPlatform()) {
  return platform === "win32";
}

export function primaryShortcut(key: string, platform = currentDesktopPlatform()) {
  return isWindows(platform) ? `Ctrl+${key}` : `⌘${key}`;
}

export function alternateKey(platform = currentDesktopPlatform()) {
  return isWindows(platform) ? "Alt" : "⌥";
}

export function hasPrimaryModifier(event: Pick<KeyboardEvent, "metaKey" | "ctrlKey">) {
  return event.metaKey || event.ctrlKey;
}

export function displayDesktopAccelerator(value: string, platform = currentDesktopPlatform()) {
  if (isWindows(platform)) {
    return value
      .replaceAll("CommandOrControl", "Ctrl")
      .replaceAll("Command", "Win")
      .replaceAll("Control", "Ctrl")
      .replaceAll("Super", "Win")
      .replaceAll("Meta", "Win")
      .replaceAll("Alt", "Alt")
      .replaceAll("Shift", "Shift")
      .replaceAll("+", "+");
  }
  return value.replaceAll("CommandOrControl", "⌘").replaceAll("Command", "⌘").replaceAll("Control", "⌃").replaceAll("Alt", "⌥").replaceAll("Shift", "⇧").replaceAll("+", " ");
}
