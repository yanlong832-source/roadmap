 import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
 import { MemoryRouter } from "react-router-dom";
 import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

 import * as api from "../../api/roadmaps";
 import { Phase, Roadmap, Topic } from "../../types/roadmap";
 import { RoadmapView } from "../RoadmapView";

 /* ------------------------------------------------------------------ */
 /* api-layer mocks                                                     */
 /* ------------------------------------------------------------------ */

 const fetchRoadmap = vi.fn();
 const startGeneration = vi.fn();
 const subscribeRoadmapEvents = vi.fn();

 vi.mock("../../api/roadmaps", () => ({
   fetchRoadmap: (...args: unknown[]) => fetchRoadmap(...args),
   startGeneration: (...args: unknown[]) => startGeneration(...args),
   subscribeRoadmapEvents: (...args: unknown[]) =>
     subscribeRoadmapEvents(...args),
   NotGeneratedError: class NotGeneratedError extends Error {
     keyword: string;
     constructor(keyword: string) {
       super(`roadmap not generated for "${keyword}"`);
       this.name = "NotGeneratedError";
       this.keyword = keyword;
     }
   },
 }));

 /* ------------------------------------------------------------------ */
 /* fixtures                                                            */
 /* ------------------------------------------------------------------ */

 function makeTopic(id: string, phaseId: string, title: string): Topic {
   return {
     id,
     phase_id: phaseId,
     title,
     description: `${title} 的一句话说明`,
     duration_hint: "2 周",
     resources: [
       {
         title: "B 站教程",
         url: "https://www.bilibili.com/video/BV1xx411c7mD",
         type: "bilibili",
         note: "单集深链",
       },
     ],
   };
 }

 const phase1: Phase = {
   id: "p1",
   name: "基础",
   order: 1,
   topics: [makeTopic("p1t1", "p1", "向量检索")],
 };

 const phase2: Phase = {
   id: "p2",
   name: "进阶",
   order: 2,
   topics: [makeTopic("p2t1", "p2", "混合检索")],
 };

 const fullRoadmap: Roadmap = {
   keyword: "rag",
   title: "RAG 学习路线",
   summary: "从零到能用",
   total_duration_hint: "共 8 周",
   phases: [phase1, phase2],
 };

 const notGenerated = new api.NotGeneratedError("rag");

 /** Captured SSE callbacks — tests replay server events deterministically. */
 let sse: {
   onPhase: (event: { phase: Phase; index?: number; total?: number }) => void;
   onDone: (event: { roadmap: Roadmap }) => void;
   onError: (event: { error: string; retryable: boolean }) => void;
 } | null = null;


 beforeEach(() => {
   vi.clearAllMocks();
   sse = null;
   fetchRoadmap.mockReset();
   startGeneration.mockReset();
   subscribeRoadmapEvents.mockReset();
   // subscribing captures the callbacks so tests can replay events
   subscribeRoadmapEvents.mockImplementation(
     (
       _keyword: string,
       _taskId: string,
       ...callbacks: [
         (e: { phase: Phase; index?: number; total?: number }) => void,
         (e: { roadmap: Roadmap }) => void,
         (e: { error: string; retryable: boolean }) => void,
       ]
     ) => {
       sse = { onPhase: callbacks[0], onDone: callbacks[1], onError: callbacks[2] };
       return () => {};
     },
   );
 });

 afterEach(() => {
   sse = null;
   cleanup();
 });

 /* ------------------------------------------------------------------ */
 /* cache hit                                                            */
 /* ------------------------------------------------------------------ */

 describe("RoadmapView — 缓存命中直接渲染", () => {
   it("fetchRoadmap 命中时渲染所有 phase 与底部时间汇总，不触发生成", async () => {
     fetchRoadmap.mockResolvedValue(fullRoadmap);
     render(
       <MemoryRouter initialEntries={["/rag"]}>
         <RoadmapView />
       </MemoryRouter>,
     );

     expect(await screen.findByText("向量检索")).toBeInTheDocument();
     expect(await screen.findByText("混合检索")).toBeInTheDocument();
     // 时间汇总直接来自缓存 roadmap 的 total_duration_hint
     expect(await screen.findByText("共 8 周")).toBeInTheDocument();
     expect(startGeneration).not.toHaveBeenCalled();
     expect(subscribeRoadmapEvents).not.toHaveBeenCalled();
   });
 });

 /* ------------------------------------------------------------------ */
 /* 404 → 静默转生成 → SSE 逐 phase 增量渲染                               */
 /* ------------------------------------------------------------------ */

 describe("RoadmapView — 404 not_generated 静默转生成", () => {
   it("404 时静默调用 startGeneration + subscribeRoadmapEvents，逐 phase 增量渲染", async () => {
     fetchRoadmap.mockRejectedValue(notGenerated);
     startGeneration.mockResolvedValue({
       taskId: "task-1",
       eventStream: "/api/roadmaps/rag/events?task_id=task-1",
     });

     render(
       <MemoryRouter initialEntries={["/rag"]}>
         <RoadmapView />
       </MemoryRouter>,
     );

     // 静默：无错误卡片，直接走生成 + SSE
     await vi.waitFor(() => {
       expect(startGeneration).toHaveBeenCalledTimes(1);
       expect(startGeneration.mock.calls[0]).toEqual([
         "rag",
         expect.anything(), // force 默认值
       ]);
       expect(subscribeRoadmapEvents).toHaveBeenCalledTimes(1);
       expect(subscribeRoadmapEvents.mock.calls[0]).toEqual([
         "rag",
         "task-1",
         expect.any(Function),
         expect.any(Function),
         expect.any(Function),
       ]);
     });

     // 第一个 phase 事件 → 节点增量出现
     act(() => sse?.onPhase({ phase: phase1, index: 1, total: 2 }));
     expect(await screen.findByText("向量检索")).toBeInTheDocument();

     // 第二个 phase 事件 → 追加渲染
     act(() => sse?.onPhase({ phase: phase2, index: 2, total: 2 }));
     expect(await screen.findByText("混合检索")).toBeInTheDocument();

     // 生成中：时间汇总位置显示占位文案
     expect(screen.getByText("时间汇总将在生成完成后显示")).toBeInTheDocument();
     expect(screen.queryByText("共 8 周")).not.toBeInTheDocument();
   });

   it("幂等去重：同 phase_id 的重复事件不会重复添加节点", async () => {
     fetchRoadmap.mockRejectedValue(notGenerated);
     startGeneration.mockResolvedValue({
       taskId: "task-1",
       eventStream: "/api/roadmaps/rag/events?task_id=task-1",
     });

     render(
       <MemoryRouter initialEntries={["/rag"]}>
         <RoadmapView />
       </MemoryRouter>,
     );

     await vi.waitFor(() => expect(sse).not.toBeNull());

     act(() => sse?.onPhase({ phase: phase1, index: 1, total: 2 }));
     await screen.findByText("向量检索");

     // 同一 phase 事件重复两次 + 再来一个新 phase
     act(() => {
       sse?.onPhase({ phase: phase1, index: 1, total: 2 });
       sse?.onPhase({ phase: phase1, index: 1, total: 2 });
       sse?.onPhase({ phase: phase2, index: 2, total: 2 });
     });

     // 去重后，「向量检索」节点只有一份
     expect(screen.getAllByText("向量检索")).toHaveLength(1);
     // 新 phase 正常追加
     expect(screen.getAllByText("混合检索")).toHaveLength(1);
   });

   it("done 事件补全 roadmap 并显示底部总时间汇总", async () => {
     fetchRoadmap.mockRejectedValue(notGenerated);
     startGeneration.mockResolvedValue({
       taskId: "task-1",
       eventStream: "/api/roadmaps/rag/events?task_id=task-1",
     });

     render(
       <MemoryRouter initialEntries={["/rag"]}>
         <RoadmapView />
       </MemoryRouter>,
     );

     // Wait for startGeneration + subscribeRoadmapEvents to finish so sse is assigned
     await vi.waitFor(() => expect(sse).not.toBeNull());

     act(() => sse!.onPhase({ phase: phase1, index: 1, total: 2 }));
     await screen.findByText("向量检索");

     act(() => {
       sse!.onDone({ roadmap: fullRoadmap });
     });

     // 总时间汇总出现，占位文案消失
     expect(await screen.findByText("共 8 周")).toBeInTheDocument();
     expect(screen.queryByText("时间汇总将在生成完成后显示")).not.toBeInTheDocument();
   });
 });

 /* ------------------------------------------------------------------ */
 /* SSE error → 错误卡片 + 重试                                           */
 /* ------------------------------------------------------------------ */

 describe("RoadmapView — SSE error 事件", () => {
   it("SSE error → 错误卡片 + 重试按钮，点击重试调用 startGeneration(force=true)", async () => {
     fetchRoadmap.mockRejectedValue(notGenerated);
     startGeneration.mockResolvedValue({
       taskId: "task-1",
       eventStream: "/api/roadmaps/rag/events?task_id=task-1",
     });

     render(
       <MemoryRouter initialEntries={["/rag"]}>
         <RoadmapView />
       </MemoryRouter>,
     );

     await vi.waitFor(() => expect(sse).not.toBeNull());

     act(() => {
       sse?.onError({ error: "LLM timeout", retryable: true });
     });

     // 错误卡片出现
     const errorCard = await screen.findByText(/生成失败/);
     expect(errorCard).toBeInTheDocument();

     const retryButton = await screen.findByTestId("roadmap-retry");
     expect(startGeneration).toHaveBeenCalledTimes(1);

     fireEvent.click(retryButton);

     // 重试 = 重走生成：startGeneration 第二次调用且 force=true
     await vi.waitFor(() => {
       expect(startGeneration).toHaveBeenCalledTimes(2);
       expect(startGeneration.mock.calls[1]).toEqual(["rag", true]);
     });
     // 重新订阅 SSE
     await vi.waitFor(() => {
       expect(subscribeRoadmapEvents).toHaveBeenCalledTimes(2);
     });
   });
 });

 /* ------------------------------------------------------------------ */
 /* 顶部工具栏：重新生成 + 分享                                           */
 /* ------------------------------------------------------------------ */

 describe("RoadmapView — 顶部工具栏", () => {
   it('「重新生成」按钮调用 startGeneration(force=true)', async () => {
     fetchRoadmap.mockRejectedValue(notGenerated);
     startGeneration.mockResolvedValue({
       taskId: "task-2",
       eventStream: "/api/roadmaps/rag/events?task_id=task-2",
     });

     render(
       <MemoryRouter initialEntries={["/rag"]}>
         <RoadmapView />
       </MemoryRouter>,
     );

     await vi.waitFor(() => expect(sse).not.toBeNull());

     // 生成中时按钮文案为「生成中…」，用 data-testid 定位
     const regenerate = screen.getByTestId("roadmap-regenerate");
     fireEvent.click(regenerate);

     await vi.waitFor(() => {
       expect(startGeneration).toHaveBeenCalledTimes(2);
       expect(startGeneration.mock.calls[1]).toEqual(["rag", true]);
     });
     // force 生成会重新订阅事件流
    await vi.waitFor(() => {
      expect(subscribeRoadmapEvents).toHaveBeenCalledTimes(2);
    });
   });

   it('「分享」按钮复制当前 URL，成功显示「已复制链接」toast', async () => {
     fetchRoadmap.mockResolvedValue(fullRoadmap);

     const writeTextMock = vi.fn().mockResolvedValue(undefined);
     Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

     render(
       <MemoryRouter initialEntries={["/rag"]}>
         <RoadmapView />
       </MemoryRouter>,
     );

     await screen.findByText("向量检索");
     const share = screen.getByRole("button", { name: "分享" });
     fireEvent.click(share);

     await vi.waitFor(() => {
       expect(writeTextMock).toHaveBeenCalledTimes(1);
       expect(writeTextMock.mock.calls[0]).toEqual([window.location.href]);
     });
     expect(await screen.findByText("已复制链接")).toBeInTheDocument();
   });

   it("分享失败时静默（无 toast，不抛错）", async () => {
     fetchRoadmap.mockResolvedValue(fullRoadmap);

     const writeTextMock = vi.fn().mockRejectedValue(new Error("denied"));
     Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

     render(
       <MemoryRouter initialEntries={["/rag"]}>
         <RoadmapView />
       </MemoryRouter>,
     );

     await screen.findByText("向量检索");
     fireEvent.click(screen.getByRole("button", { name: "分享" }));

     await vi.waitFor(() => {
       expect(writeTextMock).toHaveBeenCalledTimes(1);
     });
     // 失败静默：toast 不应出现
     act(() => {});
     expect(screen.queryByText("已复制链接")).not.toBeInTheDocument();
   });
 });
