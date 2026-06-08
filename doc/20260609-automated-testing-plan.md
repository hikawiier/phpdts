# PHPDTS 自动化测试方案

> 为项目构建一套完整的自动化测试流程，使 agentsAI 能够自主运行项目代码，捕获和解析错误信息，并基于错误信息进行自主调试和问题定位。
>
> 生成日期：2026-06-09

---

## 一、项目现状评估

### 1.1 文档体系

| 文档 | 路径 | 质量评级 | 说明 |
|------|------|----------|------|
| AGENTS.md | 根目录 | A | AI编码助手指南，覆盖命名规范、文件结构、安全规则、核心概念 |
| CODEBASE.md | 根目录 | A | 代码库地图，完整覆盖请求生命周期、入口文件、模块分层、路由分发、配置系统 |
| GLOBALS.md | 根目录 | A | 全局变量词典，17个章节覆盖基础设施→玩家数据→战斗系统→clbpara→禁区函数 |
| include/STRUCTURE.md | include/ | A | 目录分层规则，A-H分类+判断规则+边界情况处理 |

**文档改进建议：**
- `doc/nouveau_250609/` 目录已标记过时，建议添加 `.deprecated` 标记或归档
- 缺少独立的 SQL Schema 文档
- `bot/` 和 `bothost/` 未纳入文档体系

### 1.2 代码结构

项目采用 **8层分层架构**：

```
[A] include/core/      基础设施层（4文件）
[B] include/db/         数据库层（6文件，多驱动支持）
[C] include/auth/       用户认证层（1文件）
[D] include/room/       房间容器层（2文件）
[E] include/gamectl/    游戏会话控制（9文件，状态机/重置/禁区/玩家管理）
[F] include/pregame/    游戏准备（2文件）
[G] include/game/       游戏内逻辑（62文件，战斗/物品/社团/事件/探索等）
[H] include/meta/       跨游戏结算（3文件）
```

**代码质量问题：**

| 问题 | 严重程度 | 说明 |
|------|----------|------|
| 全局状态污染 | 严重 | `extract()` 展开60+全局变量，函数内 `global` 声明泛滥 |
| SQL注入风险 | 中等 | 部分查询字符串字段未做转义（整型已用intval） |
| goto语句 | 低 | `bot/revbotservice.php` 使用goto进行循环控制 |
| 无结构化日志 | 中等 | 仅通过 `$log .=` 和 `$error` 传递错误 |
| 代码重复 | 中等 | `game.php`/`command.php` 前30行几乎相同 |
| 大型文件 | 中等 | `revattr.func.php`（战斗伤害核心）推测2000+行 |

### 1.3 现有测试与自动化基础设施

| 项目 | 状态 |
|------|------|
| 单元测试 | 无 |
| 集成测试 | 无 |
| E2E测试 | 无 |
| CI/CD | 无 |
| 静态分析 | 无（有`rector.php`但未集成） |
| 代码覆盖率 | 0% |

**可复用基础设施：**

- `bot/revbotservice.php` — PHP bot服务，支持oneshot模式（单次执行后退出）
- `bot/revbot.func.php` — Bot策略逻辑（移动/战斗/物品/升级决策）
- `bothost/main.py` — Python远程守护程序（HTTP调用+状态监控+错误收集），已具备：
  - 多worker并发执行
  - HTTP错误捕获（HTTPError/URLError）
  - 输出行解析与状态分类
  - PHP fatal error识别（`remote_php_error`状态）
  - 状态汇总报告
  - 优雅关闭（信号处理）

---

## 二、自动化测试总体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     agentsAI 测试驱动层                          │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │  test_runner │  │ error_parser  │  │  debug_orchestrator   │  │
│  │  (执行测试)  │  │ (解析错误)    │  │  (自主调试决策)       │  │
│  └──────┬──────┘  └──────┬───────┘  └───────────┬───────────┘  │
│         │                │                      │               │
├─────────┼────────────────┼──────────────────────┼───────────────┤
│         ▼                ▼                      ▼               │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              测试编排引擎 (test_harness.py)                │  │
│  │  - 测试套件管理   - 沙箱环境管理   - 结果聚合             │  │
│  └──────────────────────────┬───────────────────────────────┘  │
│                             │                                   │
├─────────────────────────────┼───────────────────────────────────┤
│                             ▼                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ 语法检查 │  │ 静态分析 │  │ 单元测试  │  │ 运行时验证   │  │
│  │ PHP lint │  │ PHPStan  │  │ PHPUnit  │  │ Bot模拟执行  │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────┘  │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              错误捕获与记录层                              │  │
│  │  ┌───────────┐  ┌───────────┐  ┌────────────────────┐   │  │
│  │  │ PHP错误   │  │ HTTP响应  │  │ 数据库状态快照     │   │  │
│  │  │ (E_ALL)   │  │ 状态码/体 │  │ (前后对比)         │   │  │
│  │  └───────────┘  └───────────┘  └────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 三、技术选型

| 层次 | 技术 | 选型理由 |
|------|------|----------|
| 语法检查 | `php -l` | 零依赖，PHP内置，逐文件检查 |
| 静态分析 | PHPStan Level 0→5 渐进式 | 支持PHP 7.0，渐进式采用，不强制重构 |
| 单元测试 | PHPUnit 8.x | PHP 7.0兼容的最新版本 |
| 数据库测试 | PHPUnit + DbUnit + SQLite in-memory | 避免污染开发/生产数据库 |
| HTTP集成测试 | Python `http.client` + `json` | 复用bothost已验证模式，无需额外框架 |
| Bot仿真测试 | 扩展 bothost/main.py | 已有输出解析+状态追踪能力 |
| 错误收集 | 自定义JSON日志 + 结构化存储 | 服务于agentsAI解析 |
| 沙箱环境 | Docker Compose（已有Dockerfile） | 隔离测试环境，快速重建 |
| 测试编排 | Python `unittest` + 自定义runner | 与bothost技术栈一致 |

---

## 四、分阶段实施计划

### Phase 1：基础设施搭建

**目标：** 建立语法检查和错误收集通道。

#### 目录结构

```
tests/
├── lint/                  # 语法检查结果缓存
├── unit/                  # PHPUnit 测试
├── integration/           # HTTP集成测试
├── fixtures/              # 测试固件（SQLite dump, 配置stub）
├── reports/               # 测试报告输出
├── bootstrap.php          # PHPUnit bootstrap（模拟 common.inc.php 最小环境）
├── test_harness.py        # 测试编排引擎
└── manifest.json          # 测试清单
```

#### 核心文件：tests/test_harness.py

统一错误记录结构和测试编排引擎。按阶段执行 test → 收集错误 → 生成结构化 JSON 报告。

关键数据结构：

- `TestError`: 统一错误记录（phase/severity/file/line/message/code_snippet/stack_trace/timestamp/context）
- `PhaseReport`: 阶段报告（total/passed/failed/errors/duration）
- `TestHarness`: 编排引擎（run_phase_lint / run_phase_static / run_phase_unit / run_phase_integration / run_phase_runtime）

实现代码详见本方案附录。

### Phase 2：语法检查 + 静态分析

**目标：** 建立代码质量基线。

```
Step 2.1: 安装 PHPStan
  composer require --dev phpstan/phpstan:^0.12  # PHP 7.0 兼容版本
  创建 phpstan.neon:
    parameters:
      level: 0
      paths: [., bot/]
      excludePaths: [include/deprecated/, *.old]

Step 2.2: 完成 test_harness.py Phase 1+2 实现

Step 2.3: 首次全面扫描，生成 baseline 错误清单
  python tests/test_harness.py --phase=lint,static --output=baseline.json
```

### Phase 3：单元测试框架

**目标：** 为核心可测试函数建立单元测试。

```
Step 3.1: 创建 tests/bootstrap.php
  模拟 common.inc.php 最小环境：
  - 定义 IN_GAME 常量
  - 创建 SQLite :memory: 数据库替代 MySQL
  - Mock config() 函数返回 fixture 路径

Step 3.2: 首批测试目标（按优先级）
  P0: 禁区系统函数（deatharea.func.php）——纯逻辑，无副作用
  P1: $gamedata 响应组装（router_helpers.php assemble_response）——关键路径
  P2: 骰子系统（dice.func.php）——纯计算
  P3: clbpara 操作函数（check_player_misc_states, get_clbpara）——数据完整性关键
```

**示例测试用例：**

```php
<?php
// tests/unit/DeathAreaTest.php
use PHPUnit\Framework\TestCase;

define('IN_GAME', true);
require_once __DIR__ . '/../bootstrap.php';
require_once GAME_ROOT . 'include/gamectl/deatharea.func.php';

class DeathAreaTest extends TestCase {
    protected function setUp(): void {
        global $arealist, $areanum;
        $arealist = [10, 20, 30, 40, 50];
        $areanum = 2;  // 前3个区域是禁区
    }

    public function testIsDeathArea(): void {
        $this->assertTrue(is_death_area(10));
        $this->assertTrue(is_death_area(30));
        $this->assertFalse(is_death_area(40));  // 尚未到达
        $this->assertFalse(is_death_area(99));  // 不存在
    }

    public function testGetDeathAreas(): void {
        $areas = get_death_areas();
        $this->assertEquals([10, 20, 30], $areas);
    }

    public function testIsSafeArea(): void {
        global $hack;
        $this->assertFalse(is_safe_area(10));   // 禁区
        $this->assertTrue(is_safe_area(40));    // 不仅禁

        $hack = 1;
        $this->assertTrue(is_safe_area(10));    // hack激活后安全
    }
}
```

### Phase 4：集成测试 + 运行时验证

**目标：** 实现关键功能路径的端到端验证。

#### 沙箱环境

```bash
# 已有 Dockerfile + docker-compose.yml
docker-compose up -d  # 启动 php-fpm + nginx + mysql

# 初始化测试数据库
mysql -h localhost < gamedata/sql/all.sql
php install.php --auto
```

#### 关键路径测试清单

| 测试路径 | 验证要点 |
|----------|----------|
| index.php 加载 | 200响应、房间列表非空 |
| 注册流程 | register.php → 创建用户成功 |
| 登录+入场 | login → valid.php → 选择社团+称号 |
| 游戏启动 | 状态机 0→10 转换 |
| 核心指令执行 | move/search/itemuse/rest 返回非空 |
| 战斗流程 | revcombat 流程完整执行 |
| 物品合成 | itemmix 合成产生预期物品 |
| 任务接受 | quest_accept 状态变更 |
| 游戏结束 | 状态机 30→结束 积分结算 |
| RuleSet 兼容 | YELLOWKNIFE 房间可正常运行 |

#### 运行时错误捕获增强

扩展 bothost 的输出解析能力：

- 解析 PHP Notice/Warning/Error 行
- 捕获 AJAX 响应中的 error 字段
- 捕获 gamedata.innerHTML.error 字段
- 捕获 HTTP 5xx 状态码 + body

### Phase 5：agentsAI 自主调试能力

**目标：** 使 agentsAI 能够基于错误信息自主定位和修复问题。

#### 错误分类与路由

| 错误类型 | agentsAI 行动策略 |
|----------|-------------------|
| PHP Parse error | 读取出错文件 → 定位行号 → 修复语法 |
| PHP Fatal error | 解析堆栈 → 追踪调用链 → 修复逻辑 |
| PHP Warning | 定位变量/函数 → 添加定义或条件判断 |
| SQL error | 定位查询 → 检查字段拼写/参数类型 |
| HTTP 500 | 解析error信息 → 按以上分类处理 |
| HTTP 4xx | 检查URL/参数/认证 |
| 逻辑错误（预期不符） | 对比实际输出 vs 预期 → 定位业务逻辑 |
| 超时 | 检查死循环/长查询/DB连接 |

#### 自主修复循环

```
while True:
    report = harness.run_all()
    if report["summary"]["overall"] == "PASS":
        break
    for error in report["errors"]:
        context = collector.collect(error)
        fix = agentsAI.generate_fix(error, context)
        if fix.confidence > 0.8:
            apply_fix(fix)
        else:
            log_for_human_review(error, context)
```

---

## 五、错误捕获与处理机制

### 5.1 六层错误捕获网

```
Layer 1: PHP lint (语法层)     → php -l 逐文件检查
Layer 2: PHPStan (静态分析)    → 类型错误、未定义变量/函数
Layer 3: PHPUnit (单元测试)    → 函数级正确性
Layer 4: HTTP响应 (集成测试)   → gamedata.error / HTTP状态码
Layer 5: Bot运行时 (动态验证)  → PHP运行时错误 + 逻辑异常
Layer 6: 数据库完整性 (数据层) → 约束违反、数据不一致
```

### 5.2 错误记录格式（JSON Schema）

```json
{
  "$schema": "phdts-error-record/v1",
  "id": "err_20250609_001",
  "phase": "runtime",
  "severity": "error",
  "file": "include/game/combat/revattr.func.php",
  "line": 847,
  "message": "Undefined variable: pa_ex_damage",
  "code_snippet": "$total = $pa_damage + $pa_ex_damage;",
  "stack_trace": [
    {"file": "include/game/combat/revcombat.func.php", "line": 312, "call": "calc_revattr()"},
    {"file": "command.php", "line": 68, "call": "revcombat_prepare()"}
  ],
  "context": {
    "http_method": "POST",
    "http_url": "/command.php",
    "mode": "revcombat",
    "game_state": 20,
    "db_state": {"players.count": 23},
    "bot_action": "attack"
  },
  "timestamp": "2026-06-09T12:34:56+08:00"
}
```

### 5.3 调试策略

| 场景 | 策略 | agentsAI动作 |
|------|------|-------------|
| 语法错误 | 直接修复 | 读取文件→定位行→Rewrite→重新lint |
| 未定义变量 | 上下文分析 | 搜索最近的`global`声明→追踪extract→添加默认值或global |
| SQL错误 | Schema验证 | 读all.sql→对比字段名→修正查询或添加迁移 |
| 逻辑错误 | 对比验证 | 添加临时var_dump→重新执行→对比预期值→修正 |
| 死循环/超时 | 二分定位 | 在可疑循环中插入`if(++$i>N)break;`→缩小范围 |
| 配置缺失 | 追踪config() | 查RuleSet覆盖链→确认缓存文件存在→生成或复制 |

---

## 六、预期成果评估标准

| 指标 | 当前值 | Phase 2 | Phase 3 | Phase 4 | Phase 5 |
|------|--------|---------|---------|---------|---------|
| PHP语法检查覆盖 | 0% | 100% | 100% | 100% | 100% |
| 静态分析Level | — | 0 | 1 | 2 | 3 |
| 单元测试覆盖 | 0% | 0% | 5% | 8% | 10% |
| 关键路径覆盖 | 0 | 0 | 0 | 12 | 12 |
| 错误可自动修复率 | — | — | — | 30% | 60% |
| 回归测试时间 | 无 | <30s | <1min | <3min | <5min |

> 覆盖率为渐进式目标。PHPDTS作为遗留PHP项目，大量代码强依赖数据库和全局状态，无法在短期内实现高覆盖率。核心策略是优先覆盖纯函数模块（禁区/骰子/clbpara操作）和关键业务路径。

---

## 七、实施优先级总结

### 立即执行（Week 1）

1. 创建 `tests/` 目录和 `test_harness.py`
2. 实现 Phase 1（PHP lint 全量扫描）
3. 生成首次基线报告

### 短期（Week 2-3）

4. 实现 Phase 2（PHPStan Level 0）
5. 搭建 Docker 沙箱环境
6. 实现 Phase 4 集成测试（HTTP路径验证）

### 中期（Week 4-5）

7. 实现 Phase 3 单元测试（deatharea/dice/clbpara）
8. 实现 Phase 5 错误分类与自主修复循环
9. 集成到 agentsAI 工作流

### 长期维护

10. 渐进提升代码覆盖率
11. PHPStan Level 逐步升级
12. 关键模块重构（抽取纯函数以提升可测试性）

---

## 附录：test_harness.py 参考实现

```python
#!/usr/bin/env python3
"""
PHPDTS 测试编排引擎 (test_harness.py)
按阶段执行测试，收集错误，生成结构化报告。
"""

import subprocess
import json
import time
import re
from pathlib import Path
from dataclasses import dataclass, field, asdict
from typing import Optional
from datetime import datetime
from enum import Enum


class Severity(Enum):
    FATAL = "fatal"     # 语法错误、无法继续
    ERROR = "error"     # 测试失败
    WARNING = "warning" # 静态分析警告
    INFO = "info"       # 信息记录


@dataclass
class TestError:
    """统一错误记录结构"""
    phase: str
    severity: Severity
    file: str
    line: Optional[int]
    message: str
    code_snippet: str
    stack_trace: str
    timestamp: str
    context: dict = field(default_factory=dict)


@dataclass
class PhaseReport:
    phase: str
    total: int
    passed: int
    failed: int
    errors: list          # list[TestError]
    duration_sec: float
    details: dict = field(default_factory=dict)


class TestHarness:
    """测试编排引擎"""

    def __init__(self, project_root: str, php_bin: str = "php"):
        self.root = Path(project_root)
        self.php = php_bin
        self.reports: list[PhaseReport] = []
        self.start_time = time.time()

    def run_phase_lint(self) -> PhaseReport:
        """Phase 1: PHP 语法检查（所有 .php 文件）"""
        start = time.time()
        errors = []
        total, passed, failed = 0, 0, 0

        for php_file in self.root.rglob("*.php"):
            if "deprecated" in str(php_file) or ".old" in php_file.suffix:
                continue
            total += 1
            result = subprocess.run(
                [self.php, "-l", str(php_file)],
                capture_output=True, text=True, timeout=10
            )
            if result.returncode == 0:
                passed += 1
            else:
                failed += 1
                errors.append(self._parse_lint_error(result.stderr, php_file))

        return PhaseReport("lint", total, passed, failed, errors,
                          round(time.time() - start, 2))

    def _parse_lint_error(self, stderr: str, file: Path) -> TestError:
        m = re.search(r"on line (\d+)", stderr)
        line = int(m.group(1)) if m else None
        return TestError(
            phase="lint", severity=Severity.FATAL,
            file=str(file), line=line,
            message=stderr.strip(),
            code_snippet=self._read_line(file, line) if line else "",
            stack_trace="", timestamp=datetime.now().isoformat()
        )

    def run_phase_static(self) -> PhaseReport:
        """Phase 2: 静态分析（PHPStan Level 0）"""
        pass

    def run_phase_unit(self) -> PhaseReport:
        """Phase 3: 单元测试（PHPUnit）"""
        pass

    def run_phase_integration(self, base_url: str = "http://localhost:8080") -> PhaseReport:
        """Phase 4: HTTP 集成测试"""
        pass

    def run_phase_runtime(self, base_url: str = "http://localhost:8080") -> PhaseReport:
        """Phase 5: 运行时验证（Bot 模拟执行 + 错误捕获）"""
        pass

    def run_all(self, base_url: str = None) -> dict:
        phases = [
            self.run_phase_lint,
            self.run_phase_static,
            self.run_phase_unit,
            lambda: self.run_phase_integration(base_url),
            lambda: self.run_phase_runtime(base_url),
        ]
        for fn in phases:
            report = fn()
            self.reports.append(report)
        return self.aggregate()

    def aggregate(self) -> dict:
        return {
            "project": self.root.name,
            "timestamp": datetime.now().isoformat(),
            "total_duration_sec": round(time.time() - self.start_time, 2),
            "phases": [asdict(r) for r in self.reports],
            "summary": {
                "total_errors": sum(r.failed for r in self.reports),
                "total_passed": sum(r.passed for r in self.reports),
                "overall": "PASS" if all(r.failed == 0 for r in self.reports) else "FAIL"
            }
        }

    def _read_line(self, file: Path, line: int) -> str:
        try:
            lines = file.read_text(encoding="utf-8", errors="ignore").splitlines()
            return lines[line - 1].strip() if line <= len(lines) else ""
        except Exception:
            return ""
```