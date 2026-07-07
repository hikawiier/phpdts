<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 技能模块注册器 / Skill module registry
//
// 职责：
// - 统一加载 skill/modules/*.skill.php
// - 提供通用 hook 注册表，避免 bootstrap 与 skill.main.php 了解具体技能
// ================================================================

$__skill_module_hooks = array(
    'equipment_injectors' => array(),
);

function skill_register_equipment_injector($func)
{
    global $__skill_module_hooks;
    if (!is_string($func) || $func === '') return;
    if (!isset($__skill_module_hooks['equipment_injectors']) || !is_array($__skill_module_hooks['equipment_injectors'])) {
        $__skill_module_hooks['equipment_injectors'] = array();
    }
    if (!in_array($func, $__skill_module_hooks['equipment_injectors'], true)) {
        $__skill_module_hooks['equipment_injectors'][] = $func;
    }
}

function skill_get_equipment_injectors()
{
    global $__skill_module_hooks;
    return isset($__skill_module_hooks['equipment_injectors']) && is_array($__skill_module_hooks['equipment_injectors'])
        ? $__skill_module_hooks['equipment_injectors']
        : array();
}

function skill_load_modules()
{
    static $loaded = false;
    if ($loaded) return;
    $loaded = true;

    $dir = GAME_ROOT . './oblivions/include/game/skill/modules/';
    $files = glob($dir . '*.skill.php');
    if (!is_array($files)) return;
    sort($files);
    foreach ($files as $file) {
        require_once $file;
    }
}
