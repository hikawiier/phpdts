<?php

if(!defined('IN_GAME')) {
	exit('Access Denied');
}

/**
 * 更新玩家的charge值
 * 
 * 该函数在玩家移动与探索时调用，更新玩家$clbpara中的四个charge键值
 * 
 * @param array &$data 玩家数据
 * @return void
 */
function update_charge_values(&$data) 
{
	if(!isset($data)) {
		global $pdata;
		$data = &$pdata;
	}
	extract($data, EXTR_REFS);
	
	// 确保clbpara是数组
	$clbpara = get_clbpara($clbpara);
	
	// 更新charge1：最高到101，提升速度按照randver1而定，最高4点每次
	if(!isset($clbpara['charge1'])) {
		$clbpara['charge1'] = 0;
	}
	
	if($clbpara['charge1'] < 101) {
		// 计算提升值，基于randver1，最高4点
		$increase = min(4, max(1, ceil($clbpara['randver1'] / 32)));
		$clbpara['charge1'] = min(101, $clbpara['charge1'] + $increase);
	}
	
	// 确保 clbpara 是数组
	if(!is_array($clbpara)) {
		if(is_string($clbpara)) {
			$clbpara = json_decode($clbpara, true);
		}
		if(!is_array($clbpara)) {
			$clbpara = array();
		}
	}

	// 更新charge2：不设上限，提升速度按照randver2而定，最高100点每次
	if(!isset($clbpara['charge2']) || !is_numeric($clbpara['charge2'])) {
		$clbpara['charge2'] = 0;
	}

	// 计算提升值，基于randver2，最高100点
	$increase = min(100, max(1, ceil($clbpara['randver2'] / 3)));
	$clbpara['charge2'] += $increase;
	
	// 更新charge3：最高值128，最低值-128，可提升或削减
	if(!isset($clbpara['charge3'])) {
		$clbpara['charge3'] = 0;
	}
	
	// 随机决定是提升还是削减
	$direction = (rand(0, 1) == 1) ? 1 : -1;
	// 变化量在1-3之间随机
	$change = rand(1, 3) * $direction;
	$clbpara['charge3'] = max(-128, min(128, $clbpara['charge3'] + $change));
	
	// 更新charge4：没有上限或下限，可提升或削减
	if(!isset($clbpara['charge4']) || !is_numeric($clbpara['charge4'])) {
		$clbpara['charge4'] = 0;
	}

	// 随机决定是提升还是削减
	$direction = (rand(0, 1) == 1) ? 1 : -1;
	// 变化量在1-10之间随机
	$change = rand(1, 10) * $direction;
	$clbpara['charge4'] += $change;
}

/**
 * 获取玩家的charge值
 * 
 * @param array $data 玩家数据
 * @param string $charge_key 要获取的charge键名 (charge1, charge2, charge3, charge4)
 * @return int 对应的charge值，如果不存在则返回0
 */
function get_charge_value($data, $charge_key = '') 
{
	if(!isset($data)) {
		global $pdata;
		$data = &$pdata;
	}
	
	$clbpara = get_clbpara($data['clbpara']);
	
	// 如果没有指定键名，返回所有charge值
	if(empty($charge_key)) {
		$result = array();
		for($i = 1; $i <= 4; $i++) {
			$key = 'charge' . $i;
			$result[$key] = isset($clbpara[$key]) ? $clbpara[$key] : 0;
		}
		return $result;
	}
	
	// 返回指定的charge值
	return isset($clbpara[$charge_key]) ? $clbpara[$charge_key] : 0;
}

/**
 * 修改玩家的charge值
 * 
 * @param array &$data 玩家数据
 * @param string $charge_key 要修改的charge键名 (charge1, charge2, charge3, charge4)
 * @param int $value 新的值
 * @return bool 是否成功修改
 */
function set_charge_value(&$data, $charge_key, $value) 
{
	if(!isset($data)) {
		global $pdata;
		$data = &$pdata;
	}
	extract($data, EXTR_REFS);
	
	// 确保clbpara是数组
	$clbpara = get_clbpara($clbpara);
	
	// 验证charge_key是否有效
	if(!in_array($charge_key, array('charge1', 'charge2', 'charge3', 'charge4'))) {
		return false;
	}
	
	// 根据不同的charge_key应用不同的限制
	switch($charge_key) {
		case 'charge1':
			// charge1最高到101
			$clbpara[$charge_key] = min(101, $value);
			break;
		case 'charge3':
			// charge3范围是-128到128
			$clbpara[$charge_key] = max(-128, min(128, $value));
			break;
		default:
			// charge2和charge4没有限制
			$clbpara[$charge_key] = $value;
			break;
	}
	
	return true;
}

/**
 * 在玩家移动或探索时调用此函数来更新charge值
 * 
 * 此函数应该在search.func.php的move和search函数中调用
 * 
 * @param array &$data 玩家数据
 * @return void
 */
function process_charge_events(&$data) 
{
	// 更新玩家的charge值
	update_charge_values($data);
}

?>
