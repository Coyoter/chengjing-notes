import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import {
  Bold,
  Braces,
  CheckSquare,
  Heading2,
  Highlighter,
  Italic,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Undo2,
} from "lucide-react";
import { useI18n } from "../hooks/useI18n";
import { editorTaskRecordId, normalizeEditorTaskHtml, syncCardTasksFromHtml } from "../lib/taskSync";
import { showContextMenu } from "../lib/contextMenu";

const SyncedTaskItem = TaskItem.extend({
  addAttributes() {
    return {
      ...(this.parent?.() || {}),
      taskId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-task-id"),
        renderHTML: (attributes) => attributes.taskId ? { "data-task-id": attributes.taskId } : {},
      },
    };
  },
});

interface RichEditorProps {
  content: string;
  onChange: (html: string, text: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  compact?: boolean;
  onHighlight?: (text: string) => void | Promise<void>;
  taskOwnerId?: string;
}

export function RichEditor({ content, onChange, placeholder, autoFocus = false, compact = false, onHighlight, taskOwnerId }: RichEditorProps) {
  const { t } = useI18n();
  const resolvedPlaceholder = placeholder || t("editor.start");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSave = useRef<(() => void) | null>(null);
  const onChangeRef = useRef(onChange);
  const taskOwnerIdRef = useRef(taskOwnerId);
  const [saveState, setSaveState] = useState<"saved" | "saving">("saved");
  const editor = useEditor({
    extensions: [
      StarterKit,
      Highlight.configure({ multicolor: true }),
      TaskList,
      SyncedTaskItem.configure({ nested: true }),
    ],
    content,
    autofocus: autoFocus,
    editorProps: {
      attributes: {
        class: "prose-editor",
        "data-placeholder": resolvedPlaceholder,
        spellcheck: "true",
      },
    },
    onUpdate: ({ editor: activeEditor }) => {
      setSaveState("saving");
      if (timer.current) clearTimeout(timer.current);
      pendingSave.current = () => {
        pendingSave.current = null;
        const originalHtml = activeEditor.getHTML();
        const normalized = normalizeEditorTaskHtml(originalHtml);
        if (normalized.html !== originalHtml) {
          const selection = activeEditor.state.selection;
          activeEditor.commands.setContent(normalized.html, { emitUpdate: false });
          activeEditor.commands.setTextSelection({ from: selection.from, to: selection.to });
        }
        const plainText = activeEditor.getText({ blockSeparator: "\n" });
        onChangeRef.current(normalized.html, plainText);
        if (taskOwnerIdRef.current) void syncCardTasksFromHtml(taskOwnerIdRef.current, normalized.html);
        setSaveState("saved");
      };
      timer.current = setTimeout(() => pendingSave.current?.(), 420);
    },
  }, [resolvedPlaceholder]);

  useEffect(() => {
    if (!editor || editor.getHTML() === content) return;
    editor.commands.setContent(content || "<p></p>", { emitUpdate: false });
  }, [content, editor]);

  useEffect(() => {
    onChangeRef.current = onChange;
    taskOwnerIdRef.current = taskOwnerId;
  }, [onChange, taskOwnerId]);

  useEffect(() => {
    if (!editor || !taskOwnerId) return;
    const originalHtml = editor.getHTML();
    const normalized = normalizeEditorTaskHtml(originalHtml);
    if (normalized.html !== originalHtml) {
      editor.commands.setContent(normalized.html, { emitUpdate: false });
      onChangeRef.current(normalized.html, editor.getText({ blockSeparator: "\n" }));
    }
    void syncCardTasksFromHtml(taskOwnerId, normalized.html);
  }, [editor, taskOwnerId]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  useEffect(() => {
    const flush = () => { if (timer.current) clearTimeout(timer.current); pendingSave.current?.(); };
    window.addEventListener("chengjing:flush-editors", flush);
    return () => window.removeEventListener("chengjing:flush-editors", flush);
  }, []);

  if (!editor) return null;

  function toggleHighlight() {
    const { from, to } = editor.state.selection;
    const selectedText = from === to ? "" : editor.state.doc.textBetween(from, to, " ").trim();
    const removingHighlight = editor.isActive("highlight");
    editor.chain().focus().toggleHighlight().run();
    if (!removingHighlight && selectedText && onHighlight) void onHighlight(selectedText);
  }

  const tool = (label: string, active: boolean, action: () => void, icon: React.ReactNode) => (
    <button type="button" aria-label={label} data-tooltip={label} className={active ? "is-active" : ""} onClick={action}>{icon}</button>
  );

  return (
    <div className={`rich-editor ${compact ? "is-compact" : ""}`} onContextMenu={(event) => {
      if (!taskOwnerId) return;
      const item = (event.target as HTMLElement).closest<HTMLElement>('ul[data-type="taskList"] li[data-task-id]');
      const sourceTaskId = item?.dataset.taskId;
      if (!sourceTaskId) return;
      event.preventDefault();
      event.stopPropagation();
      showContextMenu({ kind: "task", id: editorTaskRecordId(taskOwnerId, sourceTaskId) }, event.clientX, event.clientY);
    }}>
      <div className="editor-toolbar" aria-label={t("editor.toolbar")}>
        <div>
          {tool(t("editor.bold"), editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(), <Bold size={15} />)}
          {tool(t("editor.italic"), editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), <Italic size={15} />)}
          {tool(t("editor.strike"), editor.isActive("strike"), () => editor.chain().focus().toggleStrike().run(), <Strikethrough size={15} />)}
          {tool(onHighlight ? t("editor.highlightAndSave") : t("editor.highlight"), editor.isActive("highlight"), toggleHighlight, <Highlighter size={15} />)}
          <i />
          {tool(t("editor.heading2"), editor.isActive("heading", { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), <Heading2 size={15} />)}
          {tool(t("editor.bullets"), editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run(), <List size={15} />)}
          {tool(t("editor.numbered"), editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(), <ListOrdered size={15} />)}
          {tool(t("editor.tasks"), editor.isActive("taskList"), () => editor.chain().focus().toggleTaskList().run(), <CheckSquare size={15} />)}
          {tool(t("editor.quote"), editor.isActive("blockquote"), () => editor.chain().focus().toggleBlockquote().run(), <Quote size={15} />)}
          {tool(t("editor.code"), editor.isActive("codeBlock"), () => editor.chain().focus().toggleCodeBlock().run(), <Braces size={15} />)}
        </div>
        <div>
          <span className={`save-state ${saveState}`}>{saveState === "saving" ? t("common.saving") : t("common.saved")}</span>
          {tool(t("editor.undo"), false, () => editor.chain().focus().undo().run(), <Undo2 size={15} />)}
          {tool(t("editor.redo"), false, () => editor.chain().focus().redo().run(), <Redo2 size={15} />)}
        </div>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
