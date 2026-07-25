/**
 * @module M 组合式函数
 * @framework M-1 租赁式动画架构
 */

import gsap from 'gsap';
import {
  arriveAnim,
  attackAnim,
  fadeOut,
  fall,
  hitAnim,
  jumpActor,
  moveActor,
  popUp,
  resetPose,
  setDown,
  startIdle,
  transformAppearance,
  updateEntityZIndex,
} from '@/animations/actorAnimations';
import type {
  ActorChannel,
  ActorCommand,
  ActorElements,
  ActorRuntime,
  AnimationHandle,
  AnimationResult,
  CueAnimationHandle,
  LeaseRequest,
  PresentationLease,
  PresentationOwner,
  RemovalDisposition,
} from '@/types/actor-runtime';
import type { SceneAnchor, ScenePoint } from '@/types/scene';
import { actorTraceEnabled, debugBus } from '@/composables/useDebugBus';
import { task3Debug } from '@/utils/task3-debug';

const OWNER_PRIORITY: Record<PresentationOwner, number> = {
  ambient: 0,
  world: 1,
  battle: 2,
  terminal: 3,
};

let nextGeneration = 1;

// ── K-12-F：动画播放速度同步（speed → gsap timeScale） ──
// 设计意图：speed（倍速）应该让动画本身的播放速度变快，
// 而不是只缩短 move-director 的超时兜底。
// 否则 speed=4 时 jump 动画仍需 1400ms，但 timeout 仅 375ms，
// 动画未完成就被超时打断 → cancel → 下一步从中间位置开始 → 落点错位。
// 解决：move-director.setSpeed 调用 setPlaybackSpeed，
// play() 创建 animation 后立即 animation.timeScale(playbackSpeed)。
let playbackSpeed = 1;

/** K-12-F：由 move-director.setSpeed 调用，同步 speed 到动画层 */
export function setPlaybackSpeed(speed: number): void {
  const prev = playbackSpeed;
  playbackSpeed = speed;
  if (prev !== speed) {
    task3Debug.log('actor-runtime.setPlaybackSpeed', { prevSpeed: prev, newSpeed: speed });
  }
}

function skippedHandle(reason: string): AnimationHandle {
  return {
    finished: Promise.resolve({ status: 'skipped', reason }),
    cancel: () => {},
  };
}

class TimelineHandle implements CueAnimationHandle {
  readonly finished: Promise<AnimationResult>;
  private resolveFinished!: (result: AnimationResult) => void;
  private readonly cuePromises = new Map<string, Promise<AnimationResult>>();
  private readonly cueResolvers = new Map<string, (result: AnimationResult) => void>();
  private settled = false;

  constructor(
    private readonly timeline: gsap.core.Animation,
    impactAt: number | null,
    private readonly onSettled: (result: AnimationResult) => void,
  ) {
    this.finished = new Promise(resolve => { this.resolveFinished = resolve; });
    this.timeline.eventCallback('onComplete', () => this.settle({ status: 'completed' }));
    if (impactAt !== null) {
      const promise = new Promise<AnimationResult>(resolve => {
        this.cueResolvers.set('impact', resolve);
      });
      this.cuePromises.set('impact', promise);
      (this.timeline as gsap.core.Timeline).call(() => {
        this.resolveCue('impact', { status: 'completed' });
      }, undefined, impactAt / 1000);
    }
  }

  cue(name: 'impact'): Promise<AnimationResult> {
    return this.cuePromises.get(name)
      ?? Promise.resolve({ status: 'skipped', reason: 'cue_unavailable' });
  }

  cancel(reason = 'cancelled'): void {
    if (this.settled) return;
    this.timeline.kill();
    this.settle({ status: 'cancelled', reason });
  }

  private resolveCue(name: string, result: AnimationResult): void {
    const resolve = this.cueResolvers.get(name);
    if (!resolve) return;
    this.cueResolvers.delete(name);
    resolve(result);
  }

  private settle(result: AnimationResult): void {
    if (this.settled) return;
    this.settled = true;
    for (const name of this.cueResolvers.keys()) this.resolveCue(name, result);
    this.resolveFinished(result);
    this.onSettled(result);
  }
}

class RuntimeLease implements PresentationLease {
  readonly channels = new Set<ActorChannel>();
  released = false;

  constructor(
    private readonly runtime: ActorRuntimeImpl,
    readonly owner: PresentationOwner,
    readonly sessionId: string | null,
    channels: readonly ActorChannel[],
  ) {
    this.addChannels(channels);
  }

  get actorId(): string {
    return this.runtime.id;
  }

  addChannels(channels: readonly ActorChannel[]): void {
    for (const channel of channels) this.channels.add(channel);
  }

  play(command: ActorCommand): AnimationHandle {
    if (this.released) return skippedHandle('lease_released');
    return this.runtime.play(this, command);
  }

  release(options: { reconcile?: boolean } = {}): void {
    this.runtime.releaseLease(this, options.reconcile !== false, 'released');
  }

  forceRelease(reconcile: boolean, reason: string): void {
    this.runtime.releaseLease(this, reconcile, reason);
  }
}

class ActorRuntimeImpl implements ActorRuntime {
  readonly generation = nextGeneration++;
  disposed = false;
  private elements: ActorElements | null = null;
  private readonly channelOwners = new Map<ActorChannel, RuntimeLease>();
  private readonly leases = new Set<RuntimeLease>();
  private readonly channelHandles = new Map<ActorChannel, AnimationHandle>();
  private readonly debugCommands = new Map<AnimationHandle, { label: string; sessionId: string | null }>();
  private pendingAnchor: SceneAnchor | null = null;
  private currentAnchor: SceneAnchor | null = null;
  private terminal = false;
  private down = false;
  private removalDisposition: RemovalDisposition = 'projected';
  private readonly battleExitSessions = new Set<string>();

  constructor(readonly id: string) {}

  setElements(elements: ActorElements | null): void {
    if (elements && this.elements
      && this.elements.anchor === elements.anchor
      && this.elements.action === elements.action
      && this.elements.visibility === elements.visibility
      && this.elements.pose === elements.pose) return;
    this.elements = elements;
    if (!elements) return;
    gsap.set(elements.action, { x: 0, y: 0 });
    if (this.down) setDown(elements);
    else gsap.set(elements.pose, { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 });
    if (this.currentAnchor) this.writeAnchor(this.currentAnchor);
    this.renderDebugLabel();
  }

  acquire(request: LeaseRequest): PresentationLease | null {
    if (this.disposed) {
      task3Debug.log('actor-runtime.acquire.failed', {
        actorId: this.id,
        reason: 'runtime disposed',
        owner: request.owner,
        channels: request.channels,
        sessionId: request.sessionId ?? null,
      });
      return null;
    }
    const sessionId = request.sessionId ?? null;
    const sameLease = [...this.leases].find(lease =>
      !lease.released && lease.owner === request.owner && lease.sessionId === sessionId);
    const conflicts = new Set<RuntimeLease>();
    for (const channel of request.channels) {
      const owner = this.channelOwners.get(channel);
      if (owner && owner !== sameLease) conflicts.add(owner);
    }
    for (const conflict of conflicts) {
      const conflictPriority = OWNER_PRIORITY[conflict.owner];
      const requestPriority = OWNER_PRIORITY[request.owner];
      const canReplaceEqual = request.replaceEqualOwner === true
        && conflict.owner === request.owner;
      if (conflictPriority > requestPriority
        || (conflictPriority === requestPriority && !canReplaceEqual)) {
        task3Debug.log('actor-runtime.acquire.failed', {
          actorId: this.id,
          reason: 'priority conflict',
          owner: request.owner,
          channels: request.channels,
          sessionId,
          conflictOwner: conflict.owner,
          conflictPriority,
          requestPriority,
          canReplaceEqual,
        });
        return null;
      }
    }
    for (const conflict of conflicts) conflict.forceRelease(false, 'preempted');

    const lease = sameLease ?? new RuntimeLease(this, request.owner, sessionId, []);
    lease.addChannels(request.channels);
    this.leases.add(lease);
    for (const channel of request.channels) this.channelOwners.set(channel, lease);
    task3Debug.log('actor-runtime.acquire.success', {
      actorId: this.id,
      owner: request.owner,
      channels: [...request.channels],
      sessionId,
      generation: this.generation,
      reusedSameLease: sameLease === lease,
    });
    return lease;
  }

  projectAnchor(anchor: SceneAnchor): void {
    if (this.disposed) return;
    if (this.channelOwners.has('spatial')) {
      this.pendingAnchor = anchor;
      return;
    }
    this.currentAnchor = anchor;
    this.pendingAnchor = null;
    this.writeAnchor(anchor);
  }

  getProjectedAnchor(): SceneAnchor | null {
    return this.pendingAnchor ?? this.currentAnchor;
  }

  getScenePoint(): ScenePoint | null {
    if (!this.elements) return this.currentAnchor?.point ?? null;
    return {
      space: 'scene',
      x: Number(gsap.getProperty(this.elements.anchor, 'x')) || 0,
      y: Number(gsap.getProperty(this.elements.anchor, 'y')) || 0,
    };
  }

  setFacing(direction: 'left' | 'right'): void {
    const pose = this.elements?.pose;
    if (!pose) return;
    pose.classList.toggle('facing-right', direction === 'right');
  }

  markTerminal(): void {
    this.terminal = true;
  }

  settleTerminalPresentation(): void {
    this.terminal = true;
    this.down = true;
    if (this.elements) setDown(this.elements);
  }

  markDown(): void {
    this.down = true;
  }

  markStanding(): void {
    this.down = false;
  }

  recoverPresentation(): void {
    this.terminal = false;
    this.removalDisposition = 'projected';
    this.battleExitSessions.clear();
    if (!this.elements) return;
    gsap.killTweensOf(this.elements.action);
    gsap.killTweensOf(this.elements.visibility);
    gsap.killTweensOf(this.elements.pose);
    gsap.set(this.elements.action, { x: 0, y: 0 });
    gsap.set(this.elements.visibility, { alpha: 1 });
    if (this.down) setDown(this.elements);
    else {
      gsap.set(this.elements.pose, { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 });
      this.restoreIdle();
    }
  }

  markRemovalAnimated(sessionId: string): void {
    this.removalDisposition = 'animated';
    void sessionId;
  }

  markBattleExitAnimated(sessionId: string): void {
    this.battleExitSessions.add(sessionId);
  }

  consumeBattleExitAnimated(sessionId: string): boolean {
    const exists = this.battleExitSessions.has(sessionId);
    this.battleExitSessions.delete(sessionId);
    return exists;
  }

  consumeRemovalDisposition(): RemovalDisposition {
    if (this.battleExitSessions.size > 0) {
      this.battleExitSessions.clear();
      this.removalDisposition = 'immediate';
      return 'animated';
    }
    const disposition = this.removalDisposition;
    this.removalDisposition = 'immediate';
    return disposition;
  }

  play(lease: RuntimeLease, command: ActorCommand): AnimationHandle {
    const elements = this.elements;
    if (!elements) {
      task3Debug.log('actor-runtime.play.skipped', {
        actorId: this.id,
        commandKind: command.kind,
        reason: 'actor_dom_missing',
        generation: this.generation,
      });
      this.traceAnimation(command.kind, 'skipped', 'actor_dom_missing');
      return skippedHandle('actor_dom_missing');
    }
    const required = requiredChannels(command);
    if (required.some(channel => !lease.channels.has(channel) || this.channelOwners.get(channel) !== lease)) {
      task3Debug.log('actor-runtime.play.skipped', {
        actorId: this.id,
        commandKind: command.kind,
        reason: 'lease_channel_missing',
        requiredChannels: required,
        leaseChannels: [...lease.channels],
        generation: this.generation,
      });
      this.traceAnimation(command.kind, 'skipped', 'lease_channel_missing');
      return skippedHandle('lease_channel_missing');
    }
    this.cancelChannels(required, 'replaced');
    this.traceAnimation(command.kind, 'start');

    let animation: gsap.core.Animation;
    let impactAt: number | null = null;
    let onCompleted: (() => void) | null = null;
    switch (command.kind) {
      case 'idle':
        animation = startIdle(elements.pose);
        break;
      case 'enter':
        setDown(elements);
        animation = popUp(elements);
        break;
      case 'arrive':
        animation = arriveAnim(elements);
        break;
      case 'transform-appearance':
        animation = transformAppearance(elements.pose, command.swap);
        break;
      case 'reset-pose':
        animation = resetPose(elements.pose);
        break;
      case 'move': {
        const from = this.getScenePoint();
        const target = command.target.point;
        gsap.set(elements.anchor, {
          width: command.target.cellWidth,
          height: command.target.cellHeight,
          xPercent: -50,
          yPercent: -100,
        });
        if (from && target.x > from.x) this.setFacing('right');
        else if (from && target.x < from.x) this.setFacing('left');
        const direction: -1 | 0 | 1 = !from || target.x === from.x ? 0 : target.x < from.x ? -1 : 1;
        if (command.tier === 'long') {
          gsap.set(elements.anchor, { x: target.x, y: target.y });
          updateEntityZIndex(elements.anchor);
          animation = arriveAnim(elements);
        } else if (command.tier === 'jump') {
          animation = jumpActor(
            elements,
            target.x,
            target.y,
            command.target.cellHeight,
            command.onTravelProgress,
          );
        } else {
          animation = moveActor(
            elements.anchor,
            elements.pose,
            target.x,
            target.y,
            direction,
          );
        }
        task3Debug.log('actor-runtime.play.move-tween-start', {
          actorId: this.id,
          tier: command.tier,
          fromPoint: from,
          targetPoint: { x: target.x, y: target.y },
          cellWidth: command.target.cellWidth,
          cellHeight: command.target.cellHeight,
          direction,
          generation: this.generation,
        });
        onCompleted = () => { this.currentAnchor = command.target; };
        break;
      }
      case 'attack': {
        const from = this.getScenePoint() ?? { space: 'scene' as const, x: 0, y: 0 };
        if (command.target?.x !== undefined) {
          if (command.target.x > from.x) this.setFacing('right');
          else if (command.target.x < from.x) this.setFacing('left');
        }
        const attack = attackAnim(elements.action, elements.pose, from, command.target, command.attackKind);
        animation = attack.timeline;
        impactAt = attack.impactAt;
        break;
      }
      case 'hit':
        animation = hitAnim(elements.action, elements.pose, command.direction);
        break;
      case 'fall':
        this.down = true;
        animation = fall(elements);
        break;
      case 'fade':
        animation = fadeOut(elements.visibility);
        break;
      case 'reset-visible':
        animation = gsap.timeline().to(elements.visibility, { alpha: 1, duration: 0.18, ease: 'power1.out' });
        break;
    }

    // K-12-F：应用倍速——让动画本身的播放速度变快（timeScale），
    // 而不是只缩短 move-director 的超时兜底。
    // 这样 jump 动画在 speed=4 时只需 1400/4 = 350ms，与 timeout 475ms 匹配。
    if (playbackSpeed !== 1) {
      animation.timeScale(playbackSpeed);
    }
    task3Debug.log('actor-runtime.play.timeScale-applied', {
      actorId: this.id,
      commandKind: command.kind,
      playbackSpeed,
      note: playbackSpeed !== 1 ? 'animation.timeScale(speed) applied' : 'speed=1, no timeScale needed',
    });

    let handle!: TimelineHandle;
    handle = new TimelineHandle(animation, impactAt, result => {
      if (result.status === 'completed') onCompleted?.();
      task3Debug.log('actor-runtime.tween-settled', {
        actorId: this.id,
        commandKind: command.kind,
        status: result.status,
        reason: result.reason ?? null,
        generation: this.generation,
        playbackSpeed,
        note: result.status === 'completed'
          ? 'gsap tween onComplete'
          : result.status === 'cancelled'
            ? 'gsap tween killed (onInterrupt/onKill)'
            : 'skipped',
      });
      this.traceAnimation(command.kind, result.status, result.reason);
      this.removeHandle(handle);
      this.debugCommands.delete(handle);
      this.renderDebugLabel();
    });
    for (const channel of required) this.channelHandles.set(channel, handle);
    this.debugCommands.set(handle, {
      label: `${lease.owner} / ${debugCommandName(command)}`,
      sessionId: lease.sessionId,
    });
    this.renderDebugLabel();
    return handle;
  }

  releaseLease(lease: RuntimeLease, reconcile: boolean, reason: string): void {
    if (lease.released) return;
    lease.released = true;
    const channels = [...lease.channels].filter(channel => this.channelOwners.get(channel) === lease);
    task3Debug.log('actor-runtime.releaseLease', {
      actorId: this.id,
      owner: lease.owner,
      sessionId: lease.sessionId,
      channels,
      reconcile,
      reason,
      generation: this.generation,
      hasPendingAnchor: !!this.pendingAnchor,
    });
    this.cancelChannels(channels, reason);
    for (const channel of channels) this.channelOwners.delete(channel);
    this.leases.delete(lease);

    if (reconcile && channels.includes('spatial') && this.pendingAnchor) {
      const next = this.pendingAnchor;
      this.pendingAnchor = null;
      this.currentAnchor = next;
      this.writeAnchor(next);
    }
    if (!this.terminal && !this.down && lease.owner !== 'ambient' && channels.includes('pose') && !this.channelOwners.has('pose')) {
      this.restoreIdle();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const lease of [...this.leases]) this.releaseLease(lease, false, 'disposed');
    this.cancelChannels(['spatial', 'action', 'visibility', 'pose'], 'disposed');
    this.elements = null;
    this.pendingAnchor = null;
  }

  private traceAnimation(command: ActorCommand['kind'], status: string, reason?: string): void {
    if (!actorTraceEnabled) return;
    debugBus.emit('actor-runtime', 'animation', {
      actorId: this.id,
      generation: this.generation,
      command,
      status,
      reason: reason ?? null,
      disposed: this.disposed,
      hasElements: Boolean(this.elements),
      isConnected: this.elements?.anchor.isConnected ?? false,
      visibilityAlpha: this.elements
        ? Number(gsap.getProperty(this.elements.visibility, 'opacity'))
        : null,
    });
  }

  private restoreIdle(): void {
    if (!this.elements || this.disposed || this.terminal || this.down || this.channelOwners.has('pose')) return;
    const lease = this.acquire({ owner: 'ambient', channels: ['pose'], sessionId: `ambient:${this.generation}` });
    lease?.play({ kind: 'idle' });
  }

  private cancelChannels(channels: readonly ActorChannel[], reason: string): void {
    const handles = new Set<AnimationHandle>();
    for (const channel of channels) {
      const handle = this.channelHandles.get(channel);
      if (handle) handles.add(handle);
    }
    for (const handle of handles) handle.cancel(reason);
  }

  private removeHandle(handle: AnimationHandle): void {
    for (const [channel, current] of this.channelHandles) {
      if (current === handle) this.channelHandles.delete(channel);
    }
  }

  private renderDebugLabel(): void {
    const label = this.elements?.debugLabel;
    if (!label) return;
    const commands = [...this.debugCommands.values()];
    const active = commands.length > 0 ? commands[commands.length - 1] : null;
    label.textContent = active?.label ?? '';
    label.hidden = active === null;
    if (active?.sessionId) label.title = active.sessionId;
    else label.removeAttribute('title');
  }

  private writeAnchor(anchor: SceneAnchor): void {
    if (!this.elements) return;
    gsap.set(this.elements.anchor, {
      width: anchor.cellWidth,
      height: anchor.cellHeight,
      x: anchor.point.x,
      y: anchor.point.y,
      xPercent: -50,
      yPercent: -100,
    });
    updateEntityZIndex(this.elements.anchor);
  }
}

function debugCommandName(command: ActorCommand): string {
  if (command.kind === 'move') return `move:${command.tier}`;
  if (command.kind === 'attack') return `attack:${command.attackKind}`;
  return command.kind;
}

function requiredChannels(command: ActorCommand): ActorChannel[] {
  switch (command.kind) {
    case 'idle': return ['pose'];
    case 'enter':
    case 'arrive':
    case 'fall': return ['pose', 'visibility'];
    case 'transform-appearance': return ['pose'];
    case 'reset-pose': return ['pose'];
    case 'move': return command.tier === 'long'
      ? ['spatial', 'pose', 'visibility']
      : ['spatial', 'pose'];
    case 'attack':
    case 'hit': return ['action', 'pose'];
    case 'fade':
    case 'reset-visible': return ['visibility'];
  }
}

export function createActorRuntime(id: string): ActorRuntime {
  return new ActorRuntimeImpl(id);
}

export function isCueAnimationHandle(handle: AnimationHandle): handle is CueAnimationHandle {
  return typeof (handle as CueAnimationHandle).cue === 'function';
}
