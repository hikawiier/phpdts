// @module O 内容工具箱
//
// 地图空间结构类型定义，与后端 bra_oblmapstates 表 + gamedata/map.php + region_*.php 字段 1:1 对齐
// 字段名保持蛇形命名（与后端 PHP 一致），不引入驼峰转换层（避免索引锚点丢失，对齐 3.1）

/**
 * 区域编号（pgroup），对齐后端 tinyint 上限 1-255
 */
export type Pgroup = number;

/**
 * 地图格编号（pls），对齐后端 tinyint 上限 1-254（pls=0 保留不使用）
 */
export type Pls = number;

/**
 * 地板类型（5 类）
 */
export type Floor = 'standard' | 'water' | 'vegetation' | 'metal' | 'magic';

/**
 * 潮汐类型（3 档，不含 safe；safe 由独立 preset_safe 字段标记，对齐 DESIGN.md 1.3）
 */
export type Tide = 'shallow' | 'deep' | 'abyss';

/**
 * 区域元数据（对齐 map.php 中 regions[pgroup]）
 */
export interface Region {
  name: string;
  desc: string;
  entrance_pls: Pls | null;
  exit_pls: Pls | null;
  next_region: Pgroup | null;
  prev_region: Pgroup | null;
  exit_links: ExitLink[];
  cols: number; // 冗余字段，与 grids.cols 同步
  rows: number;
}

/**
 * 跨区域出口映射（对象数组格式，编辑器升级；旧 PHP 裸 pgroup 数字数组导入时自动迁移）
 */
export interface ExitLink {
  from_pls: Pls | null;
  to_pgroup: Pgroup;
  to_pls: Pls | null;
}

/**
 * 网格尺寸（对齐 map.php 中 grids[pgroup]）
 */
export interface Grid {
  cols: number;
  rows: number;
}

/**
 * 地图格（对齐 region_*.php 中 tiles[pls]）
 *
 * `_breaks" 是编辑器专用字段，记录断开状态，php-codegen 导出时剥离
 */
export interface Tile {
  name: string;
  desc: string;
  floor: Floor;
  tide: Tide;
  height: number;
  passable: boolean;
  destructible: boolean;
  neighbors: Pls[];
  x: number;
  y: number;
  preset_safe: boolean;
  _breaks?: Pls[];
}

/**
 * 地图项目（编辑器内存数据模型）
 */
export interface MapProject {
  regions: Record<Pgroup, Region>;
  grids: Record<Pgroup, Grid>;
  tiles: Record<Pgroup, Record<Pls, Tile>>;
}

/**
 * 项目元数据（与 MapProject 一起持久化，用于编辑器侧信息展示）
 *
 * 与 MapProject 分离：MapProject 是后端契约的纯数据，ProjectData 是编辑器侧附带信息。
 * 持久化时合并为 ProjectData.payload；导出 PHP 时仅取 payload 部分。
 */
export interface ProjectData {
  /** 项目名（编辑器侧命名，不写回 PHP） */
  name: string;
  /** 创建时间戳（ms） */
  createdAt: number;
  /** 最后修改时间戳（ms） */
  updatedAt: number;
  /** 实际地图数据（与后端契约对齐） */
  payload: MapProject;
}

/**
 * 玩家位置（用于 Simulate 模式）
 */
export interface PlayerPosition {
  pgroup: Pgroup | null;
  pls: Pls | null;
}
