import { useMemo } from "react";
import { renderSafeMarkdown } from "../lib/safeMarkdown";

export function AIMarkdown({ content }: { content: string }) {
  const html = useMemo(() => renderSafeMarkdown(content), [content]);
  return <div className="ai-message-markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
