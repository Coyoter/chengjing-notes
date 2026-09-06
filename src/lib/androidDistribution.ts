// Fail closed: a missing/unknown channel must never advertise external APK updates.
export function androidUpdateDestination(channel: string | undefined) {
  return channel === "direct"
    ? "https://github.com/Coyoter/chengjing-notes/releases?q=android&expanded=true"
    : "https://play.google.com/store/apps/details?id=tw.techtarian.chengjing";
}
