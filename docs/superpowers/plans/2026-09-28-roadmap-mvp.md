# Roadmap MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 单仓库实现关键词学习路线 MVP：React+Vite 前端（React Flow 展示）+ FastAPI 后端（LLM 逐阶段生成、Redis 缓存、SSE 流式事件、静态托管 dist/）。

**Architecture:** 前端两个页面状态（空态搜索 / 路线展示），URL `/{keyword}`；后端三个接口（读缓存 GET、启动生成 POST、SSE events）+ /api/health，进程内 asyncio 任务队列 + Redis 存任务状态与缓存，LLM 走 OpenAI 兼容接口逐阶段生成。

**Tech Stack:** React 18 + Vite + TypeScript + React Flow (@xyflow/react)、FastAPI + Pydantic + httpx + redis.asyncio、pytest + pytest-asyncio、Vitest + React Testing Library。

**Spec:** `docs/superpowers/specs/2026-09-28-keyword-learning-roadmap-design.md`（本仓库根下）

## Global Constraints

- 单仓库目录结构：`frontend/`、`backend/`、`docker-compose.yml`、`.env.example`、`README.md`（spec 第 2 节原样）。
- 关键词归一化 = 小写 + 去首尾 + 空格压缩；缓存 key `roadmap:{norm}`、任务 key `task:{norm}`；缓存 TTL 7 天；LLM 单段超时 60s，整任务 90s；LLM temperature 0.4（重试 0.2）。
- 资源 `type` 枚举：`bilibili | doc | book | course | project`；真实性优先、深链尽力、不确定退主页。
- 阶段数自适应（简单 4-6，复杂可到 6-8），每阶段 topics 3-6，每 topic 资源 2-4。
- 响应约定：成功返回 Roadmap 本体；失败 `{ "error": str, "retryable": bool }`；keyword 空/空白前端拦截，>100 字符 422。
- 配置 env：`LLM_API_KEY / LLM_BASE_URL / LLM_MODEL / REDIS_URL / CORS_ORIGINS`；`.env` 不进 git。
- 不做：多 worker、账户/收藏、资源探活、个性化（spec 第 9 节 YAGNI）。
- 仓库当前不是常规多文件项目：`docs/` 下 spec 尚未提交，Task 0 先提交它。

## Review Focus

- 归一化一致性：`RAG`/` rag `/`rag x` 的缓存 key 必须稳定——测试钉在 Task 2。
- LLM 输出带 markdown 围栏或非 JSON：generator 需剥离并校验失败重试——测试钉在 Task 5。
- SSE 断线重放：重连带 task_id 必须补发已存 phase 且幂等（重复 phase 不重复渲染）——测试钉在 Task 7，前端去重钉在 Task 11。
- Redis 降级：无 Redis 时生成仍可当次流式出结果、读路径 404——测试钉在 Task 8。
- 前端对 404 `not_generated` 静默转生成、对 5xx 显示可重试错误且 loading 不闪白屏——测试钉在 Task 12。

---

### Task 0: 提交 spec 并搭后端/前端骨架

**Files:**
- Commit: `docs/`（spec 文件）
- Create: `backend/app/__init__.py`、`backend/app/main.py`、`backend/requirements.txt`、`backend/tests/__init__.py`、`backend/pytest.ini`
- Create: `frontend/`（Vite react-ts 模板脚手架，只留骨架，页面在 Task 9-13 实现）
- Create: `docker-compose.yml`、`.env.example`

**Interfaces:**
- Produces: `backend.app.main.app`（FastAPI 实例，后续任务向其加路由）；`GET /api/health` 返回 `{"redis":"down"|"ok","llm_key":"configured"|"missing","tasks_in_flight":0}`；前端 dev 代理 `/api` → `:8000`（vite.config.ts）。

- [ ] **Step 1: 提交 spec**

```bash
git add docs
git commit -m "docs: add keyword roadmap MVP design spec"
```

- [ ] **Step 2: 后端骨架**

`backend/requirements.txt`：`fastapi`、`uvicorn`、`httpx`、`redis`、`pydantic`、`python-dotenv`；测试另加 `pytest`、`pytest-asyncio`、`respx`（httpx mock）。
`backend/app/main.py`：创建 FastAPI（`title="Roadmap API"`），CORS 读 `CORS_ORIGINS`（逗号分隔，默认 `*`），实现 `GET /api/health`：
`redis` 字段 = 用 `redis.asyncio` 连 `REDIS_URL` 后 `ping()` 成功为 `"ok"` 否则 `"down"`（连接异常捕获）；`llm_key` = `LLM_API_KEY` 非空为 `"configured"`；`tasks_in_flight` 先返回 0（Task 6 接入真实计数）。

- [ ] **Step 3: 前端骨架 + compose + env 模板**

`frontend/` 用 `npm create vite@latest frontend -- --template react-ts` 生成，安装 `@xyflow/react`；`vite.config.ts` 加 server.proxy：`/api` → `http://localhost:8000`。
`docker-compose.yml`：service `redis`（`redis:7`，端口 6379）。
`.env.example`：五个 spec 变量，`REDIS_URL=redis://localhost:6379/0`。

- [ ] **Step 4: 验证**

Run: `cd backend && pip install -r requirements.txt -r requirements-dev.txt(可选合并) && uvicorn app.main:app & curl -s localhost:8000/api/health`
Expected: JSON 三字段存在，`redis` 为 `ok`（compose 起 redis 时）。
Run: `cd frontend && npm install && npm run build`
Expected: build 成功（骨架空壳）。

- [ ] **Step 5: Commit**

```bash
git add backend frontend docker-compose.yml .env.example
git commit -m "chore: scaffold backend/frontend skeletons, redis compose, env template"
```

### Task 1: 路线数据模型与关键词归一化

**Files:**
- Create: `backend/app/models.py`、`backend/app/keywords.py`
- Test: `backend/tests/test_models.py`、`backend/tests/test_keywords.py`

**Interfaces:**
- Produces: `Roadmap / Phase / Topic / Resource`（Pydantic，字段与 spec 第 3 节逐字一致）；`ResourceType = Literal["bilibili","doc","book","course","project"]`；`normalize_keyword(raw: str) -> str`（小写+strip+空格压缩；全空白输入返回空串）。

- [ ] **Step 1: 失败测试**

```python
def test_roadmap_full_shape():
    r = Roadmap(keyword="rag", title="t", summary="s", total_duration_hint="1 年",
                phases=[Phase(id="p1", name="基础", order=1, topics=[
                    Topic(id="p1t1", phase_id="p1", title="向量检索",
                          description="d", duration_hint="2 周",
                          resources=[Resource(title="b", url="https://b23.tv/x", type="bilibili")])])])
    assert r.model_dump_json()  # 可序列化

def test_normalize():
    assert normalize_keyword(" RAG  x ") == "rag x"
    assert normalize_keyword("   ") == ""
```

- [ ] **Step 2: 跑测试确认失败**（ImportError）

- [ ] **Step 3: 实现 models.py（spec 第 3 节结构）与 keywords.py（`" ".join(s.lower().split())`）**

- [ ] **Step 4: 跑测试通过；Commit `feat: roadmap pydantic models + keyword normalization`**

### Task 2: Redis 缓存服务（含降级）

**Files:**
- Create: `backend/app/services/__init__.py`、`backend/app/services/cache.py`
- Test: `backend/tests/test_cache.py`

**Interfaces:**
- Consumes: `Roadmap`、`normalize_keyword`、env `REDIS_URL`。
- Produces: `CacheService`（async）：`get(norm_keyword) -> Roadmap | None`（损坏 JSON 当 None 不抛）；`set(norm_keyword, roadmap) -> None`（TTL 604800s）；`available: bool`（最近一次 ping 结果，供 health/降级判断）。实现用 `redis.asyncio`，连接失败把 `available` 置 False 且 get/set 静默 no-op 返回 None（降级不抛，spec 第 6 节）。

- [ ] **Step 1: 失败测试（fakeredis 或 mock redis 客户端）**：get/set 往返；损坏值返回 None；连接异常时 set 不抛且 available=False。
- [ ] **Step 2: 跑失败**
- [ ] **Step 3: 实现**：CacheService 构造接受 `redis_url` 与可选注入 client（测试注入 mock）；`set` 写 `roadmap:{norm}`；`get` 反序列化 `Roadmap.model_validate_json`，失败记 warning 日志返回 None。
- [ ] **Step 4: 通过；Commit `feat: roadmap redis cache with graceful degradation`**

### Task 3: 提示词模块

**Files:**
- Create: `backend/app/prompts.py`
- Test: `backend/tests/test_prompts.py`

**Interfaces:**
- Produces: `SYSTEM_PROMPT: str`（spec 第 5 节全部约束写死在文本里：专家级终点、阶段自适应 4-8、每阶段 topics 3-6、每 topic 资源 2-4、资源真实性>深链、bilibili 优先、输出纯 JSON 内嵌 Roadmap schema）；`phase_user_prompt(norm_keyword, previous_phases_json: list[dict]) -> str`（注入 keyword + 已生成阶段 JSON，要求续写下一阶段严格 JSON）。

- [ ] **Step 1: 测试**：SYSTEM_PROMPT 含 `"bilibili"`、`"专家"` 字样且以 JSON schema 文本结尾；`phase_user_prompt` 输出包含 keyword 与 previous_phases 内容。
- [ ] **Step 2: 跑失败**
- [ ] **Step 3: 写提示词**（schema 用 models.py 的 `Roadmap.model_json_schema()` 动态嵌入，保持单一事实源）。
- [ ] **Step 4: 通过；Commit `feat: generation prompts with embedded JSON schema`**

### Task 4: LLM 客户端与逐阶段生成器

**Files:**
- Create: `backend/app/services/generator.py`
- Test: `backend/tests/test_generator.py`

**Interfaces:**
- Consumes: `prompts.*`、`Roadmap` 模型、env `LLM_API_KEY/LLM_BASE_URL/LLM_MODEL`。
- Produces: `LLMError(Exception)`；`LLMClient.complete_json(system: str, user: str, temperature: float = 0.4, timeout: float = 60.0) -> dict`（httpx 调 OpenAI 兼容 `/chat/completions`，`response_format={"type":"json_object"}`；响应文本剥掉可能的 ```json 围栏后 `json.loads`，失败抛 `LLMError`）；`generate_phases(client, norm_keyword) -> AsyncIterator[tuple[Phase, int, int]]`（先问 LLM 本路线共 N 阶段与阶段名列表，再逐阶段调 LLM 生成该阶段 topics/resources，每段 Pydantic 校验，失败同段重试 1 次 temperature=0.2，仍失败 raise `LLMError`；yield `(phase, idx, total)`）。

- [ ] **Step 1: 失败测试（respx mock httpx）**：正常多阶段流；markdown 围栏剥除；单段坏 JSON 重试一次后抛 LLMError；超时 60s 生效（设小超时断言）。
- [ ] **Step 2: 跑失败**
- [ ] **Step 3: 实现**：httpx.AsyncClient 封装；`generate_phases` 内部先调一次「阶段规划」请求拿 N 与阶段名（也走 JSON 校验）。
- [ ] **Step 4: 通过；Commit `feat: LLM client and per-phase roadmap generator`**

### Task 5: 任务队列与 SSE 事件端点

**Files:**
- Create: `backend/app/services/tasks.py`、`backend/app/routes/__init__.py`、`backend/app/routes/roadmaps.py`
- Modify: `backend/app/main.py`（挂 `roadmaps` 路由；`/api/health` 的 `tasks_in_flight` 改接真实计数）
- Test: `backend/tests/test_tasks.py`、`backend/tests/test_roadmaps_api.py`

**Interfaces:**
- Consumes: `CacheService`、`generate_phases`、`LLMClient`、`normalize_keyword`、`Roadmap`。
- Produces: `TaskRegistry`：`register(norm) -> task_id`（同 norm 进行中直接复用，spec 去重）、`mark_done/mark_error`、状态与已完成 phase 写 Redis `task:{norm}`（`running|done|error` + phases JSON）；Redis 不可用时任务仅内存可跑（当次流式可用，spec 降级）；`in_flight() -> int`。
  路由（`/api/roadmaps`）：
  - `GET /{keyword}`：归一化；空串 422；`len>100` 422；缓存命中 200 返回 Roadmap 本体；未命中 404 `{"error":"not_generated","retryable":true}`。
  - `POST /{keyword}/generate`（query `force: bool = False`）：
    - 非 force 且缓存命中 → 返回 `200` 直接给 Roadmap 本体（前端拿到结果，无需 SSE；`event_stream` 为 null）。
    - 非 force 且同 keyword 有进行中任务 → 复用该 task_id 返回 `202`（spec 去重，不重复花 LLM 钱）。
    - 否则（未缓存无任务，或 force=1）→ 注册新任务，后台跑 `generate_phases`，逐 phase `registry.push_phase(task_id, phase)`；完成写缓存 + `mark_done`；`LLMError`/90s 超时 → `mark_error`。立即返回 `202 {"task_id","event_stream":"/api/roadmaps/{kw}/events?task_id=..."}`。
  - `GET /{keyword}/events`（query `task_id`）：SSE（`text/event-stream`）；先重放 Redis 中该 task 已存 phase（`event: phase`，data=phase JSON），再订阅注册表新 phase（asyncio 队列）；`done` 事件带完整 Roadmap；`error` 事件带 `{"error","retryable":true}` 后关流。

- [ ] **Step 1: 失败测试（httpx.AsyncClient + ASGITransport 打 FastAPI，mock LLMClient/Redis）**：
  - 缓存命中/未命中 404 两条；
  - generate 返回 202 且同 keyword 二次 generate 复用 task_id；
  - SSE 事件序列 `phase,phase,done`；断线重连（二次 GET events 带 task_id）重放已有 phase 后再接新事件；
  - force=1 绕过缓存；90s 超时（注入小超时）触发 error 事件。
- [ ] **Step 2: 跑失败**
- [ ] **Step 3: 实现**（SSE 用 `StreamingResponse` + `asyncio.Queue`；每事件 `f"event: {name}\ndata: {json}\n\n"`）。
- [ ] **Step 4: 通过；Commit `feat: task registry + SSE roadmap generation endpoints`**

### Task 6: health 接入真实任务计数 + 前端共享类型

**Files:**
- Modify: `backend/app/main.py`（health 用 `TaskRegistry.in_flight()`）
- Create: `frontend/src/types/roadmap.ts`（与 spec 第 3 节逐字段镜像的 TS 类型 + 事件类型 `PhaseEvent/DoneEvent/ErrorEvent` + 归一化函数 `normalizeKeyword` 与后端同规则）
- Test: `backend/tests/test_health.py`（in_flight 计数随任务增删）；`frontend/src/types/__tests__/roadmap.test.ts`（normalizeKeyword 同值断言、事件类型可实例化）

- [ ] **Step 1-4: TDD 常规节奏；Commit `feat: live health task count + shared frontend types`**

### Task 7: 前端 API 层（读缓存 + 生成 + SSE 客户端）

**Files:**
- Create: `frontend/src/api/roadmaps.ts`
- Test: `frontend/src/api/__tests__/roadmaps.test.ts`

**Interfaces:**
- Consumes: Task 6 类型。
- Produces: `fetchRoadmap(keyword): Promise<Roadmap>`（404 抛 `NotGeneratedError`）；`startGeneration(keyword, force=false): Promise<{taskId, eventStream}>`；`subscribeRoadmapEvents(keyword, taskId, onPhase, onDone, onError): () => void`（EventSource 封装，返回 unsubscribe；phase 回调带幂等标记——同 phase_id 二次回调时前端渲染层去重，spec Review Focus）。

- [ ] **Step 1: 失败测试（fetch mock）**：404 转 NotGeneratedError；SSE 事件解析（含断线重连参数透传）。
- [ ] **Step 2-4: 实现；Commit `feat: frontend api layer with SSE client`**

### Task 8: 前端路线图渲染（React Flow 纵向分层）

**Files:**
- Create: `frontend/src/components/RoadmapFlow.tsx`、`frontend/src/components/TopicNode.tsx`（自定义节点卡片：title+description+资源数徽标）、`frontend/src/components/ResourceDrawer.tsx`（右侧 drawer：资源列表，类型 icon + 外链）
- Modify: `frontend/src/App.tsx`（接线：phases 状态 → 节点/边）
- Test: `frontend/src/components/__tests__/RoadmapFlow.test.tsx`

**Interfaces:**
- Consumes: Task 6 类型、Task 7 API。
- Produces: `<RoadmapFlow phases={PartialPhase[]} generating={bool} onTopicClick={(topic)=>void} />`——纵向分层布局（phase 自上而下，同 phase topics 横排，同 phase 内 link 串联、跨 phase link 连接，spec 第 2 节），`generating` 时当前未完成 phase 尾部放 loading 占位节点；`<ResourceDrawer topic={Topic|null} onClose/>`。

- [ ] **Step 1: 失败测试**：给定 2 phase 3 topic，渲染出 3 节点 + 正确边；phase 只到一半且 generating=true 时出现 loading 节点；点击 topic 触发 onTopicClick 带全量 topic（含 resources）。
- [ ] **Step 2: 跑失败**
- [ ] **Step 3: 实现**（布局算法：phase i 的 y = i * phaseHeight；同 phase topics x 均布；minimap+controls 开启；节点尺寸固定防 hover 抖动）。
- [ ] **Step 4: 通过；Commit `feat: vertical React Flow roadmap rendering`**

### Task 9: 首页空态（搜索框 + 示例 chip）

**Files:**
- Modify: `frontend/src/App.tsx`、Create `frontend/src/components/SearchHome.tsx`
- Test: `frontend/src/components/__tests__/SearchHome.test.tsx`

**Interfaces:**
- Produces: `<SearchHome onSearch={(kw)=>void} />`——居中大输入框（工具型非 hero）+ 写死示例词 chip（`["前端开发","RAG","吉他","健身"]`，点击等价输入提交）+ 一行说明文案；空白/纯空格回车不触发 onSearch（spec 拦截点）。

- [ ] **Step 1: 失败测试**：输入提交调 onSearch(归一化后)；空白提交不调用；chip 点击提交对应词。
- [ ] **Step 2-4: 实现；Commit `feat: home search empty state`**

### Task 10: 路线展示页（生成流式 + 顶部工具栏 + 分享 + 时间汇总）

**Files:**
- Modify: `frontend/src/App.tsx`、Create `frontend/src/components/RoadmapView.tsx`
- Test: `frontend/src/components/__tests__/RoadmapView.test.tsx`

**Interfaces:**
- Consumes: Task 7/8/9。
- Produces: 路由 `/:keyword`（react-router，URL 编码）；进入流程：`fetchRoadmap` → 命中渲染；`NotGeneratedError` → `startGeneration` + `subscribeRoadmapEvents`，phase 事件增量喂 `RoadmapFlow`（幂等去重），done 补全 + 底部总时间汇总（`total_duration_hint`）；顶部工具栏：关键词标题 + 「重新生成」（`startGeneration(force=true)`）+ 「分享」（`navigator.clipboard.writeText(location.href)` 成功显示 toast）。SSE error → 错误卡片 + 重试按钮（重走 generate）。

- [ ] **Step 1: 失败测试（mock api 层）**：缓存命中直出；404→生成→逐 phase 渲染→done 汇总；error 出现重试按钮且点击重发 generate(force)。
- [ ] **Step 2: 跑失败**
- [ ] **Step 3: 实现**
- [ ] **Step 4: 通过；Commit `feat: roadmap view with streaming generation and share`**

### Task 11: 错误态/断线重连 UX

**Files:**
- Modify: `frontend/src/components/RoadmapView.tsx`
- Test: 追加到 `RoadmapView.test.tsx`

- [ ] **Step 1: 失败测试**：EventSource 断开重连（带 task_id）后已生成 phase 不重复渲染（去重生效）；5xx（非 404）显示「生成失败 + 重试」且 loading 骨架保持不闪白屏。
- [ ] **Step 2-4: 实现；Commit `feat: reconnect and error states without flicker`**

### Task 12: 静态托管与部署形态

**Files:**
- Modify: `backend/app/main.py`（`/` 与 SPA fallback 静态托管 `../frontend/dist`，`/api` 优先；dist 不存在时只保留 API 不报错）
- Create: `Dockerfile`（python slim + 装依赖 + 复制 frontend dist + uvicorn 单进程）、`README.md`（开发/部署/运行说明 + 验收清单 spec 第 8 节）
- Test: `backend/tests/test_static.py`（dist 存在时 GET / 返回 index.html；/api/health 仍可达）

- [ ] **Step 1: 失败测试**
- [ ] **Step 2-4: 实现；Commit `feat: static hosting + single-container deployment`**

### Task 13: 端到端验收（spec 第 8 节清单）

- [ ] **Step 1:** `docker compose up redis` + 后端 + 前端 dev，跑通验收 1-5（spec 原文清单）。
- [ ] **Step 2:** 抽 5 个关键词（建议：前端开发 / RAG / 吉他 / 健身 / 产品经理）人工核验资源真实可达（重点 Bilibili 深链），把结果记进 README 验收记录。
- [ ] **Step 3:** 全量 `pytest` + `npm test` 绿；Commit `chore: e2e acceptance verification notes`（如有代码修复则先单独提交）。
