import fs from "node:fs/promises";

const path = new URL("../src/styles.css", import.meta.url);
const mapping = new Map([
  ["6.8", "12"], ["7", "12"], ["7.5", "12"], ["8", "12"], ["8.5", "12"],
  ["9", "12"], ["9.5", "12.5"], ["10", "13"], ["10.5", "13"], ["11", "13.5"],
  ["11.5", "14"], ["12", "14"], ["12.5", "14.5"], ["13", "15"], ["13.5", "15"],
  ["14.5", "16"], ["15", "16"], ["16", "17"], ["17", "18"], ["19", "20"],
  ["20", "22"], ["23", "25"], ["24", "26"], ["25", "28"], ["26", "29"],
  ["30", "32"], ["32", "35"],
]);

let css = await fs.readFile(path, "utf8");
css = css.replace(/font-size:\s*([0-9.]+)px/g, (_match, size) => `font-size: calc(${mapping.get(size) || size}px * var(--font-scale))`);
css = css.replace(/font:\s*([0-9.]+)px/g, (_match, size) => `font: calc(${mapping.get(size) || size}px * var(--font-scale))`);
css = css.replace(/font-size:\s*clamp\(([^;]+)\)/g, (_match, values) => `font-size: calc(clamp(${values}) * var(--font-scale))`);
await fs.writeFile(path, css);
console.log("已將所有固定字級轉成可調整的繁中比例字級。");
