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
  const debugFlagsModule = await server.ssrLoadModule('/src/utils/debug-flags.ts');
  const debugCases = [
    ['?debug=ai', 'ai'],
    ['?debug=actor,labels', 'actor,labels'],
    ['?debug=ai&debug=error-poll', 'ai,error-poll'],
    ['?debug=unknown,labels', 'labels'],
    ['?debug=all', 'actor,ai,error-poll,labels'],
  ];
  for (const [search, expected] of debugCases) {
    const actual = [...debugFlagsModule.parseDebugFlags(search)].sort().join(',');
    if (actual !== expected) throw new Error(`debug flags mismatch for ${search}: ${actual}`);
  }
  const aimLineGeometry = await server.ssrLoadModule('/src/utils/aim-line-geometry.ts');
  const rightwardAim = aimLineGeometry.buildAimLineGeometry(0, 0, 100, 0);
  if (!rightwardAim.pathData.includes('C 22 -12,')) {
    throw new Error(`rightward aim curve mismatch: ${rightwardAim.pathData}`);
  }
  if (!(rightwardAim.arrowAngle > 5 && rightwardAim.arrowAngle < 8)) {
    throw new Error(`rightward aim arrow angle mismatch: ${rightwardAim.arrowAngle}`);
  }
  const arrowGapDistance = Math.hypot(
    100 - rightwardAim.lineEndX,
    0 - rightwardAim.lineEndY,
  );
  if (Math.abs(arrowGapDistance - 23) > 0.001 || rightwardAim.pathData.endsWith('100 0')) {
    throw new Error(`aim line did not stop before arrow: ${rightwardAim.pathData}`);
  }
  const stationaryAim = aimLineGeometry.buildAimLineGeometry(10, 20, 10, 20);
  if (stationaryAim.pathData !== 'M 10 20 L 10 20' || stationaryAim.arrowAngle !== 0) {
    throw new Error('stationary aim geometry mismatch');
  }
  const fixture = await server.ssrLoadModule('/src/stores/battle-director-v2.fixture.ts');
  fixture.assertBattleDirectorV2Fixture();
  const actorRuntimeFixture = await server.ssrLoadModule('/src/stores/actor-runtime.fixture.ts');
  actorRuntimeFixture.assertActorRuntimeContractFixture();
  actorRuntimeFixture.assertMapSceneGeometryFixture();
  await actorRuntimeFixture.assertPostCombatHandoffRunFixture();
  await actorRuntimeFixture.assertPresentationRebaseMoveFixture();
  actorRuntimeFixture.assertCharacterMapRosterFixture();
  actorRuntimeFixture.assertPresentationClaimFixture();
  await actorRuntimeFixture.assertProjectedRemovalRediscoveryFixture();
  actorRuntimeFixture.assertQidChangeSessionOwnershipFixture();
  await actorRuntimeFixture.assertDataManagerRefreshContractFixture();
  await actorRuntimeFixture.assertPlaybackSceneGuardFixture();
  await actorRuntimeFixture.assertPlaybackTimeoutCancellationFixture();
  await actorRuntimeFixture.assertBattleEndParallelBarrierFixture();
  const uiPolicy = await server.ssrLoadModule('/src/stores/battle-ui-policy.ts');
  const commandCapability = await server.ssrLoadModule('/src/stores/command-capability.fixture.ts');
  commandCapability.assertCommandCapabilityFixture();
  await commandCapability.assertCommandReactiveLockFixture();
  const aimTargeting = await server.ssrLoadModule('/src/stores/aim-targeting.fixture.ts');
  await aimTargeting.assertAimTargetingFixture();
  const scopes = new uiPolicy.PendingAuthorityScopes();
  scopes.record(['game_map', 'combat_targets']);
  scopes.record(['enemies', 'game_map']);
  const pendingScopes = scopes.take().sort().join(',');
  if (pendingScopes !== 'combat_targets,enemies,game_map') throw new Error('pending authority scopes did not accumulate');
  if (scopes.take().length !== 0) throw new Error('pending authority scopes were not consumed atomically');
  if (uiPolicy.shouldCommitBattleVisualState('battle', 'PROCESSING')) throw new Error('PROCESSING visual state committed early');
  if (!uiPolicy.shouldCommitBattleVisualState('battle', 'PLAYER_TURN')) throw new Error('PLAYER_TURN visual state not committed');
  if (!uiPolicy.shouldCommitBattleVisualState('', 'IDLE')) throw new Error('IDLE visual state not committed');
  const drainOrder = [];
  const drainStates = ['PROCESSING', 'IDLE'];
  const drainResult = await uiPolicy.drainBattleTicksToStable({
    maxCycles: 4,
    advance: async () => {
      drainOrder.push('heartbeat');
      return { state: drainStates.shift() ?? 'IDLE' };
    },
    playPending: async () => { drainOrder.push('play'); },
    isProcessing: snapshot => snapshot.state === 'PROCESSING',
  });
  if (drainResult.status !== 'stable' || drainResult.cycles !== 2) {
    throw new Error('battle drain did not reach the expected stable snapshot');
  }
  if (drainOrder.join(',') !== 'heartbeat,play,heartbeat,play') {
    throw new Error('battle drain committed before heartbeat-generated logs were played');
  }
  if (uiPolicy.isBattleMapInputLocked({ currentMode: 'battle', isPlayingBattleLog: true, isProcessingBattle: true, presentationPhase: 'playing' })) {
    throw new Error('map input remained globally locked during battle playback');
  }
  if (!uiPolicy.isBattleMapInputLocked({ currentMode: 'normal', isPlayingBattleLog: false, isProcessingBattle: false, presentationPhase: 'rebasing' })) {
    throw new Error('presentation rebase map input not locked');
  }
  if (!uiPolicy.isSilentMapCommandLock('PRESENTATION_NOT_CAUGHT_UP') || uiPolicy.isSilentMapCommandLock('COOLDOWN')) {
    throw new Error('silent map command lock classification mismatch');
  }
  const presentationSceneModule = await server.ssrLoadModule('/src/stores/presentation-scene.ts');
  const entity = (id, pgroup, pls) => ({ id, kind: 'actor', pgroup, pls, img: '' });
  const exits = [
    { actorId: 'same', generation: 1, reason: 'escaped', from: { pgroup: 1, pls: 2 }, fromPoint: null, retreatTarget: null },
    { actorId: 'retreat', generation: 2, reason: 'escaped', from: { pgroup: 1, pls: 2 }, fromPoint: null, retreatTarget: { pgroup: 1, pls: 3 } },
    { actorId: 'relocate', generation: 3, reason: 'escaped', from: { pgroup: 1, pls: 2 }, fromPoint: null, retreatTarget: null },
    { actorId: 'removed', generation: 4, reason: 'escaped', from: { pgroup: 1, pls: 2 }, fromPoint: null, retreatTarget: null },
  ];
  const handoffs = presentationSceneModule.derivePostCombatHandoffs(exits, [
    entity('same', 1, 2), entity('retreat', 1, 3), entity('relocate', 2, 9),
  ]);
  const policies = handoffs.map(item => item.visualPolicy).join(',');
  if (policies !== 'settle-in-place,retreat,hidden-relocate-arrive,remove') {
    throw new Error(`post-combat handoff policy mismatch: ${policies}`);
  }
  const inboxModule = await server.ssrLoadModule('/src/stores/presentation-inbox.ts');
  const inbox = inboxModule.presentationInbox;
  inbox.reset();
  inbox.initialize(1);
  inbox.enqueueResponse({ presentation_head_seq: 3 });
  if (inbox.gapHead !== 3) throw new Error('presentation gap was not detected');
  inbox.commitGap(3);
  const accepted = inbox.enqueueResponse({
    presentation_head_seq: 4,
    presentation: { schema: 'presentation.v1', batch_seq: 4, groomid: 1, recipient_pid: 1, qid: null, request_id: 'fixture', tick: 1, state_after: {}, events: [] },
  });
  const duplicateAccepted = inbox.enqueueResponse({
    presentation_head_seq: 4,
    presentation: { schema: 'presentation.v1', batch_seq: 4, groomid: 1, recipient_pid: 1, qid: null, request_id: 'fixture', tick: 1, state_after: {}, events: [] },
  });
  if (!accepted || duplicateAccepted) throw new Error('presentation inbox claim result mismatch');
  if (inbox.peekNext()?.batch_seq !== 4) throw new Error('presentation inbox lost contiguous batch');
  inbox.commit(4);
  if (inbox.peekNext() !== null) throw new Error('presentation inbox dedupe failed');
  inbox.reset();
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
  console.log('battle director, actor runtime, scene geometry, visual barrier, input policy, and combat targeting fixtures passed');
} finally {
  await server.close();
}
