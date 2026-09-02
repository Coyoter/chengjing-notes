function isChecksumLine(line: string) {
  return /^[a-f0-9]{64}\s+\S+$/i.test(line.trim());
}

function removeChecksumFences(lines: string[]) {
  const output: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/^```/.test(line.trim())) {
      output.push(line);
      continue;
    }

    const end = lines.findIndex((candidate, candidateIndex) => candidateIndex > index && /^```\s*$/.test(candidate.trim()));
    if (end === -1) {
      output.push(line);
      continue;
    }
    const fencedContent = lines.slice(index + 1, end).filter((candidate) => candidate.trim());
    if (fencedContent.length > 0 && fencedContent.every(isChecksumLine)) {
      index = end;
      continue;
    }
    output.push(...lines.slice(index, end + 1));
    index = end;
  }
  return output;
}

export function userFacingReleaseNotes(notes: string) {
  const lines = notes.replace(/\r\n?/g, "\n").split("\n");
  const withoutChecksumSection: string[] = [];
  let skippingChecksumSection = false;

  for (const line of lines) {
    if (/^#{1,6}\s*SHA-?256\s*$/i.test(line.trim())) {
      skippingChecksumSection = true;
      continue;
    }
    if (skippingChecksumSection && /^#{1,6}\s+/.test(line.trim())) skippingChecksumSection = false;
    if (!skippingChecksumSection) withoutChecksumSection.push(line);
  }

  return removeChecksumFences(withoutChecksumSection)
    .join("\n")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
