import { describe, expect, it } from "vitest";
import { appendBoardSnapshot, boardHistoryTarget, createBoardSnapshot, type BoardHistoryState } from "./boardHistory";

describe("白板操作歷史", () => {
  const snapshot = (x: number) => createBoardSnapshot([{ id: "node", boardId: "board", kind: "card", x, y: 0 }], []);

  it("相同狀態不重複寫入，復原後的新操作會清除下一步分支", () => {
    let history = appendBoardSnapshot({ entries: [], index: -1 }, snapshot(0));
    history = appendBoardSnapshot(history, snapshot(0));
    history = appendBoardSnapshot(history, snapshot(20));
    expect(history.entries).toHaveLength(2);
    const previous = boardHistoryTarget(history, "undo")!;
    history = { entries: history.entries, index: previous.index };
    history = appendBoardSnapshot(history, snapshot(50));
    expect(history.entries.map((entry) => entry.nodes[0].x)).toEqual([0, 50]);
    expect(boardHistoryTarget(history, "redo")).toBeNull();
  });

  it("最多保留指定數量的最近狀態", () => {
    let history: BoardHistoryState = { entries: [], index: -1 };
    for (let index = 0; index < 6; index += 1) history = appendBoardSnapshot(history, snapshot(index), 3);
    expect(history.entries.map((entry) => entry.nodes[0].x)).toEqual([3, 4, 5]);
  });
});
