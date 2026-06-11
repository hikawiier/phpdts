<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// 界面渲染辅助函数 / UI rendering helper functions
// 包括：模板功能开关、BGM播放器、小地图、社团技能模板
// Includes: template feature toggle, BGM player, minimap, club skill template

// 功能开关：检查当前模板是否支持 dialogue 对话面板和 BGM 播放器
// Feature toggle: check if current template supports dialogue panel & BGM player
// 仅在 u_templateid = 0 (经典界面) 或 2 (NOUVEAU) 时启用
// Only enabled for u_templateid = 0 (classic) or 2 (NOUVEAU)
function is_rich_template_enabled() {
	global $udata;
	// Oblivions 模式：不启用 dialogue 对话面板和 BGM 播放器
	if (function_exists('oblivions_is_active') && oblivions_is_active()) return false;
	if (empty($udata)) return true; // 安全回退：未加载用户数据时默认启用 / Safe fallback
	$tid = isset($udata['u_templateid']) ? intval($udata['u_templateid']) : 0;
	return ($tid === 0 || $tid === 2);
}

// BGM 数据准备 / BGM data preparation
// 返回结构化数组，HTML 渲染由 render_bgm_player() 负责
// Returns structured array; HTML rendering delegated to render_bgm_player()
function init_bgm($force_update=0)
{
	// BGM 功能开关：非支持模板直接返回 null / Feature toggle for BGM
	if (!is_rich_template_enabled()) {
		return null;
	}

	global $command,$gamecfg,$bgmname;
	global $default_volume,$event_bgm,$pls_bgm,$parea_bgm,$regular_bgm,$bgmbook,$bgmlist;

	global $pdata;
	extract($pdata,EXTR_REFS);
	$clbpara = get_clbpara($clbpara);

	# 初始化

	# 存在最优先的事件BGM队列
	if(isset($clbpara['event_bgmbook']))
	{
		# 检查是否需要更新播放列表
		if(array_diff($clbpara['bgmbook'],$clbpara['event_bgmbook']))
		{
			# 重置当前播放列表
			$clbpara['bgmbook'] = $clbpara['event_bgmbook'];
			$force_update = 1;
		}
	}
	# 存在次优先的地图BGM队列
	elseif(isset($clbpara['pls_bgmbook']))
	{
		# 检查是否需要更新播放列表
		if(array_diff($clbpara['bgmbook'],$clbpara['pls_bgmbook']))
		{
			# 重置当前播放列表
			$clbpara['bgmbook'] = $clbpara['pls_bgmbook'];
			$force_update = 1;
		}
	}
	# 检查是否需要更新默认BGM列表
	else
	{
		if(empty($clbpara['bgmbook']) || array_diff($clbpara['bgmbook'],$clbpara['valid_bgmbook']))
		{
			# 重置当前播放列表
			$clbpara['bgmbook'] = $clbpara['valid_bgmbook'];
			$force_update = 1;
		}
	}

	# 刷新页面或输入强制重载参数时，重载播放器
	if($command == 'enter' || $force_update)
	{
		$booklist = $bgmarr = Array();
		# 为播放列表中的曲集关联对应BGM名、链接与种类
		foreach($clbpara['bgmbook'] as $book)
		{
			foreach($bgmbook[$book] as $bgmid)
			{
				$bgmarr[$bgmid]['name'] = $bgmlist[$bgmid]['name'];
				$bgmarr[$bgmid]['url'] = $bgmlist[$bgmid]['url'];
				$bgmarr[$bgmid]['type'] = $bgmlist[$bgmid]['type'];
				$bgmarr[$bgmid]['id'] = $bgmid;
			}
		}
		# 计数当前播放队列中的BGM数
		$bgmnums = count($bgmarr)-1;
		# 初始化首位BGM
		shuffle($bgmarr);
		$bgmname = $bgmarr[0]['name'];
		$bgmlink = $bgmarr[0]['url'];
		$bgmtype = $bgmarr[0]['type'];
		$bgmid = $bgmarr[0]['id'];
		$json_bgmarr = json_encode($bgmarr);
		# 将当前播放的BGM编号保存于缓存内 留待以后用作播放记忆
		gsetcookie('nowbgmid',$bgmid,0,0);
		#初始化默认音量
		$volume = isset($_COOKIE["volume"]) ? filter_var($_COOKIE["volume"],FILTER_VALIDATE_FLOAT)*100 : $default_volume;
		$volume_r = isset($volume) ? round($volume/100,2) : round($default_volume/100,2);

		# 返回结构化数据 / Return structured data
		return array(
			'link' => $bgmlink,
			'type' => $bgmtype,
			'name' => $bgmname,
			'id' => $bgmid,
			'bgmarr_json' => $json_bgmarr,
			'volume' => $volume_r,
			'bgmnums' => $bgmnums,
		);
	}
	else
	{
		return null;
	}
}

// BGM 播放器 HTML 渲染 / Render BGM player HTML from structured data
// $bgm_data: init_bgm() 返回的结构化数组 / Structured array returned by init_bgm()
function render_bgm_player($bgm_data) {
	if (empty($bgm_data) || empty($bgm_data['link']) || empty($bgm_data['type'])) {
		return '';
	}
	$link = $bgm_data['link'];
	$type = $bgm_data['type'];
	$json_bgmarr = $bgm_data['bgmarr_json'];
	$volume_r = $bgm_data['volume'];

	return <<<EOT
			<audio id="gamebgm" autoplay controls="1" onplay="\$('gamebgm').volume=\$('nowbgmvolume').innerHTML;">
				<source id="gbgm" src="$link" type="$type">
			</audio>
			<div id="bgmlist">$json_bgmarr</div>
			<div id="nowbgm">0</div>
			<div id="nowbgmvolume">$volume_r</div>
			<script>
				gamebgm.addEventListener('ended', function () {
					changeBGM();
				}, false);
			</script>
EOT;
}

// 小地图渲染 / Minimap rendering
function init_mapdata(){
	global $pls,$plsinfo,$xyinfo,$hack,$arealist,$areanum,$areaadd;

	$mpp = Array();
	$mapvcoordinate = Array('A','B','C','D','E','F','G','H','I','J');
	for($i=0;$i<count($plsinfo);$i++)
	{
		if($hack || array_search($i,$arealist) > ($areanum + $areaadd)){
			$plscolor[$i] = 'minimapspanlime';
		} elseif(is_death_area($i)) {
			$plscolor[$i] = 'minimapspanred';
		} else {
			$plscolor[$i] = 'minimapspanyellow';
		}
		$position=explode('-',$xyinfo[$i]);
		$mpp[$position[0]][$position[1]]=$i;
	}

	$mapcontent = '<TABLE border="1" cellspacing="0" cellpadding="0" background="map/neomap.jpg" style="background-size:478px 418px;position:relative;background-repeat:no-repeat;background-position:right bottom;">';
	$mapcontent .= '<TR align="center"><TD colspan="11" height="24" class=b1 align=center>战场地图</TD></TR>';
	$mapcontent .= '<TR align="center">
			<TD width="42" height="36" class=map align=center><div class=nttx>坐标</div></TD>';
	for($x=1;$x<=10;$x++)
	{
		$mapcontent .= '<TD width="42" height="36" class=map align=center><div class=nttx>'.$x.'</div></TD>';
	}
	$mapcontent .= '</TR>';
	for($i=0;$i<10;$i++){
		$mapcontent .= '<tr align="center"><TD class=map align=center><div class=nttx>'.$mapvcoordinate[$i].'</div></TD>';
		for($j=1;$j<=10;$j++){
			if(isset($mpp[$mapvcoordinate[$i]][$j]))
			{
				$mapcontent .="<td width=\"42\" height=\"36\" class=\"map2\" align=\"middle\"><a onclick=\"closeDialog($('terminal'));$('mode').value='command';$('command').value='move';$('moveto').value='{$mpp[$mapvcoordinate[$i]][$j]}';postCmd('gamecmd','command.php');this.disabled=true;\"><span class=\"{$plscolor[$mpp[$mapvcoordinate[$i]][$j]]}\">{$plsinfo[$mpp[$mapvcoordinate[$i]][$j]]}</span></a></td>";
			}else{
				$mapcontent .= '<td width="42" height="36" class="map2" align=middle><IMG src="map/blank.gif" width="42" height="36" border=0></td>';
			}
		}
		$mapcontent .= '</tr>';
	}
	$mapcontent .= '</table>';
	return $mapcontent;
}

// 社团技能模板选择 / Club skill template selection
function init_clubskillsdata($sk,$data)
{
	global $cskills;
	$sk_dir = 'skill_'.$sk;
	# 本地存在对应的技能模板，返回模板
	if(file_exists(GAME_ROOT."./templates/default/".$sk_dir.".htm"))
	{
		return Array($sk_dir);
	}
	# 本地不存在模板，按照预设信息生成一个
	elseif(array_key_exists($sk,$cskills))
	{
		return $sk;
	}
	return 0;
}