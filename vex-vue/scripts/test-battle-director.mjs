import { createServer } from 'vite';

globalThis.document = {
  createElement() {
    let text = '';
    return {
      appendChild(node) { text += String(node?.textContent ?? ''); },
      get innerHTML() {
        return text
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#39;');
      },
    };
  },
  createTextNode(value) {
    return { textContent: String(value ?? '') };
  },
};

const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const fixture = await server.ssrLoadModule('/src/stores/battle-director-v2.fixture.ts');
  fixture.assertBattleDirectorV2Fixture();
  const uiPolicy = await server.ssrLoadModule('/src/stores/battle-ui-policy.ts');
  const scopes = new uiPolicy.DeferredVisualScopes();
  scopes.record(['game_map', 'combat_targets']);
  scopes.record(['enemies', 'game_map']);
  const pendingScopes = scopes.snapshot().sort().join(',');
  if (pendingScopes !== 'combat_targets,enemies,game_map') throw new Error('deferred visual scopes did not accumulate');
  scopes.commit(['game_map']);
  if (scopes.snapshot().includes('game_map')) throw new Error('deferred visual scope commit failed');
  if (uiPolicy.shouldCommitBattleVisualState('battle', 'PROCESSING')) throw new Error('PROCESSING visual state committed early');
  if (!uiPolicy.shouldCommitBattleVisualState('battle', 'PLAYER_TURN')) throw new Error('PLAYER_TURN visual state not committed');
  if (!uiPolicy.shouldCommitBattleVisualState('', 'IDLE')) throw new Error('IDLE visual state not committed');
  if (!uiPolicy.isBattleMapInputLocked({ currentMode: 'battle', isPlayingBattleLog: false, isProcessingBattle: false })) {
    throw new Error('battle mode map input not locked');
  }
  if (!uiPolicy.isBattleMapInputLocked({ currentMode: 'normal', isPlayingBattleLog: true, isProcessingBattle: false })) {
    throw new Error('battle playback map input not locked');
  }
  if (!uiPolicy.isSilentMapCommandLock('BATTLE_LOG_PLAYING') || uiPolicy.isSilentMapCommandLock('COOLDOWN')) {
    throw new Error('silent map command lock classification mismatch');
  }
  const targeting = await server.ssrLoadModule('/src/utils/combat-targeting.ts');
  const characters = new Map([
    [2, { pid: 2, type: 1, state: 0 }],
    [3, { pid: 3, type: 1, state: 0 }],
    [4, { pid: 4, type: 1, state: 0 }],
    [5, { pid: 5, type: 1, state: 1 }],
  ]);
  const targets = {
    qid: 17,
    suggestedTargetPid: 2,
    candidates: [
      { pid: 2, relation: 'hostile', participation: 'member', selectable: true, reason: null, character: {} },
      { pid: 3, relation: 'hostile', participation: 'joinable', selectable: true, reason: null, character: {} },
      { pid: 4, relation: 'hostile', participation: 'blocked', selectable: false, reason: 'TARGET_BUSY', character: {} },
      { pid: 5, relation: 'hostile', participation: 'joinable', selectable: true, reason: null, character: {} },
      { pid: 6, relation: 'hostile', participation: 'joinable', selectable: true, reason: null, character: {} },
    ],
  };
  const getCharacter = pid => characters.get(pid);
  if (!targeting.findSelectableCombatTarget(targets, 17, 2, getCharacter)) throw new Error('member target rejected');
  if (!targeting.findSelectableCombatTarget(targets, 17, 3, getCharacter)) throw new Error('joinable target rejected');
  if (targeting.findSelectableCombatTarget(targets, 18, 2, getCharacter)) throw new Error('stale qid response accepted');
  if (targeting.findSelectableCombatTarget(targets, 17, 4, getCharacter)) throw new Error('blocked target accepted');
  if (targeting.findSelectableCombatTarget(targets, 17, 5, getCharacter)) throw new Error('dead CharacterHub target accepted');
  if (targeting.findSelectableCombatTarget(targets, 17, 6, getCharacter)) throw new Error('missing CharacterHub target accepted');
  console.log('battle director, visual barrier, input policy, and combat targeting fixtures passed');
} finally {
  await server.close();
}
