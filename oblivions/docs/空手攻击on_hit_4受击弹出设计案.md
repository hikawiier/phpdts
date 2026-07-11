# 空手攻击 on_hit_4 受击弹出设计案

## 1. 定位

`on_hit_4.png` 是空手攻击的命中立绘，不是 Actor 受击动作本身。它配置在固定八阶段播放链的 `hitConcurrent`，与目标 `target-hit` 同时播放。

```txt
hitMain: target-hit
hitConcurrent: unarmed-hit-popup
```

只有 `actionId === 'unarmed_strike'` 使用该 cue。其他 `melee_hit` 技能不得因共享动作类型而自动继承空手命中素材。

## 2. 目标与位置

1. 只为 `damage` effect 中 HP 真实下降的目标创建 popup。
2. 多目标时每个受击者各创建一个，彼此并行。
3. 位置读取目标 Actor 的 `ScenePoint`，经当前 `SceneGeometry.sceneToViewport()` 转为视口坐标。
4. 图片挂在 body fixed overlay 层，位于目标身体前方，不进入 Actor 的 pose/action/visibility channel。

## 3. 素材与动画

- 素材：`/img/temp/on_hit_4.png`
- 原始尺寸：`76×67`，按原生尺寸显示，不向上放大。
- 动画：`scale 0.28 / opacity 0` → `scale 1.08 / opacity 1` → `scale 1` → `scale 0.94 / opacity 0`。
- 总时长约 `270ms`，使用 GSAP timeline。
- 首次使用等待图片 decode 后启动，避免冷缓存导致动画先结束、素材后出现。

## 4. 生命周期

popup 必须返回标准 `AnimationHandle` 并加入当前 action 的 TaskScope。完成、取消、场景替换或 step timeout 时均 kill timeline、移除 DOM 并 settle handle，不得留下孤立图片节点。

