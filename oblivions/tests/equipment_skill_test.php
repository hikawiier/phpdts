<?php
declare(strict_types=1);

return static function (TestRoom $room): array {
    return test_run_cases('equipment_skill', [
        'throw_definition_declares_equipment_grant' => static function (): void {
            $definition = skill_get_definition('throw');
            test_same('equipment', $definition['lifetime'] ?? null, 'throw remains an equipment skill');
            test_same(['wep', 'wep2'], $definition['equipment_grant']['slots'] ?? null, 'throw checks both weapon slots');
            test_same(['tag_weapon_throwing'], $definition['equipment_grant']['any_tags'] ?? null, 'throw uses the throwing weapon tag');
            test_same(['WC'], $definition['equipment_grant']['any_kinds'] ?? null, 'throw keeps WC runtime compatibility');
        },
        'throwing_weapon_injects_throw_into_skill_list' => static function (): void {
            $skillpara = [];
            skill_format_skillpara($skillpara);
            $actor = [
                'wepid' => 'throwing_spear', 'wepk' => 'WC',
                'wep2id' => '', 'wep2k' => '',
                'skillpara' => &$skillpara,
                'ap' => 10, 'max_ap' => 10, 'pgroup' => 1, 'pls' => 1,
            ];
            skill_inject_equipment($skillpara, $actor);
            test_assert(isset($skillpara['throw']), 'throwing spear did not inject throw');
            $actor['skillpara'] = $skillpara;
            $ids = array_column(skill_get_available_list($actor), 'act_id');
            test_assert(in_array('throw', $ids, true), 'available skill list omitted injected throw');
        },
        'secondary_throwing_weapon_and_kind_fallback_are_supported' => static function (): void {
            $skillpara = [];
            $actor = [
                'wepid' => 'rusty_pipe', 'wepk' => 'WP',
                'wep2id' => '', 'wep2k' => 'WC',
            ];
            skill_inject_equipment($skillpara, $actor);
            test_assert(isset($skillpara['throw']), 'WC secondary weapon did not inject throw');
        },
        'ordinary_weapon_does_not_inject_throw' => static function (): void {
            $skillpara = [];
            $actor = [
                'wepid' => 'rusty_pipe', 'wepk' => 'WP',
                'wep2id' => '', 'wep2k' => '',
            ];
            skill_inject_equipment($skillpara, $actor);
            test_assert(!isset($skillpara['throw']), 'ordinary weapon incorrectly injected throw');
        },
    ]);
};
