// ══════════════════════════════════════════════════
// Toast 位置管理 / Toast position manager
//
// 集中管理 Toast 容器的动态定位，避免 log.js / tile-action.js /
// app.js / player.js 之间的循环依赖。
//
// 规则：
//   - 无 2 级页面 / 左抽屉开 → 右上角（默认）
//   - 右抽屉开 → 左上角（.pos-left，避免被抽屉遮挡）
//   - 模态框开 → 中上（.pos-center，避免被模态框遮挡）
//   优先级：模态框 > 右抽屉 > 左抽屉/默认
// ══════════════════════════════════════════════════

/**
 * 检测是否有 2 级页面（模态框/抽屉）打开
 * 2 级页面打开时日志区被遮罩遮挡，需要 Toast 即时反馈
 * @returns {boolean}
 */
export function isAnyOverlayOpen() {
    const modal = document.getElementById('modalOverlay');
    const invDrawer = document.getElementById('invDrawerOverlay');
    const drawer = document.getElementById('drawerOverlay');
    return (modal && modal.classList.contains('open')) ||
           (invDrawer && invDrawer.classList.contains('open')) ||
           (drawer && drawer.classList.contains('open'));
}

/**
 * 根据当前打开的 2 级页面，更新 Toast 容器位置
 * 优先级：模态框 > 右抽屉 > 左抽屉/默认
 *
 * 应在 openModal/closeModal/openInvDrawer/closeInvDrawer/
 * toggleDrawer/closeDrawer 等函数末尾调用。
 */
export function updateToastPosition() {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    container.classList.remove('pos-left', 'pos-center');

    const modal = document.getElementById('modalOverlay');
    const invDrawer = document.getElementById('invDrawerOverlay');

    if (modal && modal.classList.contains('open')) {
        // 模态框开：中上
        container.classList.add('pos-center');
    } else if (invDrawer && invDrawer.classList.contains('open')) {
        // 右抽屉开：左上角
        container.classList.add('pos-left');
    }
    // 左抽屉开 或 无 2 级页面：保持默认（右上角）
}
