<?php
if(!defined('IN_GAME')) exit('Access Denied');

/**
 * 处理 itmpara 的 tooltip 显示
 *
 * @param string|array $itmpara itmpara 字段的值
 * @param string $item_type 物品类型的第一个字符，如 W（武器）、A（防具）等
 * @return string 处理后的 tooltip 字符串，如果没有需要显示的内容则返回空字符串
 */
function parse_itmpara_tooltip($itmpara, $item_type = '')
{
    global $itmpara_tooltip;

    // 确保 $itmpara_tooltip 已经加载
    if(!isset($itmpara_tooltip) || empty($itmpara_tooltip)) {
        // 直接定义默认的 $itmpara_tooltip 数组
        $itmpara_tooltip = array(
            'AddDamageRaw' => array(
                'title' => '最终伤害增加',
                'format' => '{value}',
                'suffix' => '',
                'color' => 'red',
                'condition' => function($item_type, $value) { return true; }
            ),
            'AddDamagePercentage' => array(
                'title' => '最终伤害增加',
                'format' => '{value}',
                'suffix' => '%',
                'color' => 'red',
                'condition' => function($item_type, $value) { return true; }
            ),
            'lore' => array(
                'title' => '',
                'format' => '{value}',
                'suffix' => '',
                'color' => 'lore',
                'condition' => function($item_type, $value) { return true; }
            )
        );

        // 尝试加载配置文件，如果存在的话
        $config_file = GAME_ROOT.'./gamedata/cache/itmpara_tooltip.php';
        if(file_exists($config_file)) {
            include $config_file;
        }
    }

    // 初始化调试信息
    $debug_info = "\r\n---------- DEBUG INFO ----------";
    $debug_info .= "\r\nFunction: parse_itmpara_tooltip";
    $debug_info .= "\r\nInput type: " . gettype($itmpara);

    // 安全地处理 JSON 输出
    if(is_array($itmpara)) {
        // 使用 JSON_UNESCAPED_UNICODE 确保中文显示正常
        $json_str = json_encode($itmpara, JSON_UNESCAPED_UNICODE);
        $debug_info .= "\r\nInput value: " . $json_str;

        // 输出每个键的类型和值
        $debug_info .= "\r\nDetailed key info:";
        foreach($itmpara as $k => $v) {
            $debug_info .= "\r\n - Key: '{$k}' (" . gettype($k) . ")";
            $debug_info .= "\r\n   Value: '" . (is_array($v) ? json_encode($v, JSON_UNESCAPED_UNICODE) : $v) . "' (" . gettype($v) . ")";
        }
    } else {
        $debug_info .= "\r\nInput value: " . $itmpara;
    }

    $debug_info .= "\r\nItem type: {$item_type}";

    // 如果 itmpara 为空，直接返回调试信息
    if(empty($itmpara)) {
        $debug_info .= "\r\nEmpty itmpara detected";
        return $debug_info;
    }

    // 如果 itmpara 不是数组，尝试将其转换为数组
    if(!is_array($itmpara)) {
        $debug_info .= "\r\nConverting itmpara to array using get_itmpara()";

        $itmpara = get_itmpara($itmpara);

        $debug_info .= "\r\nAfter conversion:";
        $debug_info .= "\r\n - Type: " . gettype($itmpara);

        // 安全地处理 JSON 输出
        if(is_array($itmpara)) {
            $json_str = json_encode($itmpara, JSON_UNESCAPED_UNICODE);
            $debug_info .= "\r\n - Value: " . $json_str;
        } else {
            $debug_info .= "\r\n - Value: " . $itmpara;
        }

        $debug_info .= "\r\n - Empty: " . (empty($itmpara) ? 'true' : 'false');

        if(empty($itmpara)) {
            $debug_info .= "\r\nEmpty result after conversion";
            return $debug_info;
        }

        // 确保 $itmpara 是数组
        if(!is_array($itmpara)) {
            $debug_info .= "\r\nWarning: itmpara is still not an array after conversion";
            $debug_info .= "\r\nForcing conversion to empty array";
            $itmpara = array();
        }
    }

    // 获取物品类型的第一个字符
    if(!empty($item_type)) {
        $item_type = substr($item_type, 0, 1);
    }

    // 处理 tooltip
    $tooltip = '';

    // 先处理非 lore 的键值，再处理 lore
    // 处理 lore 将放到其他键值处理后

    // 处理其他键值
    $debug_info .= "\r\nProcessing itmpara keys:";
    $debug_info .= "\r\n - itmpara type: " . gettype($itmpara);
    $debug_info .= "\r\n - itmpara empty: " . (empty($itmpara) ? 'true' : 'false');

    // 确保 $itmpara 是数组并且不为空
    if(is_array($itmpara) && !empty($itmpara)) {
        $debug_info .= "\r\n - Keys: " . implode(', ', array_keys($itmpara));

        foreach($itmpara as $key => $value) {
            // 安全地处理值的输出
            if(is_array($value)) {
                $value_str = json_encode($value, JSON_UNESCAPED_UNICODE);
            } else {
                $value_str = $value;
            }
            $debug_info .= "\r\nProcessing key: {$key} = " . $value_str;

            // 跳过 lore，单独处理
            if($key === 'lore') {
                $debug_info .= "\r\n - Skipping lore key for later processing";
                continue;
            }

            // 检查是否有对应的 tooltip 配置
            // 输出所有可用的配置键
            $debug_info .= "\r\n - itmpara_tooltip is " . (isset($itmpara_tooltip) ? 'set' : 'not set');
            $debug_info .= "\r\n - itmpara_tooltip is " . (empty($itmpara_tooltip) ? 'empty' : 'not empty');
            $debug_info .= "\r\n - itmpara_tooltip type: " . gettype($itmpara_tooltip);

            // 确保 $itmpara_tooltip 是数组
            if(!is_array($itmpara_tooltip)) {
                $itmpara_tooltip = array(
                    'AddDamageRaw' => array(
                        'title' => '最终伤害增加',
                        'format' => '{value}',
                        'suffix' => '',
                        'color' => 'red',
                        'condition' => function($item_type, $value) { return true; }
                    ),
                    'AddDamagePercentage' => array(
                        'title' => '最终伤害增加',
                        'format' => '{value}',
                        'suffix' => '%',
                        'color' => 'red',
                        'condition' => function($item_type, $value) { return true; }
                    ),
                    'lore' => array(
                        'title' => '',
                        'format' => '{value}',
                        'suffix' => '',
                        'color' => 'lore',
                        'condition' => function($item_type, $value) { return true; }
                    )
                );
                $debug_info .= "\r\n - Created default itmpara_tooltip array";
            }

            $debug_info .= "\r\n - Available tooltip config keys: " . implode(', ', array_keys($itmpara_tooltip));

            // 先尝试直接匹配
            $debug_info .= "\r\n - Direct match check: isset(\$itmpara_tooltip['{$key}']) = " . (isset($itmpara_tooltip[$key]) ? 'true' : 'false');
            if(isset($itmpara_tooltip[$key])) {
                $debug_info .= "\r\n - Found tooltip config for key: {$key}";
                $config = $itmpara_tooltip[$key];
            }
            // 如果没有找到，尝试将键名转换为首字母大写的形式
            else {
                $ucfirstKey = ucfirst($key);
                $debug_info .= "\r\n - Ucfirst match check: isset(\$itmpara_tooltip['{$ucfirstKey}']) = " . (isset($itmpara_tooltip[$ucfirstKey]) ? 'true' : 'false');
                if(isset($itmpara_tooltip[$ucfirstKey])) {
                    $debug_info .= "\r\n - Found tooltip config for key (ucfirst): {$key} -> {$ucfirstKey}";
                    $config = $itmpara_tooltip[$ucfirstKey];
                }
                // 如果还是没有找到，尝试将键名转换为全大写的形式
                else {
                    $upperKey = strtoupper($key);
                    $debug_info .= "\r\n - Uppercase match check: isset(\$itmpara_tooltip['{$upperKey}']) = " . (isset($itmpara_tooltip[$upperKey]) ? 'true' : 'false');
                    if(isset($itmpara_tooltip[$upperKey])) {
                        $debug_info .= "\r\n - Found tooltip config for key (uppercase): {$key} -> {$upperKey}";
                        $config = $itmpara_tooltip[$upperKey];
                    }
                    // 如果还是没有找到，尝试将键名转换为全小写的形式
                    else {
                        $lowerKey = strtolower($key);
                        $debug_info .= "\r\n - Lowercase match check: isset(\$itmpara_tooltip['{$lowerKey}']) = " . (isset($itmpara_tooltip[$lowerKey]) ? 'true' : 'false');
                        if(isset($itmpara_tooltip[$lowerKey])) {
                            $debug_info .= "\r\n - Found tooltip config for key (lowercase): {$key} -> {$lowerKey}";
                            $config = $itmpara_tooltip[$lowerKey];
                        }
                        // 如果还是没有找到，尝试将键名转换为驼峰式的形式
                        else {
                            // 尝试将键名转换为驼峰式
                            $camelKey = preg_replace_callback('/(^|_)([a-z])/', function($matches) {
                                return strtoupper($matches[2]);
                            }, $key);

                            $debug_info .= "\r\n - CamelCase match check: isset(\$itmpara_tooltip['{$camelKey}']) = " . (isset($itmpara_tooltip[$camelKey]) ? 'true' : 'false');
                            if(isset($itmpara_tooltip[$camelKey])) {
                                $debug_info .= "\r\n - Found tooltip config for key (camelCase): {$key} -> {$camelKey}";
                                $config = $itmpara_tooltip[$camelKey];
                            }
                            // 如果还是没有找到，尝试在所有键中进行大小写不敏感的匹配
                            else {
                                $found = false;
                                foreach(array_keys($itmpara_tooltip) as $configKey) {
                                    if(strcasecmp($configKey, $key) === 0) {
                                        $debug_info .= "\r\n - Found tooltip config for key (strcasecmp): {$key} -> {$configKey}";
                                        $config = $itmpara_tooltip[$configKey];
                                        $found = true;
                                        break;
                                    }
                                }

                                if(!$found) {
                                    $debug_info .= "\r\n - No tooltip config found for key: {$key}";
                                    continue;
                                }
                            }
                        }
                    }
                }
            }

            // 检查条件
            if(isset($config['condition']) && is_callable($config['condition'])) {
                $condition_result = call_user_func($config['condition'], $item_type, $value);
                $debug_info .= "\r\n - Condition check result: " . ($condition_result ? 'true' : 'false');

                if(!$condition_result) {
                    $debug_info .= "\r\n - Skipping due to condition check";
                    continue;
                }
            }

            // 格式化显示内容
            $display = str_replace('{value}', $value, $config['format']) . $config['suffix'];
            $debug_info .= "\r\n - Formatted display: {$display}";

            // 添加颜色
            if(!empty($config['color'])) {
                $display = "<span class=\"{$config['color']}\">{$display}</span>";
                $debug_info .= "\r\n - Added color";
            }

            // 添加标题
            if(!empty($config['title'])) {
                $display = "{$config['title']}: {$display}";
                $debug_info .= "\r\n - Added title";
            }

            // 添加到 tooltip
            $tooltip .= $display . "\r";
            $debug_info .= "\r\n - Added to tooltip";
        }
    } else {
        $debug_info .= "\r\nSkipping key processing: itmpara is not a valid array or is empty";
    }

    // 最后处理 lore，如果存在则显示
    if(is_array($itmpara) && isset($itmpara['lore'])) {
        $debug_info .= "\r\nProcessing lore key:";
        $debug_info .= "\r\n - Value: {$itmpara['lore']}";
        $tooltip .= $itmpara['lore'] . "\r";
        $debug_info .= "\r\n - Added lore to tooltip";
    } else {
        $debug_info .= "\r\nNo lore key found or itmpara is not an array";
    }

    // 添加调试信息到返回的 tooltip
    $debug_info .= "\r\n---------- END DEBUG INFO ----------";

    // 检查玩家是否开启了调试模式
    global $clbpara;
    $show_debug = false;

    if(isset($clbpara) && is_array($clbpara) && isset($clbpara['SetItmparaDebug']) && $clbpara['SetItmparaDebug'] === true) {
        $show_debug = true;
    }

    // 如果 tooltip 为空
    if(empty($tooltip)) {
        // 如果开启了调试模式，返回调试信息
        if($show_debug) {
            $debug_info .= "\r\nNo tooltip content generated";
            return $debug_info;
        } else {
            // 否则返回空字符串
            return '';
        }
    }

    // 如果开启了调试模式，返回 tooltip 加上调试信息
    if($show_debug) {
        $tooltip .= $debug_info;
    }

    return rtrim($tooltip, "\r");
}

/**
 * 为物品名称添加 itmpara tooltip
 *
 * @param string $item_name 物品名称
 * @param string|array $itmpara itmpara 字段的值
 * @param string $item_type 物品类型
 * @param string $existing_tooltip 已有的 tooltip 内容
 * @return string 处理后的物品名称，带有 tooltip
 */
function add_itmpara_tooltip_to_item($item_name, $itmpara, $item_type = '', $existing_tooltip = '')
{
    // 解析 itmpara tooltip
    $itmpara_tooltip = parse_itmpara_tooltip($itmpara, $item_type);

    // 如果没有 itmpara tooltip，直接返回原始名称
    if(empty($itmpara_tooltip)) {
        return $item_name;
    }

    // 如果已有 tooltip，合并两者
    $tooltip = empty($existing_tooltip) ? $itmpara_tooltip : $existing_tooltip . "\r" . $itmpara_tooltip;

    // 返回带有 tooltip 的物品名称
    return "<span tooltip=\"{$tooltip}\">{$item_name}</span>";
}
