<?php

if(!defined('IN_GAME')) {
	exit('Access Denied');
}

/**
 * 主从数据库同步功能
 * Master-Slave Database Synchronization Functions
 */

/**
 * 连接主数据库
 * Connect to master database
 */
function connect_master_db() {
	global $master_dbhost, $master_dbuser, $master_dbpw, $master_dbname, $database, $pconnect;
	
	if(empty($master_dbhost) || empty($master_dbuser) || empty($master_dbname)) {
		return false;
	}
	
	require_once GAME_ROOT.'./include/db/db_'.$database.'.class.php';
	$master_db = new dbstuff;
	$master_db->connect($master_dbhost, $master_dbuser, $master_dbpw, $master_dbname, $pconnect);
	
	if($master_db->error()) {
		return false;
	}
	
	return $master_db;
}

/**
 * 检查用户是否已在主数据库中存在
 * Check if user exists in master database
 */
function check_user_in_master($username, $password) {
	global $master_tablepre;
	
	$master_db = connect_master_db();
	if(!$master_db) {
		return false;
	}
	
	$username = addslashes($username);
	$password = addslashes($password);
	
	$result = $master_db->query("SELECT * FROM {$master_tablepre}users WHERE username = '$username' AND password = '$password'");
	if(!$master_db->num_rows($result)) {
		return false;
	}
	
	return $master_db->fetch_array($result);
}

/**
 * 从主数据库同步用户数据到本地数据库
 * Sync user data from master database to local database
 */
function sync_user_from_master($username, $password, $target_username = null) {
	global $db, $gtablepre, $master_tablepre;
	
	$master_db = connect_master_db();
	if(!$master_db) {
		return array('success' => false, 'message' => '无法连接到主数据库');
	}
	
	$username = addslashes($username);
	$password = addslashes($password);
	
	// 检查主数据库中的用户
	$result = $master_db->query("SELECT * FROM {$master_tablepre}users WHERE username = '$username' AND password = '$password'");
	if(!$master_db->num_rows($result)) {
		return array('success' => false, 'message' => '主数据库中未找到匹配的用户名和密码');
	}
	
	$master_user_data = $master_db->fetch_array($result);
	$target_username = $target_username ? $target_username : $username;
	$target_username = addslashes($target_username);
	
	// 检查是否已经被其他账户同步过
	$sync_info = get_user_sync_info($username);
	if($sync_info && $sync_info['target_username'] != $target_username) {
		return array('success' => false, 'message' => "该主服务器账户已被用户 {$sync_info['target_username']} 同步，无法重复同步");
	}
	
	// 检查本地是否已存在目标用户
	$local_result = $db->query("SELECT * FROM {$gtablepre}users WHERE username = '$target_username'");
	if($db->num_rows($local_result)) {
		$local_user_data = $db->fetch_array($local_result);
		
		// 更新现有用户数据
		$update_fields = array();
		$sync_fields = array('credits', 'credits2', 'achievement', 'achrev', 'daily', 'nick', 'nicks', 'validgames', 'wingames', 'gender', 'icon', 'club', 'motto', 'killmsg', 'lastword');
		
		foreach($sync_fields as $field) {
			if(isset($master_user_data[$field])) {
				$value = addslashes($master_user_data[$field]);
				$update_fields[] = "`$field` = '$value'";
			}
		}
		
		if(!empty($update_fields)) {
			$update_sql = "UPDATE {$gtablepre}users SET " . implode(', ', $update_fields) . " WHERE username = '$target_username'";
			$db->query($update_sql);
		}
		
		// 记录同步信息
		set_user_sync_info($target_username, $username);
		
		return array('success' => true, 'message' => '用户数据同步成功');
	} else {
		// 创建新用户
		$insert_fields = array('username' => $target_username);
		$sync_fields = array('password', 'groupid', 'credits', 'credits2', 'achievement', 'achrev', 'daily', 'nick', 'nicks', 'validgames', 'wingames', 'gender', 'icon', 'club', 'motto', 'killmsg', 'lastword');
		
		foreach($sync_fields as $field) {
			if(isset($master_user_data[$field])) {
				$insert_fields[$field] = addslashes($master_user_data[$field]);
			}
		}
		
		$fields = implode('`, `', array_keys($insert_fields));
		$values = "'" . implode("', '", array_values($insert_fields)) . "'";
		
		$insert_sql = "INSERT INTO {$gtablepre}users (`$fields`) VALUES ($values)";
		$db->query($insert_sql);
		
		if($db->affected_rows()) {
			// 记录同步信息
			set_user_sync_info($target_username, $username);
			return array('success' => true, 'message' => '用户账户创建并同步成功');
		} else {
			return array('success' => false, 'message' => '创建用户账户失败');
		}
	}
}

/**
 * 获取用户同步信息
 * Get user sync information
 */
function get_user_sync_info($master_username) {
	global $db, $gtablepre;

	// 确保同步表存在
	create_sync_table_if_not_exists();

	$master_username = addslashes($master_username);
	$result = $db->query("SELECT * FROM {$gtablepre}user_sync WHERE master_username = '$master_username'");

	if($db->num_rows($result)) {
		return $db->fetch_array($result);
	}

	return false;
}

/**
 * 设置用户同步信息
 * Set user sync information
 */
function set_user_sync_info($target_username, $master_username) {
	global $db, $gtablepre;
	
	$target_username = addslashes($target_username);
	$master_username = addslashes($master_username);
	$sync_time = time();
	
	// 检查同步表是否存在，不存在则创建
	create_sync_table_if_not_exists();
	
	// 检查是否已存在记录
	$result = $db->query("SELECT * FROM {$gtablepre}user_sync WHERE target_username = '$target_username'");
	
	if($db->num_rows($result)) {
		// 更新现有记录
		$db->query("UPDATE {$gtablepre}user_sync SET master_username = '$master_username', sync_time = '$sync_time' WHERE target_username = '$target_username'");
	} else {
		// 插入新记录
		$db->query("INSERT INTO {$gtablepre}user_sync (target_username, master_username, sync_time) VALUES ('$target_username', '$master_username', '$sync_time')");
	}
}

/**
 * 创建同步表（如果不存在）
 * Create sync table if not exists
 */
function create_sync_table_if_not_exists() {
	global $db, $gtablepre;

	$table_name = $gtablepre . 'user_sync';

	// 检查表是否存在
	$result = $db->query("SHOW TABLES LIKE '$table_name'");

	if(!$result || !$db->num_rows($result)) {
		// 创建同步表
		$create_sql = "CREATE TABLE `$table_name` (
			`id` int(10) unsigned NOT NULL AUTO_INCREMENT,
			`target_username` char(15) NOT NULL DEFAULT '',
			`master_username` char(15) NOT NULL DEFAULT '',
			`sync_time` int(10) unsigned NOT NULL DEFAULT '0',
			PRIMARY KEY (`id`),
			UNIQUE KEY `target_username` (`target_username`),
			KEY `master_username` (`master_username`)
		) ENGINE=MyISAM DEFAULT CHARSET=utf8";

		$db->query($create_sql);
	}
}

/**
 * 获取用户的同步状态
 * Get user sync status
 */
function get_user_sync_status($username) {
	global $db, $gtablepre;

	// 确保同步表存在
	create_sync_table_if_not_exists();

	$username = addslashes($username);
	$result = $db->query("SELECT * FROM {$gtablepre}user_sync WHERE target_username = '$username'");

	if($db->num_rows($result)) {
		return $db->fetch_array($result);
	}

	return false;
}

/**
 * 检查是否为从服务器且需要自动同步
 * Check if this is a slave server that needs auto sync
 */
function should_auto_sync() {
	global $slave_level;
	return (isset($slave_level) && $slave_level == 2);
}

/**
 * 检查是否直接使用主数据库
 * Check if should use master database directly
 */
function should_use_master_db() {
	global $slave_level;
	return (isset($slave_level) && $slave_level == 3);
}

/**
 * 检查是否为反向迁移模式
 * Check if this is reverse migration mode
 */
function is_reverse_migration_mode() {
	global $slave_level;
	return (isset($slave_level) && $slave_level == -1);
}

/**
 * 反向迁移：将本地数据库的用户数据迁移到远端从数据库
 * Reverse migration: migrate user data from local database to remote slave database
 *
 * @param string $local_username 本地用户名（已登录用户）
 * @param string $remote_username 远端从服务器用户名
 * @param string $remote_password 远端从服务器密码
 * @param string $target_username 目标用户名（可选，默认使用远端用户名）
 */
function reverse_migrate_user($local_username, $remote_username, $remote_password, $target_username = null) {
	global $db, $gtablepre, $master_tablepre;

	// 检查是否为反向迁移模式
	if(!is_reverse_migration_mode()) {
		return array('success' => false, 'message' => '当前不是反向迁移模式 (slave_level != -1)');
	}

	$local_username = addslashes($local_username);
	$remote_username = addslashes($remote_username);
	$remote_password = addslashes($remote_password);

	// 读取本地用户数据（本地用户已通过登录验证）
	$local_result = $db->query("SELECT * FROM {$gtablepre}users WHERE username = '$local_username'");
	if(!$db->num_rows($local_result)) {
		return array('success' => false, 'message' => '本地数据库中未找到用户数据');
	}

	$local_user_data = $db->fetch_array($local_result);
	$target_username = $target_username ? $target_username : $remote_username;
	$target_username = addslashes($target_username);

	// 连接到远端从数据库（复用主数据库配置）
	$slave_db = connect_master_db(); // 复用连接函数，实际连接的是从数据库
	if(!$slave_db) {
		return array('success' => false, 'message' => '无法连接到远端从数据库');
	}

	// 验证远端从服务器的用户身份
	$remote_auth_result = $slave_db->query("SELECT * FROM {$master_tablepre}users WHERE username = '$remote_username' AND password = '$remote_password'");
	if(!$slave_db->num_rows($remote_auth_result)) {
		return array('success' => false, 'message' => '远端从服务器身份验证失败：用户名或密码错误');
	}

	// 检查远端从数据库是否已存在目标用户
	$slave_result = $slave_db->query("SELECT * FROM {$master_tablepre}users WHERE username = '$target_username'");
	if($slave_db->num_rows($slave_result)) {
		// 更新远端从数据库中的现有用户数据
		$update_fields = array();
		$sync_fields = array('password', 'groupid', 'credits', 'credits2', 'achievement', 'achrev', 'daily', 'nick', 'nicks', 'nicksrev', 'validgames', 'wingames', 'gender', 'icon', 'club', 'motto', 'killmsg', 'lastword');

		foreach($sync_fields as $field) {
			if(isset($local_user_data[$field])) {
				$value = addslashes($local_user_data[$field]);
				$update_fields[] = "`$field` = '$value'";
			}
		}

		if(!empty($update_fields)) {
			$update_sql = "UPDATE {$master_tablepre}users SET " . implode(', ', $update_fields) . " WHERE username = '$target_username'";
			$slave_db->query($update_sql);
		}

		// 同时迁移游戏角色数据
		$game_migrate_result = reverse_migrate_game_data($local_username, $target_username, $slave_db);

		// 记录反向迁移信息
		set_reverse_migration_info($target_username, $local_username);

		$message = '用户数据已推送到远端从服务器';
		if($game_migrate_result['game_data_migrated']) {
			$message .= '，游戏角色数据已同步';
		}

		return array('success' => true, 'message' => $message);
	} else {
		// 在远端从数据库中创建新用户
		$insert_fields = array('username' => $target_username);
		$sync_fields = array('password', 'groupid', 'credits', 'credits2', 'achievement', 'achrev', 'daily', 'nick', 'nicks', 'nicksrev', 'validgames', 'wingames', 'gender', 'icon', 'club', 'motto', 'killmsg', 'lastword');

		foreach($sync_fields as $field) {
			if(isset($local_user_data[$field])) {
				$insert_fields[$field] = addslashes($local_user_data[$field]);
			}
		}

		$fields = implode('`, `', array_keys($insert_fields));
		$values = "'" . implode("', '", array_values($insert_fields)) . "'";

		$insert_sql = "INSERT INTO {$master_tablepre}users (`$fields`) VALUES ($values)";
		$slave_db->query($insert_sql);

		if($slave_db->affected_rows()) {
			// 同时迁移游戏角色数据
			$game_migrate_result = reverse_migrate_game_data($local_username, $target_username, $slave_db);

			// 记录反向迁移信息
			set_reverse_migration_info($target_username, $local_username);

			$message = '用户账户已创建并推送到远端从服务器';
			if($game_migrate_result['game_data_migrated']) {
				$message .= '，游戏角色数据已同步';
			}

			return array('success' => true, 'message' => $message);
		} else {
			return array('success' => false, 'message' => '在远端从服务器创建用户账户失败');
		}
	}
}

/**
 * 反向迁移游戏角色数据：将本地游戏角色数据推送到远端从数据库
 * Reverse migrate game character data: push local game character data to remote slave database
 */
function reverse_migrate_game_data($local_username, $target_username, $slave_db) {
	global $db, $tablepre, $master_tablepre;

	$local_username = addslashes($local_username);
	$target_username = addslashes($target_username);

	// 查询本地数据库中的游戏角色数据
	$result = $db->query("SELECT * FROM {$tablepre}players WHERE name = '$local_username' AND type = 0");

	if(!$db->num_rows($result)) {
		return array('game_data_migrated' => false, 'message' => '本地数据库中未找到游戏角色数据');
	}

	$local_player_data = $db->fetch_array($result);

	// 检查远端从数据库是否已存在目标角色
	$slave_result = $slave_db->query("SELECT * FROM {$master_tablepre}players WHERE name = '$target_username' AND type = 0");

	if($slave_db->num_rows($slave_result)) {
		// 更新远端从数据库中的现有角色数据
		$update_fields = array();
		$sync_fields = array('pass', 'hp', 'mhp', 'sp', 'msp', 'att', 'def', 'exp', 'money', 'pls', 'wep', 'wep2', 'arb', 'arh', 'arf', 'art', 'itm1', 'itm2', 'itm3', 'itm4', 'itm5', 'itm6', 'club', 'clbpara', 'skill', 'skillpoint', 'pose', 'icon', 'killnum', 'winnum', 'losenum', 'nick', 'achievement', 'state', 'endtime');

		foreach($sync_fields as $field) {
			if(isset($local_player_data[$field])) {
				$value = addslashes($local_player_data[$field]);
				$update_fields[] = "`$field` = '$value'";
			}
		}

		if(!empty($update_fields)) {
			$update_sql = "UPDATE {$master_tablepre}players SET " . implode(', ', $update_fields) . " WHERE name = '$target_username' AND type = 0";
			$slave_db->query($update_sql);
		}

		return array('game_data_migrated' => true, 'message' => '游戏角色数据已推送到远端从服务器');
	} else {
		// 在远端从数据库中创建新角色
		$insert_fields = array('name' => $target_username);
		$sync_fields = array('pass', 'hp', 'mhp', 'sp', 'msp', 'att', 'def', 'exp', 'money', 'pls', 'wep', 'wep2', 'arb', 'arh', 'arf', 'art', 'itm1', 'itm2', 'itm3', 'itm4', 'itm5', 'itm6', 'club', 'clbpara', 'skill', 'skillpoint', 'pose', 'icon', 'killnum', 'winnum', 'losenum', 'nick', 'achievement', 'state', 'endtime', 'type');

		foreach($sync_fields as $field) {
			if(isset($local_player_data[$field])) {
				$insert_fields[$field] = addslashes($local_player_data[$field]);
			}
		}

		// 确保type为0（玩家角色）
		$insert_fields['type'] = 0;

		$fields = implode('`, `', array_keys($insert_fields));
		$values = "'" . implode("', '", array_values($insert_fields)) . "'";

		$insert_sql = "INSERT INTO {$master_tablepre}players (`$fields`) VALUES ($values)";
		$slave_db->query($insert_sql);

		if($slave_db->affected_rows()) {
			return array('game_data_migrated' => true, 'message' => '游戏角色数据已创建并推送到远端从服务器');
		} else {
			return array('game_data_migrated' => false, 'message' => '在远端从服务器创建游戏角色数据失败');
		}
	}
}

/**
 * 记录反向迁移信息
 * Record reverse migration info
 */
function set_reverse_migration_info($target_username, $master_username) {
	global $db, $gtablepre;

	create_reverse_migration_table_if_not_exists();

	$target_username = addslashes($target_username);
	$master_username = addslashes($master_username);
	$sync_time = time();

	// 检查是否已存在记录
	$result = $db->query("SELECT * FROM {$gtablepre}reverse_migration WHERE target_username = '$target_username'");

	if($db->num_rows($result)) {
		// 更新现有记录
		$db->query("UPDATE {$gtablepre}reverse_migration SET master_username = '$master_username', sync_time = '$sync_time' WHERE target_username = '$target_username'");
	} else {
		// 插入新记录
		$db->query("INSERT INTO {$gtablepre}reverse_migration (target_username, master_username, sync_time) VALUES ('$target_username', '$master_username', '$sync_time')");
	}
}

/**
 * 创建反向迁移记录表（如果不存在）
 * Create reverse migration table if not exists
 */
function create_reverse_migration_table_if_not_exists() {
	global $db, $gtablepre;

	$result = $db->query("SHOW TABLES LIKE '{$gtablepre}reverse_migration'");
	if(!$result || !$db->num_rows($result)) {
		$create_sql = "CREATE TABLE `{$gtablepre}reverse_migration` (
			`id` int(10) unsigned NOT NULL AUTO_INCREMENT,
			`target_username` char(15) NOT NULL DEFAULT '',
			`master_username` char(15) NOT NULL DEFAULT '',
			`sync_time` int(10) unsigned NOT NULL DEFAULT '0',
			PRIMARY KEY (`id`),
			UNIQUE KEY `target_username` (`target_username`),
			KEY `master_username` (`master_username`)
		) ENGINE=MyISAM DEFAULT CHARSET=utf8";

		$db->query($create_sql);
	}
}

/**
 * 获取反向迁移状态
 * Get reverse migration status
 */
function get_reverse_migration_status($username) {
	global $db, $gtablepre;

	// 确保反向迁移表存在
	create_reverse_migration_table_if_not_exists();

	$username = addslashes($username);
	$result = $db->query("SELECT * FROM {$gtablepre}reverse_migration WHERE target_username = '$username'");

	if($db->num_rows($result)) {
		return $db->fetch_array($result);
	}

	return false;
}

?>
