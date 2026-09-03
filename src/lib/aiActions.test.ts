import { describe, expect, it } from "vitest";
import { boardPlanNeedsContentRepair, looksLikeAIAction, materializeAIActionPlan, parseAIActionPlan, planHasDestructiveActions } from "./aiActions";

describe("AI 動作計畫", () => {
  it("解析 JSON fence、忽略未知動作並限制危險欄位長度", () => {
    const plan = parseAIActionPlan(`\`\`\`json
      {"summary":"整理會議","actions":[
        {"type":"create_board_card","description":"建立決議卡片","tempId":"decision","title":"決議","content":"完成新版"},
        {"type":"delete_card","description":"移到垃圾桶","targetId":"card-old"},
        {"type":"run_shell","description":"不允許"}
      ]}
    \`\`\``);
    expect(plan.summary).toBe("整理會議");
    expect(plan.actions).toHaveLength(2);
    expect(plan.actions[0].type).toBe("create_board_card");
    expect(planHasDestructiveActions(plan)).toBe(true);
  });

  it("中英文自然語言修改要求會進入動作模式，一般提問不會", () => {
    expect(looksLikeAIAction("請新增三張卡片並建立待辦")).toBe(true);
    expect(looksLikeAIAction("/組織白板：整理這份會議記錄")).toBe(true);
    expect(looksLikeAIAction("把這張卡片轉換成全新的白板")).toBe(true);
    expect(looksLikeAIAction("請將白板結論匯出到卡片")).toBe(true);
    expect(looksLikeAIAction("請移動這張卡片並重新分組白板")).toBe(true);
    expect(looksLikeAIAction("create a task and move this card")).toBe(true);
    expect(looksLikeAIAction("這張卡片的核心觀點是什麼？")).toBe(false);
    expect(looksLikeAIAction("你能幫我整理這個白板的重點嗎？")).toBe(false);
    expect(looksLikeAIAction("/整理白板：建議更清楚的分組與連線方式。")).toBe(false);
    expect(looksLikeAIAction("Organize the key points of this board")).toBe(false);
  });

  it("保留新白板參照，並把刪除白板視為需明確確認的動作", () => {
    const plan = parseAIActionPlan(JSON.stringify({
      summary: "把卡片拆成新白板",
      actions: [
        { type: "create_board", tempId: "new-board", title: "研究架構", description: "建立白板" },
        { type: "create_board_card", tempId: "core", boardRef: "new-board", title: "核心問題", content: "先釐清問題", description: "建立核心卡片" },
        { type: "delete_board", targetId: "old-board", description: "刪除舊白板" },
      ],
    }));
    expect(plan.actions[1].boardRef).toBe("new-board");
    expect(planHasDestructiveActions(plan)).toBe(true);
  });

  it("模型漏掉新白板暫存名稱時會補上安全參照", () => {
    const plan = parseAIActionPlan('{"summary":"建立白板","actions":[{"type":"create_board","description":"建立研究白板","title":"研究白板"}]}');
    expect(plan.actions[0].tempId).toBe("new-board-1");
  });

  it("接受常見的關係線欄位別名並補上可讀說明", () => {
    const plan = parseAIActionPlan('{"summary":"建立連線","actions":[{"type":"create_board_card","title":"角色定位"},{"type":"create_board_card","title":"KPI 架構"},{"type":"create_board_edge","source":"角色定位","target":{"title":"KPI 架構"},"label":"影響"}]}');
    expect(plan.actions[0].tempId).toBe("new-node-1");
    expect(plan.actions[2]).toMatchObject({ sourceRef: "角色定位", targetRef: "KPI 架構", description: "建立「影響」關係線" });
  });

  it("接受巢狀 name 與 body 欄位作為白板實際內容", () => {
    const plan = parseAIActionPlan('{"summary":"拆解","actions":[{"type":"create_board_section","description":"職責轉型","parameters":{"name":"職責與 KPI","temp_id":"section-role"}},{"type":"create_board_card","description":"角色定位","arguments":{"heading":"Producer 角色","body":["承接產品方向","確認跨團隊責任"]}}]}');
    expect(plan.actions[0]).toMatchObject({ title: "職責與 KPI", tempId: "section-role" });
    expect(plan.actions[1].title).toBe("Producer 角色");
    expect(plan.actions[1].content).toContain("• 承接產品方向");
  });

  it("缺少 title 與 content 的白板計畫會要求修復，保底後也不會建立空白卡片", () => {
    const incomplete = parseAIActionPlan('{"summary":"拆解","actions":[{"type":"create_board","description":"會議策略白板"},{"type":"create_board_section","description":"一、職責與 KPI 轉型"},{"type":"create_board_card","description":"角色定位轉型（Producer / PO）"}]}');
    expect(boardPlanNeedsContentRepair(incomplete)).toBe(true);
    const materialized = materializeAIActionPlan(incomplete);
    expect(materialized.actions[0].title).toBe("會議策略白板");
    expect(materialized.actions[1].title).toBe("一、職責與 KPI 轉型");
    expect(materialized.actions[2]).toMatchObject({ title: "角色定位轉型（Producer / PO）", content: "角色定位轉型（Producer / PO）" });
  });
});
