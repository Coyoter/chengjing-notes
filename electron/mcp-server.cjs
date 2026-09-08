const { timingSafeEqual } = require("node:crypto");
const { createServer } = require("node:http");
const { localhostHostValidation, localhostOriginValidation, toNodeHandler } = require("@modelcontextprotocol/node");
const { createMcpHandler, McpServer } = require("@modelcontextprotocol/server");
const { z } = require("zod");

const BODY_LIMIT = 1_048_576;

function safeEqual(left, right) {
  const a = Buffer.from(String(left || "")); const b = Buffer.from(String(right || ""));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function toolResult(value) {
  const structuredContent = value && typeof value === "object" && !Array.isArray(value) ? value : { result: value };
  return { content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }], structuredContent };
}

function toolError(error) {
  const raw = String(error?.message || error || "MCP operation failed").slice(0, 800);
  const message = raw.startsWith("mcp-conflict:")
    ? `This item changed after it was read. Call chengjing_get_item again and retry with the new updatedAt. (${raw})`
    : raw === "mcp-item-not-found" ? "The requested ChengJing item does not exist or is no longer available."
      : raw === "mcp-no-changes" ? "No writable fields were provided. Nothing was changed."
        : raw;
  return { isError: true, content: [{ type: "text", text: message }] };
}

function summary(tool, args) {
  const labels = {
    chengjing_list_records: "分頁讀取工作內容", chengjing_action_schema: "讀取批次動作格式", chengjing_apply_actions: "批次修改工作內容",
    chengjing_delete_items: "批次刪除工作內容", chengjing_manage_metadata: "整理分類與內容", chengjing_update_fields: "修改內容屬性",
    chengjing_status: "讀取工作區狀態", chengjing_search: "搜尋澄境", chengjing_get_item: "讀取澄境項目",
    chengjing_create_note: "新增筆記", chengjing_update_note: "修改筆記", chengjing_create_task: "新增待辦", chengjing_update_task: "修改待辦",
    chengjing_create_whiteboard: "新增白板", chengjing_update_whiteboard: "修改白板", chengjing_add_whiteboard_item: "加入白板項目", chengjing_move_whiteboard_item: "移動白板項目",
    chengjing_create_kanban: "新增看板", chengjing_update_kanban: "修改看板", chengjing_create_neuron: "新增神經元內容", chengjing_connect_neurons: "連結神經元",
  };
  const detail = [args?.plan?.summary, args?.title, args?.query, args?.id, args?.boardId, args?.operation, args?.table].find((item) => typeof item === "string" && item.trim());
  return `${labels[tool] || tool}${detail ? ` · ${String(detail).trim().slice(0, 100)}` : ""}`;
}

function buildMcpServer(execute, version = "0.0.0") {
  const server = new McpServer({ name: "chengjing", title: "澄境 ChengJing", version });
  const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const create = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
  const update = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };
  const register = (name, config, handler) => server.registerTool(name, config, async (args) => {
    try { return toolResult(await execute(name, args || {}, { write: !config.annotations.readOnlyHint, summary: summary(name, args || {}) })); }
    catch (error) { return toolError(error); }
  });

  register("chengjing_status", {
    title: "ChengJing workspace status / 澄境工作區狀態",
    description: "Return bounded workspace counts and MCP safety rules. / 取得工作區數量與 MCP 安全規則。",
    inputSchema: z.object({}), annotations: read,
  });
  register("chengjing_search", {
    title: "Search ChengJing / 搜尋澄境",
    description: "Search notes, whiteboards, kanban boards, tasks and fragments. Results are bounded; use get_item for details. / 搜尋筆記、白板、看板、待辦與隻言片語。",
    inputSchema: z.object({ query: z.string().min(1).max(500), types: z.array(z.enum(["note", "whiteboard", "kanban", "task", "fragment"])).max(5).optional(), limit: z.number().int().min(1).max(50).optional() }), annotations: read,
  });
  register("chengjing_get_item", {
    title: "Read a ChengJing item / 讀取澄境項目",
    description: "Read one item by exact ID. For a neuron, also provide neuronType: card, board, task or fragment. / 依 ID 讀取單一項目。",
    inputSchema: z.object({ type: z.enum(["note", "whiteboard", "kanban", "task", "fragment", "neuron"]), id: z.string().min(1).max(180), neuronType: z.enum(["card", "board", "task", "fragment"]).optional() }), annotations: read,
  });
  register("chengjing_list_records", {
    title: "List workspace records / 分頁讀取工作區資料",
    description: "Enumerate all records, including trash. Follow nextCursor as after until null. Long text is chunked: contentRanges reports each field's total length/nextOffset; pass id and contentOffset to continue that record. No total content ceiling. Account settings/secrets and attachment bytes/paths are excluded. / 分頁及分段讀取完整文字，不受搜尋前幾筆限制。",
    inputSchema: z.object({ table: z.enum(["cards", "boards", "boardNodes", "boardEdges", "kanbanBoards", "kanbanLists", "kanbanPlacements", "tags", "tasks", "highlights", "attachments", "fragments", "knowledgeGroups", "chatThreads", "chatMessages", "cardVersions", "brainEdges", "brainReports", "brainShares"]), id: z.string().optional(), after: z.string().optional(), limit: z.number().int().min(1).max(100).optional(), contentOffset: z.number().int().nonnegative().optional(), contentLength: z.number().int().min(1).max(8000).optional() }), annotations: read,
  });
  register("chengjing_action_schema", {
    title: "Read batch action schema / 讀取批次動作格式",
    description: "Get the current built-in action schema before submitting chengjing_apply_actions. / 取得新增、修改、刪除及白板操作的完整欄位。",
    inputSchema: z.object({}), annotations: read,
  });
  register("chengjing_apply_actions", {
    title: "Apply batch actions / 執行批次動作",
    description: "Apply the built-in action plan atomically; no 40-action truncation. Read chengjing_action_schema and exact record IDs first. Includes create/update/delete for notes, tasks, fragments, boards and board nodes/edges. Cards are trashed, other deletions remove records. This is an explicit write under the configured MCP permission, not a preview. / 整批執行，不逐筆要求確認；失敗整批回滾。",
    inputSchema: z.object({ plan: z.object({ summary: z.string(), actions: z.array(z.record(z.string(), z.unknown())).min(1) }), boardId: z.string().optional() }), annotations: { ...update, idempotentHint: false },
  });
  register("chengjing_delete_items", {
    title: "Delete selected or all content / 批次刪除內容",
    description: "Delete exact ids or all:true in a content table. table:workspace with all:true clears work content and classifications, not conversations, credentials, sync bookkeeping or recovery points. Cards go to trash unless permanent:true. Attachment files are retained for recovery. Existing shared-brain sync may propagate changes/deletions to published copies; this call does not verify remote completion. / 支援整批與全部清除；已分享內容可能隨既有同步移除，永久刪除需明確指定。",
    inputSchema: z.object({ table: z.enum(["workspace", "cards", "boards", "tasks", "fragments", "kanbanBoards", "kanbanLists", "kanbanPlacements", "tags", "knowledgeGroups", "highlights", "brainEdges", "brainReports"]), ids: z.array(z.string().min(1)).optional(), all: z.boolean().optional(), permanent: z.boolean().optional() }), annotations: update,
  });
  register("chengjing_manage_metadata", {
    title: "Manage tags, groups, highlights and fragments / 整理分類與內容",
    description: "Create/update tags by name; knowledgeGroups by name/kind/parentId; highlights by cardId/content/note/color/page; fragments by content/pinned. Update brainEdges reason; use connect_neurons to create relations. Delete with delete_items. / 操作標籤、知識分類、劃記、片語與關聯說明。",
    inputSchema: z.object({ table: z.enum(["tags", "knowledgeGroups", "highlights", "brainEdges", "fragments"]), operation: z.enum(["create", "update"]), id: z.string().optional(), name: z.string().optional(), kind: z.enum(["area", "topic"]).optional(), parentId: z.string().optional(), cardId: z.string().optional(), content: z.string().optional(), note: z.string().optional(), color: z.string().optional(), page: z.number().int().positive().optional(), reason: z.string().optional(), pinned: z.boolean().optional() }), annotations: { ...update, idempotentHint: false },
  });
  register("chengjing_update_fields", {
    title: "Update content fields / 修改內容屬性",
    description: "cards: title/content(replace plain text)/favorite/tagIds/collectionId/color/properties/state/startAt/dueAt; boards: title/description/favorite/tagIds; fragments: text/pinned/tagIds; tasks: title/done/dueDate; kanbanBoards: title/description/favorite; boardNodes: title/text/color/x/y/width/height/collapsed. Existing tags and topic IDs required. Null detaches collection/dates. Immutable IDs, secrets and raw HTML are not fields. / 修改標籤、分類、表格屬性與白板節點等內容欄位。",
    inputSchema: z.object({ table: z.enum(["cards", "boards", "fragments", "tasks", "kanbanBoards", "boardNodes"]), id: z.string().min(1), expectedUpdatedAt: z.number().optional(), fields: z.record(z.string(), z.unknown()) }), annotations: update,
  });
  register("chengjing_create_note", {
    title: "Create note / 新增筆記",
    description: "Create a note. Plain text and bullet lines are converted to ChengJing rich content. / 建立筆記並轉為澄境內容格式。",
    inputSchema: z.object({ title: z.string().min(1).max(240), content: z.string().max(100000).optional(), favorite: z.boolean().optional(), collectionId: z.string().max(180).optional() }), annotations: create,
  });
  register("chengjing_update_note", {
    title: "Update note / 修改筆記",
    description: "Update a note only when expectedUpdatedAt matches the current record, preventing silent overwrites. contentMode is append or replace. / 需帶入最新 updatedAt，避免覆蓋同時發生的編輯。",
    inputSchema: z.object({ id: z.string().min(1).max(180), expectedUpdatedAt: z.number(), title: z.string().min(1).max(240).optional(), content: z.string().max(100000).optional(), contentMode: z.enum(["append", "replace"]).optional(), favorite: z.boolean().optional() }), annotations: update,
  });
  register("chengjing_create_task", {
    title: "Create task / 新增待辦",
    description: "Create a task, optionally linked to a note, parent task, and YYYY-MM-DD due date. / 建立待辦，可連結筆記、子待辦與日期。",
    inputSchema: z.object({ title: z.string().min(1).max(240), cardId: z.string().max(180).optional(), parentTaskId: z.string().max(180).optional(), dueDate: z.string().max(10).optional() }), annotations: create,
  });
  register("chengjing_update_task", {
    title: "Update task / 修改待辦",
    description: "Update a task with optimistic conflict protection. / 使用 updatedAt 防衝突地修改待辦。",
    inputSchema: z.object({ id: z.string().min(1).max(180), expectedUpdatedAt: z.number(), title: z.string().min(1).max(240).optional(), done: z.boolean().optional(), dueDate: z.string().max(10).nullable().optional() }), annotations: update,
  });
  register("chengjing_create_whiteboard", {
    title: "Create whiteboard / 新增白板",
    description: "Create an empty visual whiteboard. / 建立空白視覺白板。",
    inputSchema: z.object({ title: z.string().min(1).max(240), description: z.string().max(10000).optional(), favorite: z.boolean().optional() }), annotations: create,
  });
  register("chengjing_update_whiteboard", {
    title: "Update whiteboard / 修改白板",
    description: "Rename or edit a whiteboard with optimistic conflict protection. / 防衝突地修改白板名稱或說明。",
    inputSchema: z.object({ id: z.string().min(1).max(180), expectedUpdatedAt: z.number(), title: z.string().min(1).max(240).optional(), description: z.string().max(10000).optional(), favorite: z.boolean().optional() }), annotations: update,
  });
  register("chengjing_add_whiteboard_item", {
    title: "Add whiteboard item / 加入白板項目",
    description: "Add an existing note, a new note, text label, or section to a whiteboard. / 把既有筆記、新筆記、文字或區段放進白板。",
    inputSchema: z.object({ boardId: z.string().min(1).max(180), expectedUpdatedAt: z.number(), kind: z.enum(["existing_note", "note", "text", "section"]), noteId: z.string().max(180).optional(), title: z.string().max(240).optional(), content: z.string().max(100000).optional(), text: z.string().max(8000).optional(), x: z.number().optional(), y: z.number().optional(), width: z.number().optional(), height: z.number().optional() }), annotations: create,
  });
  register("chengjing_move_whiteboard_item", {
    title: "Move whiteboard item / 移動白板項目",
    description: "Move or resize a whiteboard node after reading the current whiteboard updatedAt. / 依目前白板版本移動或調整節點大小。",
    inputSchema: z.object({ id: z.string().min(1).max(180), expectedBoardUpdatedAt: z.number(), x: z.number().optional(), y: z.number().optional(), width: z.number().optional(), height: z.number().optional() }), annotations: update,
  });
  register("chengjing_create_kanban", {
    title: "Create kanban board / 新增看板",
    description: "Create a kanban board with initial list names. / 建立看板與初始清單。",
    inputSchema: z.object({ title: z.string().min(1).max(240), description: z.string().max(10000).optional(), lists: z.array(z.string().min(1).max(120)).optional() }), annotations: create,
  });
  register("chengjing_update_kanban", {
    title: "Update kanban / 修改看板",
    description: "Rename a board/list, add a list, place an existing note, or move a note. Read the board first and pass expectedUpdatedAt. / 修改看板、清單或卡片位置，需先讀取最新 updatedAt。",
    inputSchema: z.object({ boardId: z.string().min(1).max(180), expectedUpdatedAt: z.number(), operation: z.enum(["rename_board", "add_list", "rename_list", "place_note", "move_note"]), title: z.string().max(240).optional(), description: z.string().max(10000).optional(), listId: z.string().max(180).optional(), noteId: z.string().max(180).optional(), placementId: z.string().max(180).optional(), index: z.number().int().min(0).optional() }), annotations: update,
  });
  register("chengjing_create_neuron", {
    title: "Create neuron content / 新增神經元內容",
    description: "Create a note, task, fragment or whiteboard; these are the underlying neurons in ChengJing. / 建立會成為神經元的筆記、待辦、隻言片語或白板。",
    inputSchema: z.object({ type: z.enum(["note", "task", "fragment", "whiteboard"]), title: z.string().max(240).optional(), content: z.string().max(100000).optional(), description: z.string().max(10000).optional(), favorite: z.boolean().optional(), pinned: z.boolean().optional(), cardId: z.string().max(180).optional(), parentTaskId: z.string().max(180).optional(), dueDate: z.string().max(10).optional() }), annotations: create,
  });
  register("chengjing_connect_neurons", {
    title: "Connect neurons / 連結神經元",
    description: "Create an explicit relationship between two existing neurons. / 在兩個既有神經元之間建立明確關係。",
    inputSchema: z.object({ sourceType: z.enum(["card", "board", "task", "fragment"]), sourceId: z.string().min(1).max(180), targetType: z.enum(["card", "board", "task", "fragment"]), targetId: z.string().min(1).max(180), relationType: z.enum(["semantic", "shared_context", "possible_influence", "goal_obstacle", "sequence", "contrast", "reinforcement"]), reason: z.string().max(2000).optional() }), annotations: create,
  });

  server.registerResource("chengjing-capabilities", "chengjing://workspace/capabilities", {
    title: "ChengJing MCP capabilities", description: "Safety and data-model notes for agents", mimeType: "application/json",
  }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({
    transport: "local Streamable HTTP", accessModes: ["read-only", "ask", "allow"], permanentCardDelete: true,
    optimisticConcurrency: "Individual update tools require updatedAt. Batch actions use exact IDs without a version precondition.",
    batchActions: "chengjing_apply_actions uses explicit IDs but has no expectedUpdatedAt field. Read current data before planning. It supports deletion; cards are trashed. Use list_records for paginated full content access.",
    neurons: "Cards, boards, tasks and fragments are neuron content; brainEdges connect them.",
  }, null, 2) }] }));
  return server;
}

async function readJsonBody(request) {
  let size = 0; const chunks = [];
  for await (const raw of request) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw); size += chunk.length;
    if (size > BODY_LIMIT) throw new Error("mcp-body-too-large");
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : undefined;
}

function answer(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

function createChengJingMcpServer({ port, token, execute, version = "0.0.0", onError = () => {} }) {
  let httpServer = null; let handler = null;
  return {
    async start() {
      if (httpServer) return { port, endpoint: `http://127.0.0.1:${port}/mcp` };
      handler = createMcpHandler(() => buildMcpServer(execute, version), { onerror: onError });
      const nodeHandler = toNodeHandler(handler, { onerror: onError });
      const validateHost = localhostHostValidation(); const validateOrigin = localhostOriginValidation();
      httpServer = createServer(async (req, res) => {
        try {
          if (!validateHost(req, res) || !validateOrigin(req, res)) return;
          if ((req.url || "").split("?")[0] !== "/mcp") { answer(res, 404, { error: "not_found" }); return; }
          if (!safeEqual(req.headers.authorization, `Bearer ${token}`)) { answer(res, 401, { error: "unauthorized" }, { "WWW-Authenticate": "Bearer" }); return; }
          const declared = Number(req.headers["content-length"] || 0);
          if (declared > BODY_LIMIT) { answer(res, 413, { error: "request_too_large" }); return; }
          const parsedBody = req.method === "POST" ? await readJsonBody(req) : undefined;
          await nodeHandler(req, res, parsedBody);
        } catch (error) {
          onError(error);
          if (!res.headersSent) answer(res, error?.message === "mcp-body-too-large" ? 413 : 400, { error: "invalid_request" });
          else res.end();
        }
      });
      httpServer.requestTimeout = 70_000; httpServer.headersTimeout = 10_000; httpServer.keepAliveTimeout = 5_000;
      await new Promise((resolve, reject) => { httpServer.once("error", reject); httpServer.listen(port, "127.0.0.1", () => { httpServer.off("error", reject); resolve(); }); });
      return { port, endpoint: `http://127.0.0.1:${port}/mcp` };
    },
    async stop() {
      const current = httpServer; httpServer = null;
      if (handler) { await handler.close().catch(() => {}); handler = null; }
      if (current) await new Promise((resolve) => current.close(() => resolve()));
    },
  };
}

module.exports = { BODY_LIMIT, buildMcpServer, createChengJingMcpServer, safeEqual };
