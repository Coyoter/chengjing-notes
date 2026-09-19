import { buildBrainGraph } from "./brain";
import { isVisibleCard } from "./cardVisibility";
import type { CardRecord, TaskRecord, BoardRecord, BoardNodeRecord, BrainEdgeRecord, TagRecord, AppLanguage } from "../types";

export const BRAIN_WINDOW = { cards: 1000, tasks: 200, boards: 80, search: 100, edges: 2400, boardNodes: 2000 };
export type BrainWorkspaceRequest = { database: string; language: AppLanguage; query: string; page: number };
export type BrainWorkspace = { graph: ReturnType<typeof buildBrainGraph>; tasks: TaskRecord[]; hasMore: boolean; scanned: number; elapsedMs: number };

// This read-only connection runs in a worker. It never upgrades or writes the user's database.
export async function readBrainWorkspace(input: BrainWorkspaceRequest): Promise<BrainWorkspace> {
  const started = performance.now();
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(input.database);
    request.onupgradeneeded = () => { request.transaction?.abort(); reject(new Error("brain-database-not-ready")); };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  let scanned = 0;
  const query = input.query.normalize("NFKC").toLocaleLowerCase(input.language).trim();
  const matches = (text: string) => !query || text.normalize("NFKC").toLocaleLowerCase(input.language).includes(query);
  function read<T>(store: string, index: string | null, predicate: (value: T) => boolean, limit: number, skip = 0, range?: IDBKeyRange, project: (value: T) => T = (value) => value): Promise<T[]> {
    return new Promise((resolve, reject) => {
      const tx = database.transaction(store, "readonly");
      const table = tx.objectStore(store);
      const source = index ? table.index(index) : table;
      const request = source.openCursor(range, "prev");
      const result: T[] = [];
      request.onerror = () => reject(request.error);
      tx.onabort = () => reject(tx.error || new Error("brain-read-aborted"));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || result.length >= limit) { resolve(result); return; }
        scanned++;
        const value = cursor.value as T;
        if (predicate(value)) { if (skip) skip--; else result.push(project(value)); }
        cursor.continue();
      };
    });
  }
  async function getMany<T>(store: string, ids: string[]): Promise<T[]> {
    if (!ids.length) return [];
    return new Promise((resolve, reject) => {
      const tx = database.transaction(store, "readonly"); const result: T[] = [];
      for (const id of new Set(ids)) {
        const req = tx.objectStore(store).get(id);
        req.onsuccess = () => { if (req.result) result.push(req.result); };
      }
      tx.oncomplete = () => resolve(result); tx.onerror = () => reject(tx.error);
    });
  }
  // Keep a useful excerpt near the match; full text remains in the original card.
  const excerpt = (text: string) => {
    const at = query ? Math.max(0, text.normalize("NFKC").toLocaleLowerCase(input.language).indexOf(query) - 200) : 0;
    return text.slice(at, at + 2400);
  };
  const compactCard = (card: CardRecord): CardRecord => ({ ...card, plainText: excerpt(card.plainText), contentHtml: "", searchTerms: [], properties: {} });
  try {
    const limits = query ? { cards: BRAIN_WINDOW.search, tasks: BRAIN_WINDOW.search, boards: BRAIN_WINDOW.search } : BRAIN_WINDOW;
    const [cardRows, taskRows, boardRows] = await Promise.all([
      read<CardRecord>("cards", "updatedAt", (card) => isVisibleCard(card) && matches(`${card.title}\n${card.plainText}`), limits.cards + 1, input.page * limits.cards, undefined, compactCard),
      read<TaskRecord>("tasks", "updatedAt", (task) => matches(task.title), limits.tasks + 1, input.page * limits.tasks),
      read<BoardRecord>("boards", "updatedAt", (board) => matches(`${board.title}\n${board.description}`), limits.boards + 1, input.page * limits.boards),
    ]);
    const hasMore = cardRows.length > limits.cards || taskRows.length > limits.tasks || boardRows.length > limits.boards;
    const cards = cardRows.slice(0, limits.cards); const tasks = taskRows.slice(0, limits.tasks); const boards = boardRows.slice(0, limits.boards);
    // Resolve all task ancestors so archived parents never expose orphan child tasks.
    const taskMap = new Map(tasks.map((task) => [task.id, task]));
    let frontier = tasks.map((task) => task.parentTaskId).filter((id): id is string => Boolean(id && !taskMap.has(id)));
    for (let depth = 0; frontier.length && depth < 64; depth++) {
      const parents = await getMany<TaskRecord>("tasks", frontier);
      parents.forEach((task) => taskMap.set(task.id, task));
      frontier = parents.map((task) => task.parentTaskId).filter((id): id is string => Boolean(id && !taskMap.has(id)));
    }
    const sources = await getMany<CardRecord>("cards", [...taskMap.values()].map((task) => task.cardId).filter((id): id is string => Boolean(id)));
    const hidden = new Set(sources.filter((card) => !Boolean(isVisibleCard(card))).map((card) => card.id));
    const safeTask = (task: TaskRecord) => {
      const seen = new Set<string>(); let current: TaskRecord | undefined = task;
      while (current) {
        if (seen.has(current.id) || (current.cardId && hidden.has(current.cardId))) return false;
        seen.add(current.id);
        if (current.parentTaskId && !taskMap.has(current.parentTaskId)) return false;
        current = current.parentTaskId ? taskMap.get(current.parentTaskId) : undefined;
      }
      return true;
    };
    const visibleTasks = tasks.filter(safeTask);
    const directSources = new Set(visibleTasks.map((task) => task.cardId));
    const supportCards = sources.filter((card) => directSources.has(card.id) && isVisibleCard(card)).map(compactCard);
    const cardMap = new Map([...cards, ...supportCards].map((card) => [card.id, card]));
    const boardNodes: BoardNodeRecord[] = [];
    for (const board of boards) {
      if (boardNodes.length >= BRAIN_WINDOW.boardNodes) break;
      boardNodes.push(...await read<BoardNodeRecord>("boardNodes", "boardId", () => true, BRAIN_WINDOW.boardNodes - boardNodes.length, 0, IDBKeyRange.only(board.id)));
    }
    const tags = await getMany<TagRecord>("tags", [...cardMap.values(), ...boards].flatMap((row) => row.tagIds || []));
    const keys = [...cardMap.keys()].map((id) => ["card", id]).concat(visibleTasks.map((row) => ["task", row.id]), boards.map((row) => ["board", row.id]));
    const edgeMap = new Map<string, BrainEdgeRecord>();
    // Each lookup is indexed and the live relationship set has a hard memory bound.
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction("brainEdges", "readonly");
      const table = tx.objectStore("brainEdges");
      for (const index of ["[sourceType+sourceId]", "[targetType+targetId]"]) for (const key of keys) {
        const request = table.index(index).openCursor(IDBKeyRange.only(key));
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor || edgeMap.size >= BRAIN_WINDOW.edges) return;
          const edge = cursor.value as BrainEdgeRecord; edgeMap.set(edge.id, edge); cursor.continue();
        };
      }
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
    const graph = buildBrainGraph({ cards: [...cardMap.values()], tasks: visibleTasks, boards, boardNodes, tags, fragments: [], storedEdges: [...edgeMap.values()], language: input.language });
    return { graph, tasks: visibleTasks, hasMore, scanned, elapsedMs: performance.now() - started };
  } finally { database.close(); }
}
