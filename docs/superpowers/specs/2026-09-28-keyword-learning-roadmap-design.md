 # 关键词学习路线生成网站 - 设计规格
 
 > 状态：已评审通过（用户逐节确认）。日期：2026-09-28。
 > 产品定位：输入任意关键词，LLM 实时生成一条「行业专家级别」的结构化学习路线，
 > 以流程图（React Flow）展示，支持流式生成（SSE）与分享链接。
 
 ## 1. 需求与定位
 
 - 用户输入关键词（如「前端」「RAG」「吉他」），获得一条可执行学习路线。
 - 路线终点为**该领域行业专家 / 高级工程师级**，阶段数量随领域复杂度自适应，
   覆盖完整知识版图，不为精简砍掉高阶阶段。
 - 覆盖任意领域（泛化定位），统一结构：phases（阶段）→ topics（主题）→ resources（资源）。
 - MVP 无账户、无登录；提供分享链接（`/{keyword}`，命中缓存秒回）。
 - 资源要求：**真实存在优先**，在此前提下尽量给到章节/课时/单集级深链；
   视频资源以 **Bilibili** 为主（替代 YouTube）；不确定深链时退到真实主页，禁止编造。
 
 ## 2. 技术栈与仓库布局
 
 - 前端：React + Vite + React Flow（路线图渲染）。
 - 后端：Python FastAPI + Redis（缓存 + 任务状态）+ LLM（OpenAI 兼容接口）。
 - 单仓库、目录分离；目录 `D:\code\myserver\roadmap`。
 
 ```
 roadmap/
   frontend/          # React + Vite；dev 用 Vite dev server，build 产物 dist/
   backend/
     app/
       main.py        # FastAPI 入口：路由、CORS、部署期静态托管 dist/
       routes/roadmaps.py
       services/generator.py   # LLM 调用 + 逐阶段生成
       services/cache.py       # Redis 读写 + 降级
       services/tasks.py       # 进程内异步任务队列
       models.py               # Pydantic 路线模型
       prompts.py              # 提示词（内嵌 JSON schema）
     tests/
   docker-compose.yml # 本地 redis
   .env.example
   README.md
 ```
 
 部署形态：MVP 单进程。前端 `dist/` 由 FastAPI 静态托管（`/` 走前端，`/api` 走接口），
 一份 Docker。开发期前后端各跑一个进程，Vite 代理 `/api` → `:8000`。
 不做多 worker 横向扩展（用户确认 YAGNI）。
 
 ## 3. 数据模型
 
 ```
 Roadmap {
   keyword: string            # 归一化关键词（小写+去首尾+压缩空格）= 缓存 key
   title: string
   summary: string
   total_duration_hint: string
   phases: Phase[]
 }
 Phase { id: "p1".., name: string, order: int, topics: Topic[] }
 Topic {
   id: "p1t1".., phase_id: string, title: string,
   description: string, duration_hint: string, resources: Resource[]
 }
 Resource {
   title: string, url: string,
   type: "bilibili" | "doc" | "book" | "course" | "project",
   note?: string
 }
 ```
 
 前端 TS 类型镜像该结构。React Flow 映射：每个 Topic 一个节点，
 纵向分层（phase 上→下），同 phase topics 横排，同 phase 内用 link 串「先修后修」，
 跨 phase 用 link 连接；启用 minimap + controls。
 
 ## 4. 生成流程与 API（异步 + SSE）
 
 1. `GET /api/roadmaps/{keyword}` - 只读缓存。
    命中 → `200` 返回完整 Roadmap（分享/刷新路径，秒回）。
    未命中 → `404 { "error": "not_generated" }`，前端静默切生成流程。
 2. `POST /api/roadmaps/{keyword}/generate` - 启动异步任务，立即
    `202 { "task_id", "event_stream" }`。同 keyword 进行中任务去重（复用 task_id，避免重复 LLM 费用）。
 3. `GET /api/roadmaps/{keyword}/events?task_id=...` - SSE 流。事件：
    - `phase`：每生成完一个阶段推一条 `{ phase_id, name, order, topics }`，前端逐阶段渲染节点。
    - `done`：完整 Roadmap + 完成信号。
    - `error`：`{ "error", "retryable": true }`。
    - LLM 逐阶段分段生成，每段解析成功即 emit；单段失败重试 1 次（temperature 0.4→0.2），仍失败发 error。
 4. 任务状态存 Redis `task:{keyword}`（`running|done|error` + 已完成 phase 列表），
    SSE 断线重连带 task_id 重放已生成 phase，不丢进度。生成完写 `roadmap:{keyword}`（TTL 7 天）并标记 done。
 5. 超时：任务 > 90s 未完成 → 服务端发 `error` 关流；LLM 单段调用 60s 上限。
 6. 重新生成：`POST /generate` 带 `?force=1` 跳过缓存读、重跑并覆盖写回。
 7. `GET /api/health`：`{ redis, llm_key, tasks_in_flight }` 部署自检。
 
 响应约定：成功直接返回 Roadmap 本体；失败统一 `{ "error": string, "retryable": bool }`。
 关键词空/纯空白 → 前端拦截；> 100 字符 → `422`。
 
 ## 5. 提示词与质量控制（prompts.py）
 
 - 系统提示：资深学习规划师，为任意关键词产出「可执行」路线；
   以**行业专家级**为终点划分阶段，阶段数随复杂度自适应（简单 4-6，复杂可到 6-8），
   覆盖完整知识版图；每阶段 topics 3-6，每 topic 资源 2-4。
 - 资源规则：必须真实可访问；鼓励章节/课时/单集级深链；不确定则退真实主页，禁止编造；
   视频资源用 Bilibili（单集或系列页）。
 - 输出：严格 JSON（内嵌 schema），纯 JSON 无额外文本；temperature 0.4。
 - Pydantic 强校验；V2 预留用户背景占位（个性化）。
 
 ## 6. 错误处理与可观测性
 
 - LLM 异常统一收敛为领域错误 `LLMError`，路由层映射 502/404，不外吐内部栈。
 - Redis 不可用 → 降级「无缓存模式」：SSE 仍可当次流式生成；读路径返回 404（前端转重新生成）；打 warning 日志。
 - 进程重启后残留 `running` 任务视为 `error`（SSE 重连看到 error → 前端重新 generate，幂等）。
 - 结构化日志（JSON 行）：`task_id / keyword / cache_hit / llm_ms / tokens / status`。
 - 配置走 env：`LLM_API_KEY / LLM_BASE_URL / LLM_MODEL / REDIS_URL / CORS_ORIGINS`；`.env.example` 进仓库，`.env` 不进。
 
 ## 7. 页面与交互（前端）
 
 - 首页空态：一屏 = 居中大搜索框 + 一行说明 + 纯前端写死的示例词 chip（不触发请求）。工具型，无营销 hero。
 - 路线展示页：顶部 = 关键词标题 + 「重新生成」+ 「分享」（复制 URL）。
   主体 = React Flow 纵向分层路线图；节点卡片 = title + 一句话 + 资源数徽标；
   点击卡片 → 右侧 drawer 资源面板（资源：名称、类型 icon、链接、note）。
   底部 = 总时间预估汇总。
 - 生成中：React Flow 占位 loading 节点，phase 事件到达逐阶段点亮节点。
 - URL 形态：`/{keyword}`（编码），刷新/分享打开走读缓存路径，未生成自动转生成。
 - 错误态：SSE error → 「生成失败 + 重试」；断线 → 「连接中断 + 重连」（带 task_id 重放）。
 
 ## 8. 测试与验收标准
 
 - 后端（pytest）：
   - 归一化与缓存 key：「RAG」/「 rag 」同 key。
   - 缓存命中/未命中两路径；损坏缓存当未命中。
   - LLM 输出校验失败重试逻辑；`LLMError` → 502。
   - SSE 事件序列与断线重放（mock Redis）。
   - Redis 降级路径。
 - 前端（Vitest + React Testing Library，范围随风险）：
   - 路线 model 序列化/反序列化与 TS 类型一致性。
   - phase 事件驱动的 React Flow 节点增量渲染。
   - 空态/加载/错误/完成四态切换。
 - 端到端验收（手动清单）：
   1. 首次输入关键词 → SSE 逐阶段渲染 → 完成，路线图/ drawer / 时间汇总正常。
   2. 刷新或新标签打开分享链接 → 命中缓存秒回。
   3. 「重新生成」→ 覆盖缓存，结果更新。
   4. 断网重连 / 任务 90s 超时 → 错误态可重试恢复。
   5. `/api/health` 三字段正确。
   6. 抽 5 个关键词人工核验资源真实可达（重点 Bilibili 深链）。
 
 ## 9. 范围边界（YAGNI）
 
 - 不做：账户/收藏/进度追踪、社区贡献与审核、多 worker 横向扩展、资源服务端探活、
   个性化背景输入（prompt 已留占位）。以上均为 V2+。
