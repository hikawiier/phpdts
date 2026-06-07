<?php

define('CURSCRIPT', 'revbotservice');

$gameRoot = dirname(__DIR__).DIRECTORY_SEPARATOR;
if(is_dir($gameRoot)) {
	chdir($gameRoot);
}

require_once $gameRoot.'include/core/common.inc.php';
require_once GAME_ROOT.'./include/gamectl/game.func.php';
require_once GAME_ROOT.'./bot/revbot.func.php';

$bot_respawn_chance = isset($_GET['respawn_chance']) ? (int)$_GET['respawn_chance'] : 35;
if($bot_respawn_chance < 0) $bot_respawn_chance = 0;
if($bot_respawn_chance > 100) $bot_respawn_chance = 100;

$oneshot = isset($_GET['oneshot']) ? (int)$_GET['oneshot'] : 0;
$oneshot = $oneshot ? 1 : 0;

# 注意：因为进程锁的存在，运行bot脚本时必须确保游戏处于未开始状态
# 否则请先中止游戏，并手动清空lock目录下所有文件，然后确保游戏正处于未开始状态下运行脚本

# 单次执行模式：执行一次初始化或一次行动后立即退出，避免长连接占用游戏锁
if($oneshot)
{
	load_gameinfo();
	echo "oneshot=1
";
	echo "当前游戏状态:{$gamestate}
";
	if($gamestate <= 10) {
		echo "游戏未开始，跳过。
";
		exit();
	}

	if (!empty($gamevars['botplayer']))
	{
		$ids = bot_player_valid(1);
		$id = $ids[0];
		$gamevars['botid'][] = $id;
		$gamevars['botplayer'] --;
		save_gameinfo();
		echo "BOT初始化完成，id：" . ($id) . "
剩余待初始化bot数量：{$gamevars['botplayer']}
";
		exit();
	}

	if (!empty($gamevars['botid']))
	{
		$id = $gamevars['botid'][array_rand($gamevars['botid'])];
		$flag = bot_acts($id);
		if ($flag == 0) {
			$index = array_search($id, $gamevars['botid']);
			if($index !== false) unset($gamevars['botid'][$index]);
			$roll = mt_rand(1,100);
			if($bot_respawn_chance > 0 && $roll <= $bot_respawn_chance) {
				$gamevars['botplayer'] = isset($gamevars['botplayer']) ? (int)$gamevars['botplayer'] + 1 : 1;
				echo "BOT：{$id} 已死亡；已加入重生队列。roll={$roll}, chance={$bot_respawn_chance}
";
			} else {
				echo "BOT：{$id} 已死亡；不加入重生队列。roll={$roll}, chance={$bot_respawn_chance}
";
			}
			save_gameinfo();
			save_combatinfo();
			exit();
		}
		echo "BOT：{$id} 行动完成
";
		exit();
	}

	echo "当前无可行动BOT。
";
	exit();
}

# 进程初始化
bot_prepare_flag:
$id = 0;
$dir = GAME_ROOT.'./bot/lock/';
if(!is_dir($dir)) {
	mkdir($dir, 0777, true);
}
$scdir = scandir($dir);
# 为进程创建对应编号的进程锁
$process_id = $scdir ? count($scdir)+1 : 1;
touch($dir.$process_id.'.lock');

while(true)
{
	load_gameinfo();
	echo "进程id【{$process_id}】正在运行，当前游戏状态:{$gamestate}\n";
	ob_end_flush();
	sleep(1);
	# bot初始化阶段
	if ($gamestate > 10 && !empty($gamevars['botplayer']))
	{
		$scdir = scandir($dir);
		# 在这个阶段 进程锁数量应该是与进程id一一对应的，建议先只运行一个脚本校对进程锁数量
		# 如果发现进程锁数量与进程id不能对应，则可能是系统原因，文件夹lock内存在其他隐藏文件，记得根据差值自己调整$scnums后面的 + -
		$scnums = count($scdir);
		echo "当前进程锁数量:".$scnums."\n";
		ob_end_flush();
		# 进程锁数量等于当前编号ID时，才会进行初始化
		if($process_id == $scnums)
		{
			$ids = bot_player_valid(1);
			$id = $ids[0];
			//unset($gamevars['botplayer']);
			$gamevars['botid'][] = $id;
			$gamevars['botplayer'] --;
			save_gameinfo();
			# 解锁
			sleep(1);
			unlink($dir.$process_id.'.lock');
			echo "BOT初始化完成，id：" . ($id) . "\n剩余待初始化bot数量：{$gamevars['botplayer']}";
			ob_end_flush();
			goto bot_act_flag;
		}
		else
		{
			echo "有其他进程正在进行初始化，等待中...\n";
			ob_end_flush();
			sleep(1);
		}
	}
}

# bot开始行动
bot_act_flag:
while($id)
{
	load_gameinfo();
	if ($gamestate > 10) 
	{
		if (!empty($gamevars['botid']))
		{
			$flag = bot_acts($id);
			if ($flag == 0) {
				$index = array_search($id, $gamevars['botid']);
				if($index !== false) unset($gamevars['botid'][$index]);
				$roll = mt_rand(1,100);
				if($gamestate > 10 && $bot_respawn_chance > 0 && $roll <= $bot_respawn_chance) {
					$gamevars['botplayer'] = isset($gamevars['botplayer']) ? (int)$gamevars['botplayer'] + 1 : 1;
					echo "BOT：{$id} 已死亡；已加入重生队列。roll={$roll}, chance={$bot_respawn_chance}\n";
				} else {
					echo "BOT：{$id} 已死亡；不加入重生队列。roll={$roll}, chance={$bot_respawn_chance}\n";
				}
				save_gameinfo();
				save_combatinfo();
				ob_end_flush();
				break;
			}
			echo "\nBOT：{$id} 行动完成\n";
			ob_end_flush();
		}
		else
		{
			echo "BOT：{$id} 不在活动队列，进程退出。\n";
			ob_end_flush();
			break;
		}
		sleep(1);
	}
	else 
	{
		goto bot_prepare_flag;
	}
}
