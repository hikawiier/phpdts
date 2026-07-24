# PHPDTS 浏览器运行时测试速查

> 适用于任何具备浏览器自动化能力的 AI 助手，不绑定具体智能体或浏览器工具。

## 1. 验收标准

视觉、布局、交互、动画，以及依赖玩家位置/迷雾/库存/战斗状态的功能，必须实际使用浏览器。静态分析只能提出假设。

结论至少包含四层证据：

- 玩家执行了什么操作
- 页面实际显示什么
- Pinia/调试总线如何变化
- HTTP 请求和响应是否符合契约

涉及写操作时，再用 State API 复核后端权威状态。缺少某层证据必须注明，不能用其他层代替。

### 主动补充调试桩

当现有 DOM、Console、Network、Pinia 或日志不足以区分多个假设时，AI 应主动创建调试桩，而不是继续猜测、缩减测试范围或用静态推断代替运行时证据。

优先在 API 请求/响应、store 状态变更、动画阶段、tick/command 边界补充结构化日志、DebugBus 事件、状态快照或受调试守卫保护的查询入口。桩子应使用任务唯一前缀，不改变业务门控、时序、事务或持久化语义，且不得输出凭据、Cookie 或完整私有数据。

测试结束后必须删除临时桩并搜索前缀确认零残留；具有跨任务价值的桩子应升格为 A-5 长期调试能力并同步文档。

## 2. 工具能力与环境

浏览器工具至少应支持：导航/视口、DOM 快照、唯一定位与交互、Console、Network、页面上下文求值、Screenshot。缺少的能力写入测试风险。

| 层 | 常用入口 |
| --- | --- |
| Apache/PHP | `http://127.0.0.1/phpdts/` |
| Vite 开发页 | `http://127.0.0.1:5174/` |
| 生产前端 | `http://127.0.0.1/phpdts/vex-vue/` |

Vite 默认请求 `5174`，端口占用时自动递增，以启动输出为准：

```powershell
cd D:\wamp64\www\phpdts\vex-vue
npm run dev
```

先分别访问：

```text
Apache: http://127.0.0.1/phpdts/oblivions/api/state.php?scope=player_info
Proxy:  http://127.0.0.1:5174/phpdts/oblivions/api/state.php?scope=player_info
```

- 两者失败：查 Apache、PHP、MySQL、游戏模式。
- Apache 成功、Proxy 失败：查 Vite 端口和 proxy。
- 两者成功、页面失败：查 Cookie、前端初始化和响应解析。

## 3. 四个项目特有陷阱

### 3.1 旧 Cookie 导致 401

`debug_autologin.php` 只在 Cookie 身份缺失时生效。旧 `acbra3_user` / `acbra3_pass` 会持续返回 `401 Unauthorized`。

只清理当前本地域的 PHPDTS Cookie 后重载；禁止记录 Cookie 值。`localhost` 与 `127.0.0.1` 是不同 Cookie 域，应固定一个 host。

### 3.2 前后端 `debug=all` 相互独立

```text
前端调试：/?debug=all
后端调试：state.php?scope=debug_gamevars&debug=all
```

页面参数不会自动传播到 API。后端调试请求缺参数时返回 `DEBUG_MODE_REQUIRED`。

### 3.3 三类 API 语义不同

| API | 方法 | 语义 |
| --- | --- | --- |
| `state.php?scope=...` | GET | 纯读，不推进 tick |
| `heartbeat.php` | POST | 服务端写入，推进 tick |
| `command.php` | POST JSON | 认证玩家写入 |

页面会后台请求 `heartbeat.php`、`player_info`，调试错误轮询还会请求 `obl_error`。不能把这些请求误认为某次点击触发。

常见信号：`401`=会话；`DEBUG_MODE_REQUIRED`=调试参数；短暂 `409 COMMAND_IN_PROGRESS`=房间锁竞争；非 JSON=PHP/代理错误优先。

### 3.4 竖屏遮罩拦截交互

桌面测试建议 `1280×720`。窄竖屏会显示 `ROTATE DEVICE / 请将设备旋转至横屏` 覆盖层；按钮存在但不可点击是设计门控。

## 4. 标准流程

1. 从玩家画面和操作路径定义预期。
2. 确认 Apache、MySQL、Vite 和实际端口。
3. 分别探活 Apache 与 Vite proxy。
4. 横屏打开 `?debug=all`，等待明确页面状态。
5. 评估观测是否充足；不足时先主动补调试桩，再保存操作前证据。
6. 检查场景前置条件；不成立就换场景。
7. 从最新 DOM 构造定位，交互前确认目标唯一。
8. 执行一次操作并记录时间窗。
9. 保存操作后画面、状态、网络；写操作再查 State API。
10. 分类故障，恢复视口，清理临时日志。

固定等待只能辅助过渡，不能作为完成判据。完成信号应是 DOM、store、请求或动画状态达到预期。

## 5. 最小前端状态快照

在页面主上下文执行；若看不到 `__vue_app__`，改用工具提供的主世界/开发者求值能力。

```js
(() => {
  const s = document.querySelector('#app')
    ?.__vue_app__?.config?.globalProperties?.$pinia?._s;
  const p = s?.get('player'), m = s?.get('map');
  const b = s?.get('battle'), d = s?.get('moveDirector');
  return {
    player: { pid: p?.playerInfo?.pid, action: p?.playerInfo?.action, error: p?.error },
    map: { region: m?.curRegion, pls: m?.curLoc, links: !!m?.links, error: m?.error },
    battle: { mode: b?.currentMode, playing: b?.isPlayingBattleLog, processing: b?.isProcessingBattle },
    move: { phase: d?.phase, playing: d?.isPlaying },
    debug: window.__phpdtsDebug?.state?.(),
  };
})()
```

初始化最低条件：player/map 无 error；pid、region、pls、links 存在；相关导演不在未结束的播放阶段。

`window.__phpdtsDebug` 提供 `events()`、`actorTimeline()`、`actorTimelineJson()`、`state()`。动画应检查 start/completed/cancelled 顺序，不能只看最终帧。

## 6. 场景前置条件

| 场景 | 操作前必须确认 |
| --- | --- |
| 页面初始化 | player/map 无 error；初始化 API 为 200 |
| 完整地图 | 按钮唯一；打开后有 Atlas、返回、玩家格、图例 |
| 移动/导航 | 当前格存在；目标可通行且已揭示；输入未锁；导演 idle |
| 战斗 | mode、回合归属、敌人、队列、按钮 enabled、演出空闲 |
| 背包/POI/合成 | 目标存在；槽位、itm0、能力、资源满足 |

不要用直接调用 store 方法代替 UI 验收；它只能用于隔离诊断。

## 7. 故障分类

| 证据 | 分类 |
| --- | --- |
| 端口未监听、Apache 直连失败 | 环境/后端启动 |
| Apache 200、Vite proxy 失败 | 代理 |
| 浏览器 401、新 HTTP 会话 200 | 浏览器会话 |
| 无目标、未轮到玩家、库存无空间 | 场景不成立 |
| 竖屏或 modal overlay | 交互被遮罩 |
| 短暂锁冲突后恢复 | 并发软冲突 |
| API 正确、store/画面错误 | 前端投影 |
| Command 失败且 State 未变 | 后端业务 |
| 浏览器工具调用失败 | 自动化工具，不等于产品失败 |

## 8. 最小报告

```markdown
场景：玩家要完成什么
环境：URL、viewport、当前工作区
前置：身份、player/map/battle、目标是否可执行
操作：唯一定位与实际动作
证据：画面；Console；Network；Pinia/DebugBus；必要时 State API
结论：通过 / 产品失败 / 场景不成立 / 环境或工具阻塞
风险：未覆盖状态或证据缺口
```

代码索引：`vex-vue/vite.config.js`、`vex-vue/src/api/{client,obl-command}.ts`、`vex-vue/src/utils/debug-flags.ts`、`vex-vue/src/composables/useDebugBus.ts`、`oblivions/api/{state,heartbeat,command}.php`、`oblivions/include/core/obl_debug.php`。

维护原则：只记录 PHPDTS 特有、经过浏览器复现、可跨工具复用的经验；具体工具调用方式由各工具自身说明负责。
