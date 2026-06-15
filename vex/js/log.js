// ══════════════════════════════════════════════════
// 游戏日志 / Chronicle log (ASCII 终端风)
// 事件驱动刷新（移除 setInterval 轮询）+ 日志标签解析
// ══════════════════════════════════════════════════

import { DebugBus } from './data.js';
import { gameApi } from './utils.js';
import { dataManager } from './data-manager.js';

// 日志标签推断规则：按关键词匹配，首个命中的标签生效
// 后端日志是 HTML 字符串（含 <span class="yellow"> 等），需先剥离标签再匹配
const TAG_RULES = [
    { tag: 'TRP', re: /陷阱|伤害|受伤|中毒|陷阱/ },
    { tag: 'MOV', re: /移动到了|从.{0,8}出发|进入了|离开了|转过头|回到了/ },
    { tag: 'SRC', re: /搜索了|获得了|触碰|搜索|翻找/ },
    { tag: 'FND', re: /发现了|找到了|看到|注意到|环顾/ },
    { tag: 'ENV', re: /散发着|堆积着|废弃|踩上去|气味|气息/ },
];

/**
 * 为单条日志（可能含 <br> 分隔多行）注入 [TAG] 前缀
 * 返回处理后的 HTML 字符串
 */
function annotateLogTags(logHtml) {
    if (!logHtml) return '';
    // 按 <br> 拆分成行，逐行处理
    const lines = logHtml.split(/<br\s*\/?>/i);
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === '') { out.push(line); continue; }
        // 剥离 HTML 标签得到纯文本用于关键词匹配
        const text = line.replace(/<[^>]+>/g, '');
        let tag = 'SYS';
        for (let j = 0; j < TAG_RULES.length; j++) {
            if (TAG_RULES[j].re.test(text)) { tag = TAG_RULES[j].tag; break; }
        }
        out.push('<span class="log-tag">[' + tag + ']</span>' + line);
    }
    return out.join('<br>');
}

export async function refreshLog() {
    const el = document.getElementById('logContent');
    if (!el) return;
    const result = await gameApi('game_log');
    if (result.status !== 'success') return;
    const rawLog = result.data.log || '';
    if (rawLog) {
        el.innerHTML = annotateLogTags(rawLog);
    } else {
        el.innerHTML = '<span class="grey">[SYS] 暂无日志</span>';
    }
    el.scrollTop = el.scrollHeight;
    DebugBus.emit('log', 'refreshLog:done', { logLength: rawLog.length });
}

// ─── 事件驱动刷新（替代 setInterval 轮询） ───
// 操作完成 / 地图加载后刷新日志
dataManager.listen('game:action-completed', function() { refreshLog(); });
dataManager.listen('map:loaded', function() { refreshLog(); });
