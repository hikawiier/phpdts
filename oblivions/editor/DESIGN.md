# 地图编辑器改良设计案

## 一、拖拽移动地图格

### 交互
- **选择工具**下，按住已有格子 → 拖拽到空白格 → 松开完成移动
- 拖拽中：原格子半透明，目标空白格高亮（绿色边框），已占用格显示禁止（红色边框）
- 松开时若目标无效（已占用/超出网格），格子回到原位

### 逻辑
- 调用现有 `moveTile(pgroup, pls, newX, newY)`
- moveTile 内部已实现：断开旧连通 → 清空 neighbors → 新位置自动连通
- 拖拽期间不修改数据，仅松开时提交

### 实现
- `grid.js`：为 `.cell-tile` / `.cell-blocked` 添加 mousedown → mousemove → mouseup 拖拽逻辑
- `style.css`：添加 `.cell-dragging`（半透明）、`.cell-drop-target`（绿色高亮）、`.cell-drop-forbidden`（红色高亮）

---

## 二、坐标属性可编辑

### 交互
- 属性面板中坐标从只读文本改为两个 number input（X / Y）
- 输入值后即时生效，校验规则：
  - 值在网格范围内（0 ≤ x < cols, 0 ≤ y < rows）
  - 目标坐标未被占用 → 拒绝并回退

### 实现
- `tile-panel.js`：坐标行改为两个 `<input type="number">`，change 事件调用 `updateTile`

---

## 三、画笔预设

### 交互
- 工具栏新增"画笔设置"区域，绘制/油漆桶工具激活时显示
- 包含：地板下拉、潮汐下拉、可通行复选框
- 绘制新格子时使用预设值而非硬编码的 standard + shallow

### 预设状态
- 存储在 `state.js`：`brushPreset: { floor: 'standard', tide: 'shallow', passable: true }`
- `createTile` 接受预设参数，合并到新建的 tile 数据中

### 实现
- `state.js`：新增 `brushPreset`
- `tools.js`：新增 `setBrushPreset` / `getBrushPreset`
- `tile.js`：`createTile` 签名改为 `createTile(pgroup, x, y, preset)`
- `grid.js`：绘制时读取画笔预设传入 createTile
- `index.html`：工具栏添加画笔设置 UI
- `style.css`：画笔设置样式

---

## 四、油漆桶工具

### 交互
- 工具栏新增"油漆桶"按钮，快捷键 F
- 点击已有格子 → 将其地板/潮汐/可通行属性刷成当前画笔预设值
- 不影响格子的名称、描述、连通关系、坐标

### 实现
- `tools.js`：TOOL_LIST 增加 `paint`，快捷键映射增加 `f: paint`
- `grid.js`：handleCellClick 增加 paint 分支，调用 `updateTile` 仅修改 floor/tide/passable
- `index.html`：工具栏添加油漆桶按钮
- `style.css`：油漆桶光标 `cell` 或自定义

---

## 涉及文件清单

| 文件 | 改动 |
|------|------|
| `src/state.js` | 新增 brushPreset |
| `src/tools.js` | 新增 paint 工具、画笔预设读写 |
| `src/logic/tile.js` | createTile 接受预设参数 |
| `src/render/grid.js` | 拖拽交互、paint 工具点击、绘制读取预设 |
| `src/render/tile-panel.js` | 坐标改为可编辑 input |
| `index.html` | 工具栏添加画笔设置 UI + 油漆桶按钮 |
| `css/style.css` | 拖拽视觉、画笔设置样式 |
