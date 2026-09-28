 import {
   useCallback,
   useEffect,
   useMemo,
   useRef,
   useState,
 } from "react";
 import { useLocation } from "react-router-dom";

 import {
   NotGeneratedError,
   fetchRoadmap,
   startGeneration,
   subscribeRoadmapEvents,
 } from "../api/roadmaps";
 import { Roadmap, Topic } from "../types/roadmap";
 import { RoadmapFlow, PartialPhase } from "./RoadmapFlow";
 import ResourceDrawer from "./ResourceDrawer";

 /**
  * Roadmap display page (spec section 7 / plan Task 10).
  *
  * Entry flow:
  *  - fetchRoadmap(keyword) hits cache → render phases + time summary.
  *  - NotGeneratedError (404) → silently startGeneration(keyword, false) and
  *    stream SSE phase events into RoadmapFlow (idempotent dedup by phase id).
  *  - done event → replace with the full Roadmap + show total_duration_hint.
  *  - error event → error card + retry button (retriggers generation).
  *
  * Toolbar: keyword title + "重新生成" (force=true) + "分享" (copy URL,
  * success toast, silent failure per MVP decision).
  */
 export function RoadmapView() {
   const location = useLocation();
   // Keyword is URL-encoded in the path (spec section 7); decode it here.
   const keyword = useMemo(
     () => decodeURIComponent(location.pathname.replace(/^\/+/, "") || ""),
     [location.pathname],
   );

   const [phases, setPhases] = useState<PartialPhase[]>([]);
   const [generating, setGenerating] = useState(false);
   const [totalDurationHint, setTotalDurationHint] = useState<string | null>(null);
   const [error, setError] = useState<string | null>(null);
   const [toast, setToast] = useState<string | null>(null);
   const [activeTopic, setActiveTopic] = useState<Topic | null>(null);

   // Dedup: the API layer forwards every SSE phase event as-is; the render
   // layer is responsible for dropping duplicates of the same phase id.
   const seenPhaseIds = useRef<Set<string>>(new Set());

   // Keep the unsubscribe of the active SSE subscription in a ref so a new
   // subscription (retry / regenerate) can close the old one first.
   const unsubscribeRef = useRef<(() => void) | null>(null);

  // Guard against concurrent generation calls: a new generation supersedes
  // the previous one. The "superseded" flag is set when a new startGen begins
  // and cleared when the old generation stream terminates (done/error/unsub).
  const supersededRef = useRef(false);

   const closeCurrentSubscription = useCallback(() => {
     if (unsubscribeRef.current) {
       unsubscribeRef.current();
       unsubscribeRef.current = null;
     }
   }, []);

   const handlePhase = useCallback(
     (event: { phase: PartialPhase; index?: number; total?: number }) => {
       const phaseId = event.phase.id;
       // Idempotent dedup: drop repeated events for the same phase id.
       if (seenPhaseIds.current.has(phaseId)) return;
       seenPhaseIds.current.add(phaseId);

       setPhases((prev) => {
         const idx = prev.findIndex((p) => p.id === phaseId);
         if (idx >= 0) {
           // Replace in-place (a partial phase getting filled in).
           const next = prev.slice();
           next[idx] = event.phase;
           return next;
         }
         // Insert in stable order by phase.order when available.
         if (event.phase.order !== undefined) {
           return [...prev, event.phase].sort(
             (a, b) => (a.order ?? 0) - (b.order ?? 0),
           );
         }
         return [...prev, event.phase];
       });
     },
     [],
   );

   const handleDone = useCallback((event: { roadmap: Roadmap }) => {
     // Only apply if this is the current (non-superseded) generation.
     if (supersededRef.current) return;
     setGenerating(false);
     // done carries the full Roadmap; it is the source of truth.
     setPhases(event.roadmap.phases as unknown as PartialPhase[]);
     setTotalDurationHint(
       event.roadmap.total_duration_hint ? event.roadmap.total_duration_hint : null,
     );
     closeCurrentSubscription();
   }, [closeCurrentSubscription]);

   const handleError = useCallback((event: { error: string; retryable: boolean }) => {
     if (supersededRef.current) return;
     setGenerating(false);
     setError(event.error || "生成失败");
     closeCurrentSubscription();
   }, [closeCurrentSubscription]);

  /**
   * Start (or restart) generation for the keyword.
   * - force=true  → "重新生成" / retry: overwrite the cached roadmap.
   * - force=false → the silent 404 fallback on initial load.
   *
   * Supersede semantics: calling startGen while a previous generation is
   * still streaming marks the previous one as superseded, so any late
   * done/error events from the old stream are dropped.
   */
  const startGen = useCallback(
    async (force: boolean) => {
      // Mark the current stream (if any) as superseded so its late
      // done/error callbacks become no-ops, then start fresh.
      supersededRef.current = true;
      closeCurrentSubscription();
      supersededRef.current = false;

      seenPhaseIds.current = new Set();
      setPhases([]);
      setError(null);
      setTotalDurationHint(null);
      setGenerating(true);

      try {
        const { taskId } = await startGeneration(keyword, force);
        unsubscribeRef.current = subscribeRoadmapEvents(
          keyword,
          taskId,
          handlePhase,
          handleDone,
          handleError,
        );
      } catch (err) {
        setGenerating(false);
        setError((err as Error).message || "生成失败");
      }
    },
    [
      keyword,
      closeCurrentSubscription,
      handlePhase,
      handleDone,
      handleError,
    ],
  );

   // Initial load: try the cache first; a 404 is silently converted to
   // generation (the user never sees an error for not-generated keywords).
   useEffect(() => {
     let cancelled = false;

     async function load() {
       try {
         const roadmap = await fetchRoadmap(keyword);
         setPhases(roadmap.phases as unknown as PartialPhase[]);
         setTotalDurationHint(
           roadmap.total_duration_hint ? roadmap.total_duration_hint : null,
         );
         setGenerating(false);
       } catch (err) {
         if (err instanceof NotGeneratedError) {
           await startGen(false);
         } else {
           setGenerating(false);
           setError((err as Error).message || "加载失败");
         }
       }
     }

    // Start the load flow. Note: we deliberately do NOT guard with
    // `cancelled` here — a re-render of this effect (triggered by state
    // updates from the load flow itself re-creating `startGen`) must not
    // abort an in-flight generation. Unmount is handled by the cleanup
    // below, which closes the SSE subscription; any pending state
    // updates on an unmounted component are a no-op in React.
    if (keyword) void load();

     return () => {
       cancelled = true;
       closeCurrentSubscription();
     };
   // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [keyword, closeCurrentSubscription]);

   // "分享": copy the current URL. Success → brief toast; failure → silent
   // (MVP: no clipboard fallback, per the design ruling).
   const handleShare = useCallback(async () => {
     try {
       await navigator.clipboard.writeText(window.location.href);
       setToast("已复制链接");
       window.setTimeout(() => setToast(null), 2000);
     } catch {
       /* silent on failure */
     }
   }, []);

   // "重新生成" always forces a fresh generation (cache overwrite).
   const handleRegenerate = useCallback(() => {
     void startGen(true);
   }, [startGen]);

   // Retry after an SSE error: re-run generation with force=true so the
   // previous failed/cached state is replaced.
   const handleRetry = useCallback(() => {
     void startGen(true);
   }, [startGen]);

   return (
     <div
       style={{
         display: "flex",
         flexDirection: "column",
         width: "100vw",
         height: "100vh",
         position: "relative",
       }}
     >
       {/* ---------- Toolbar ---------- */}
       <div
         style={{
           display: "flex",
           alignItems: "center",
           gap: 12,
           padding: "12px 20px",
           borderBottom: "1px solid #e5e7eb",
           background: "#fff",
           zIndex: 11,
         }}
       >
         <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{keyword}</h1>
         <div style={{ flex: 1 }} />
         <button
           data-testid="roadmap-regenerate"
           onClick={handleRegenerate}
           style={{
             padding: "6px 14px",
             fontSize: 13,
             border: "1px solid #d0d5dd",
             borderRadius: 6,
             background: "#fff",
             cursor: "pointer",
           }}
         >
           {generating ? "生成中…" : "重新生成"}
         </button>
         <button
           onClick={() => void handleShare()}
           style={{
             padding: "6px 14px",
             fontSize: 13,
             border: "1px solid #d0d5dd",
             borderRadius: 6,
             background: "#fff",
             cursor: "pointer",
           }}
         >
           分享
         </button>
       </div>

       {/* ---------- Toast ---------- */}
       {toast ? (
         <div
           role="status"
           style={{
             position: "absolute",
             top: 60,
             right: 20,
             padding: "8px 16px",
             borderRadius: 6,
             background: "#111827",
             color: "#fff",
             fontSize: 13,
             zIndex: 20,
           }}
         >
           {toast}
         </div>
       ) : null}

       {/* ---------- Main body ---------- */}
       <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
         {error ? (
           <div
             data-testid="error-card"
             style={{
               display: "flex",
               flexDirection: "column",
               alignItems: "center",
               justifyContent: "center",
               height: "100%",
               gap: 12,
             }}
           >
             <div
               style={{
                 padding: 20,
                 borderRadius: 8,
                 border: "1px solid #fecaca",
                 background: "#fef2f2",
                 color: "#991b1b",
                 fontSize: 14,
               }}
             >
               生成失败：{error}
             </div>
             <button
               data-testid="roadmap-retry"
               onClick={handleRetry}
               style={{
                 padding: "8px 20px",
                 fontSize: 14,
                 border: "1px solid #d0d5dd",
                 borderRadius: 6,
                 background: "#fff",
                 cursor: "pointer",
               }}
             >
               重试
             </button>
           </div>
         ) : (
           <RoadmapFlow
             phases={phases}
             generating={generating}
             onTopicClick={setActiveTopic}
           />
         )}

         <ResourceDrawer
           topic={activeTopic}
           onClose={() => setActiveTopic(null)}
         />
       </div>

       {/* ---------- Bottom: time summary ---------- */}
       <div
         style={{
           display: "flex",
           alignItems: "center",
           justifyContent: "center",
           padding: "10px 20px",
           borderTop: "1px solid #e5e7eb",
           background: "#fafafa",
           fontSize: 13,
           color: "#4b5563",
         }}
       >
         {generating
           ? "时间汇总将在生成完成后显示"
           : totalDurationHint
             ? totalDurationHint
             : "—"}
       </div>
     </div>
   );
 }

 export default RoadmapView;
