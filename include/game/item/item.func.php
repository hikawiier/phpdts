<?php

if (! defined ( 'IN_GAME' )) {
	exit ( 'Access Denied' );
}

include_once GAME_ROOT.'./include/pregame/clubslct.func.php';
include_once GAME_ROOT.'./include/game/item/type/main.php';

// 以下是原始的itemuse函数，现在它被移动到item.main.php中
// 这个文件只是为了保持向后兼容性
//function itemuse($itmn, &$data=NULL) {
	// 调用新的主函数
//	include_once GAME_ROOT.'./include/game/item/type/main.php';
//	return itemuse($itmn, $data);
//}
