/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactPriorityLevel} from './SchedulerWithReactIntegration';

import MAX_SIGNED_31_BIT_INT from './maxSigned31BitInt';

import {
  ImmediatePriority,
  UserBlockingPriority,
  NormalPriority,
  IdlePriority,
} from './SchedulerWithReactIntegration';

export type ExpirationTime = number;

export const NoWork = 0;
// TODO: Think of a better name for Never. The key difference with Idle is that
// Never work can be committed in an inconsistent state without tearing the UI.
// The main example is offscreen content, like a hidden subtree. So one possible
// name is Offscreen. However, it also includes dehydrated Suspense boundaries,
// which are inconsistent in the sense that they haven't finished yet, but
// aren't visibly inconsistent because the server rendered HTML matches what the
// hydrated tree would look like.
export const Never = 1;
// Idle is slightly higher priority than Never. It must completely finish in
// order to be consistent.
export const Idle = 2;
// Continuous Hydration is slightly higher than Idle and is used to increase
// priority of hover targets.
export const ContinuousHydration = 3;
export const Sync = MAX_SIGNED_31_BIT_INT;
export const Batched = Sync - 1;

// 10ms内的变动会有计算出相同的expirationTime
const UNIT_SIZE = 10;
const MAGIC_NUMBER_OFFSET = Batched - 1;

// 1 unit of expiration time represents 10ms.
// 一个单位的过期时间以10ms取整
export function msToExpirationTime(ms: number): ExpirationTime {
  // Always subtract from the offset so that we don't clash with the magic number for NoWork.
  // 通过计算偏移量来表明过期时间的优先级 ms越大表明可以推迟的更新时间点越远从而ExpirationTime值越小对应的优先级越低
  return MAGIC_NUMBER_OFFSET - ((ms / UNIT_SIZE) | 0);
}

// 过期时间转换为ms形式的时间
export function expirationTimeToMs(expirationTime: ExpirationTime): number {
  return (MAGIC_NUMBER_OFFSET - expirationTime) * UNIT_SIZE;
}

// 以precision为基准向上取整
function ceiling(num: number, precision: number): number {
  return (((num / precision) | 0) + 1) * precision;
}

function computeExpirationBucket(
  currentTime,
  expirationInMs,
  bucketSizeMs,
): ExpirationTime {
  return (
    MAGIC_NUMBER_OFFSET -
    ceiling(
      MAGIC_NUMBER_OFFSET - currentTime + expirationInMs / UNIT_SIZE,
      bucketSizeMs / UNIT_SIZE,
    )
  );
}

// TODO: This corresponds to Scheduler's NormalPriority, not LowPriority. Update
// the names to reflect.
export const LOW_PRIORITY_EXPIRATION = 5000;
export const LOW_PRIORITY_BATCH_SIZE = 250;

// 计算异步任务的优先级别
export function computeAsyncExpiration(
  currentTime: ExpirationTime,
): ExpirationTime {
  return computeExpirationBucket(
    currentTime,
    LOW_PRIORITY_EXPIRATION,
    LOW_PRIORITY_BATCH_SIZE,
  );
}

//TODO 计算Suspense组件的优先级 timeoutMs为请求任务的事件时长
export function computeSuspenseExpiration(
  currentTime: ExpirationTime,
  timeoutMs: number,
): ExpirationTime {
  // TODO: Should we warn if timeoutMs is lower than the normal pri expiration time?
  return computeExpirationBucket(
    currentTime,
    timeoutMs,
    LOW_PRIORITY_BATCH_SIZE,
  );
}

// We intentionally set a higher expiration time for interactive updates in
// dev than in production.
//
// If the main thread is being blocked so long that you hit the expiration,
// it's a problem that could be solved with better scheduling.
//
// People will be more likely to notice this and fix it with the long
// expiration time in development.
//
// In production we opt for better UX at the risk of masking scheduling
// problems, by expiring fast.
// 在一个差距很小的事件内触发的多个更新的 ExpirationTime值是一样的这样就有相同的优先级
// 生成环境中需要设置一个小的时间范围以获取更好的用户体验
export const HIGH_PRIORITY_EXPIRATION = __DEV__ ? 500 : 150;
// BATCH_SIZE100ms内的优先级一样
export const HIGH_PRIORITY_BATCH_SIZE = 100;

// 计算交互行为即高级别任务的过期时间
export function computeInteractiveExpiration(currentTime: ExpirationTime) {
  return computeExpirationBucket(
    currentTime,
    HIGH_PRIORITY_EXPIRATION,
    HIGH_PRIORITY_BATCH_SIZE,
  );
}

// 根据ExpirationTime返回react任务的级别
export function inferPriorityFromExpirationTime(
  currentTime: ExpirationTime,
  expirationTime: ExpirationTime,
): ReactPriorityLevel {
  if (expirationTime === Sync) {
    return ImmediatePriority;
  }
  if (expirationTime === Never || expirationTime === Idle) {
    return IdlePriority;
  }
  // 根据过期时间距离当前时间的差值来返回不同的优先级
  const msUntil =
    expirationTimeToMs(expirationTime) - expirationTimeToMs(currentTime);
  if (msUntil <= 0) {
    return ImmediatePriority;
  }
  // 高优先级为用户交互的级别
  if (msUntil <= HIGH_PRIORITY_EXPIRATION + HIGH_PRIORITY_BATCH_SIZE) {
    return UserBlockingPriority;
  }
  if (msUntil <= LOW_PRIORITY_EXPIRATION + LOW_PRIORITY_BATCH_SIZE) {
    return NormalPriority;
  }

  // TODO: Handle LowPriority

  // Assume anything lower has idle priority
  return IdlePriority;
}
