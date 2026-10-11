function fullscreenTopInset(layout) {
  const window = layout?.windowBounds;
  const valid = rect => rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0;
  if (!layout?.fullscreen || !valid(window)) return 0;
  let inset = 0;
  for (const bar of layout.menuBars || []) {
    if (!valid(bar)) continue;
    const overlap = Math.min(window.x + window.width, bar.x + bar.width) - Math.max(window.x, bar.x);
    if (overlap <= 0 || bar.y > window.y + 0.5 || bar.y + bar.height <= window.y) continue;
    inset = Math.max(inset, bar.y + bar.height - window.y);
  }
  return Math.ceil(Math.min(inset, window.height));
}
module.exports = { fullscreenTopInset };
