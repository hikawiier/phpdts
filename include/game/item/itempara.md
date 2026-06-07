I added ``$itmpara`` and all related logics and databased fields on 24-07-20, this field works the same as ``$clbpara`` but are on individual items instead.

With this field, an item can have special properties controlled by variable keys tied to an instance of the specific item.

Here I'll document all current ``$itmpara`` keys used / planned to use as of now:

``lore`` - Additional tooltips that'll shown alongside the existing ``gamedata/cache/tooltip_X.php`` - Not implemented for now. Applies to all items.

``AddDamagePercentage`` - Add a damage percentage multiplier, only works on weapons and talisman.

``AddDamageRaw`` - Add an amount of raw damage on the last part of damage calculation, only works on weapons and talisman.

``DecreaseDamagePercentage`` - Add a damage decrease percentage multiplier, only works on defense items and talisman.

``DecreaseDamageRaw`` - Add an amount of raw damage to decrease on the last part of damage calculation, only works on defense items and talisman.

``AddPlayerXXInCombat`` - Add an amount of raw stats XX when player is in combat. 

``AddPlayerXXInSearchMove`` - Add an amount of raw stats XX when player conducting searching / moving.

XX => ``mhp``, ``msp``, ``mss``, ``att``, ``def``, ``wp/k/g/c/d/f``, ``money``, ``rage``, etc. 

【May consider using just a minus value for decreasing those values, and do a check in Move/Search/Combat logic instead...?】

``IsPlatformItem`` - Denotes if the item is used as an "NPC-Platform" type item - Still implementing (24-07-21) - only works on usable item.

> A "NPC-Platform" item is an item that stores a series of prebuilt stats, it'll replace your stats with those stats when used - it can be temporary or prementant.

The following keys will apply:

> ``PlatformPlayerMode`` - ``0`` - Uses the values builtin ``$itmpara``, ``1`` - Unused for now. ``2`` - Grab values from player table by matching ``PlatformPlayerName`` and populate them. In case this value is ``2``, use ``PlatformPlayerPID`` instead of ``PlatformPlayerName``, obviously.
>
> ``PlatformPlayerName`` - players.sql -> ``name``.
>
> ``PlatformPlayerLvl`` - players.sql -> ``lvl``.
>
> ``PlatformPlayerMhp`` - players.sql -> ``mhp``.
>
> ``PlatformPlayerMsp`` - players.sql -> ``msp``.
>
> Etc. The basic structure of these key names remains the same. It'll cover all needed values to copy a player/NPC value to another player.
>
> ``PlatformIsTimed`` - If this item is timed - Timed NPC-Platforms will have an internal charge value that'll decrease with searching/moving.
>
> ``PlatformChargeBaseValue`` - The additional base value of a Timed Platform's charge value.

The following functions are still implementing (24-07-21)

``IsQuestItem`` - Denotes if the item is related to a Quest - When a Quest spawns this item, this key will be spawn alongside it.

``QuestOwnerID`` - Denotes the ``pid`` of the player that "owns" the quest, when a player accepts a quest that will result in a quest item, this key will spawn alongside it - conduct checks when processing those item logics to check if the user's ``pid`` matches with this key value.