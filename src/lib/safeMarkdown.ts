import DOMPurify from "dompurify";
import { marked } from "marked";

const ALLOWED_TAGS = [
  "p", "br", "strong", "em", "del",
  "h1", "h2", "h3", "h4",
  "ul", "ol", "li", "blockquote",
  "code", "pre", "hr", "a",
  "table", "thead", "tbody", "tr", "th", "td",
];

export function renderSafeMarkdown(markdown: string) {
  if (!markdown.trim()) return "";
  const parsed = marked.parse(markdown, { async: false, breaks: true, gfm: true }) as string;
  const sanitized = DOMPurify.sanitize(parsed, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ["href", "title", "target", "rel"],
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
  });
  const document = new DOMParser().parseFromString(sanitized, "text/html");
  document.body.querySelectorAll("a[href]").forEach((link) => {
    const href = link.getAttribute("href") || "";
    if (/^https?:\/\//i.test(href)) {
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
    }
  });
  return document.body.innerHTML;
}
