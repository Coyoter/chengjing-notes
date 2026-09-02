import type { CSSProperties } from "react";

type IdentitySealSize = "tiny" | "small" | "medium";

interface IdentitySealProps {
  color: string;
  pattern?: number;
  size?: IdentitySealSize;
  label?: string;
  className?: string;
}

function PatternGlyph({ pattern }: { pattern: number }) {
  const motif = Math.abs(pattern) % 8;
  const rotation = (pattern >>> 5) % 360;
  const flip = ((pattern >>> 12) & 1) === 1;
  const transform = `translate(16 16) rotate(${rotation}) scale(${flip ? -1 : 1} 1) translate(-16 -16)`;
  return <g transform={transform}>
    {motif === 0 && <><path d="M6 17c3-7 9-11 19-8M7 22c7 3 14 1 19-6" /><circle cx="7" cy="17" r="1.8" /><circle cx="25" cy="9" r="1.6" /></>}
    {motif === 1 && <><path d="M16 27V16M16 16 8 8M16 16l9-8M16 20l-7 5" /><circle cx="16" cy="16" r="2" /><circle cx="8" cy="8" r="1.7" /><circle cx="25" cy="8" r="1.7" /></>}
    {motif === 2 && <><path d="M5 10c4-4 7 4 11 0s7 4 11 0M5 17c4-4 7 4 11 0s7 4 11 0M5 24c4-4 7 4 11 0s7 4 11 0" /></>}
    {motif === 3 && <><path d="m16 5 11 11-11 11L5 16 16 5Zm0 0v22M5 16h22" /><circle cx="16" cy="16" r="2" /></>}
    {motif === 4 && <><path d="M9 9a10 10 0 0 1 15 3M23 22A10 10 0 0 1 8 20M12 12a6 6 0 0 1 9 2M20 20a6 6 0 0 1-9-2" /><circle cx="24" cy="12" r="1.6" /><circle cx="8" cy="20" r="1.6" /></>}
    {motif === 5 && <><path d="M6 9h8v7h8v8M10 25v-5h6M22 8v4h5" /><circle cx="6" cy="9" r="1.8" /><circle cx="22" cy="24" r="1.8" /><circle cx="27" cy="12" r="1.5" /></>}
    {motif === 6 && <><path d="m16 5 11 21H5L16 5Zm0 0v21M9 18h14" /><circle cx="16" cy="18" r="1.8" /></>}
    {motif === 7 && <><path d="m7 21 5-12 8 5 5-7M7 21l11 4 7-18" /><circle cx="7" cy="21" r="1.8" /><circle cx="12" cy="9" r="1.5" /><circle cx="20" cy="14" r="1.7" /><circle cx="25" cy="7" r="1.8" /></>}
  </g>;
}

export function IdentitySeal({ color, pattern = 0, size = "small", label, className = "" }: IdentitySealProps) {
  const style = { "--identity-seal-color": color } as CSSProperties;
  return <span className={`identity-seal size-${size} ${className}`.trim()} style={style} aria-label={label} aria-hidden={label ? undefined : true} data-identity-pattern={Math.abs(pattern) % 8}>
    <svg viewBox="0 0 32 32" focusable="false" aria-hidden="true"><PatternGlyph pattern={pattern} /></svg>
  </span>;
}
