const KEY_CODES = {
  a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9, b: 11,
  q: 12, w: 13, e: 14, r: 15, y: 16, t: 17, "1": 18, "2": 19, "3": 20,
  "4": 21, "6": 22, "5": 23, "=": 24, "9": 25, "7": 26, "-": 27, "8": 28,
  "0": 29, "]": 30, o: 31, u: 32, "[": 33, i: 34, p: 35, enter: 36, return: 36,
  l: 37, j: 38, "'": 39, k: 40, ";": 41, "\\": 42, ",": 43, "/": 44,
  n: 45, m: 46, ".": 47, tab: 48, space: 49, "`": 50, backspace: 51, delete: 51,
  escape: 53, esc: 53, f5: 96, f6: 97, f7: 98, f3: 99, f8: 100, f9: 101,
  f11: 103, f13: 105, f16: 106, f14: 107, f10: 109, f12: 111, f15: 113,
  home: 115, pageup: 116, forwarddelete: 117, f4: 118, end: 119, f2: 120,
  pagedown: 121, f1: 122, left: 123, right: 124, down: 125, up: 126,
};

const MODIFIERS = {
  commandorcontrol: 1 << 8,
  command: 1 << 8,
  cmd: 1 << 8,
  super: 1 << 8,
  meta: 1 << 8,
  shift: 1 << 9,
  alt: 1 << 11,
  option: 1 << 11,
  control: 1 << 12,
  ctrl: 1 << 12,
};

function parseMacHotkey(accelerator) {
  const raw = String(accelerator || "").trim();
  if (!raw) return null;
  const parts = raw.split("+").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const keyName = parts.pop().toLowerCase();
  const keyCode = KEY_CODES[keyName];
  if (!Number.isInteger(keyCode)) return null;
  let modifiers = 0;
  for (const part of parts) {
    const value = MODIFIERS[part.toLowerCase()];
    if (!value) return null;
    modifiers |= value;
  }
  return modifiers ? { keyCode, modifiers } : null;
}

module.exports = { parseMacHotkey };
