<?php

	if(!defined('IN_GAME')) exit('Access Denied');
	
	//码语行人配置文件
	
	//各个属性比率
	$itmsk_extract_rate = array(
		'A' => 150,
		'a' => 150,
		'B' => 450,
		'b' => 450,
		'C' => 60,
		'c' => 20,
		'D' => 80,
		'd' => 150,
		'E' => 30,
		'e' => 50,
		'F' => 60,
		'f' => 150,
		'G' => 60,
		'g' => 5,
		'H' => 120,
		'h' => 1500,
		'I' => 30,
		'i' => 50,
		'J' => 200,
		'j' => 200,
		'K' => 60,
		'k' => 150,
		'L' => 50,
		'l' => 5,
		'M' => 120,
		'm' => 120,
		'N' => 180,
		'n' => 300,
		'o' => 5,
		'P' => 60,
		'p' => 50,
		'q' => 30,
		'R' => 100,
		'r' => 220,
		'S' => 20,
		's' => 200,
		'U' => 30,
		'u' => 50,
		'V' => 100,
		'v' => 100,
		'W' => 30,
		'w' => 50,
		'X' => 800,
		'x' => 80,
		'y' => 320,
		'Z' => 100,
		'z' => 1,
		'-' => 5001,
		'*' => 5001,
		'+' => 5001,
		'^' => 1200,
		'🧰' => 800,
		'🍎' => 1000
	);

	//物品效果和耐久的场合：按照1：1比率消耗体力进行提取
	$itms_extract_rate = 1; //耐久
	$itms_infinite_extract_rate = 50; //无限耐久
	$itme_extract_rate = 1; //效果

	//插入代码片段
	$insert_rate = 50;
	//合并代码片段
	$merge_rate = 0;

	//名称提取时的候选字段范围，每局游戏会在其中随机挑选出部分字段
	$item_name_fragment_list = Array(
		//0级字段
		0 => Array('电磁','脉冲','沙漠','手枪','RPG','手套','龙','灵使','盟军','救世','布偶','小型','辐射','镰刀','地板','青蛙','半身像','御姐','腿','杏仁豆腐','希望','电子','太鼓','棍棒','[+1]','[+2]','[+3]','装甲','实验','太刀','骷髅','被封印者的','死灵','吸血鬼','领主','巨大','冲锋','扭曲','蓝白','操控','火神','音波','激光','带翅膀的','桔黄色的','王国','午夜','垃圾','焦臭的','微温的','开孔的','泥泞的','变形的','裂缝的','潮湿的','遥控','原型','普通的','对魔物用','二重','黑魔法','寂寞','节操','防弹','埃克法','木制','超级','爆炸','破坏之','星尘','梦想','光束'),
		//1级字段
		1 => Array('飞刀','怪蜀黍','水晶','雪兔','金属','弹射','首领','恶魔','霍普','宝石','细剑','片翼','[+4]','[+5]','德古拉','曾经的','荣光','大口径','水滴','彩色','未知','喵喵','奇迹','钓鱼','高压','高性能','贯穿','连射','震荡','幻之','永恒之','约定','黎明','寻星','勇者','冰封的','直升机','玄人的','断钢','火焰','9mm','标本','波纹','军用','真空','诅咒','荆棘','至尊','西瓜','红石','血腥','幽灵','凤凰','露琪亚','坚强','炙热','活力','风神','凭依','英雄','反坦克','太极','迷你','太阳','飞叶','公主','可怕的'),
		//2级字段
		2 => Array('机械','铁拳','彩虹','临摹','狐狸','巫师','未完成','丝带','超次元','蔷薇','大师','[+6]','天空','巨神','二向箔','神之','乱入','传说中的','心灵','风魔','强袭','闪击','达人的','铁锤','女王的','精装','拳王之','黄金','肯德基','麦当劳','东洋','燕返','传家','古典','高级','钻石','正宗','萝莉','伪娘','女仆','宅男','光学迷彩','塑料','性感的','新华里','超能力','天使','狂暴','妖精','LOVELOVE','悔悟','烈焰','流转','轮回','生命','未来','恐惧的','失落的','灭亡','黑暗','终结','爆裂','试作型','限量版','阔剑','巴雷特','奇怪的','波动','认真收集的','无尽','断罪','破灭','武神','世界'),
		//3级字段，福袋里出来的都记到这边吧
		3 => Array('最终','灼眼','正直者','原味','鱼的','勇气','信仰','向日葵','贤者','无限','铁兽战线','淘气仙星','死兆星','死亡','水月','霜火','神灭兵器','染血','琪露诺','破解的','秘旋谍','六根清净','炼狱','究极','究级','疾风','火灵天星','会打飞机的','幻月','海晶少女','篝酱','夺魂','动感超人','地球','创造神','MIKU的','205mm','[+9]','[+8]','[+7]','[+10]','（笑）','小马')
	);

	//字段每个等级的强化倍率
	$name_fragment_rate = Array(
		0 => 1.01,
		1 => 1.15,
		2 => 1.6,
		3 => 3
	);

	//每局游戏放出的每个等级字段的数量
	$name_fragment_available_num = Array(
		0 => 45,
		1 => 30,
		2 => 30,
		3 => 20
	);

?>