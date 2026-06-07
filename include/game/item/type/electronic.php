<?php

if (! defined ( 'IN_GAME' )) {
	exit ( 'Access Denied' );
}

// Handle electronic items
function item_electronic($itmn, &$data) {
	extract($data, EXTR_REFS);
	
	include_once GAME_ROOT . './include/game/item/item2.func.php';
	hack($itmn);
}
