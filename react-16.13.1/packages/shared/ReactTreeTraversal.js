/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {HostComponent} from './ReactWorkTags';

// 获取父级的react组件 主要是用于事件的冒泡阶段
function getParent(inst) {
  do {
    inst = inst.return;
    // TODO: If this is a HostRoot we might want to bail out.
    // That is depending on if we want nested subtrees (layers) to bubble
    // events to their parent. We could also go through parentNode on the
    // host node but that wouldn't work for React Native and doesn't let us
    // do the portal feature.
  } while (inst && inst.tag !== HostComponent);
  if (inst) {
    return inst;
  }
  return null;
}

/**
 * Return the lowest common ancestor of A and B, or null if they are in
 * different trees.
 * 返回A和B最低共同祖先
 */
export function getLowestCommonAncestor(instA, instB) {
  let depthA = 0;
  for (let tempA = instA; tempA; tempA = getParent(tempA)) {
    depthA++;
  }
  let depthB = 0;
  for (let tempB = instB; tempB; tempB = getParent(tempB)) {
    depthB++;
  }

  // If A is deeper, crawl up.
  while (depthA - depthB > 0) {
    instA = getParent(instA);
    depthA--;
  }

  // If B is deeper, crawl up.
  while (depthB - depthA > 0) {
    instB = getParent(instB);
    depthB--;
  }

  // Walk in lockstep until we find a match.
  let depth = depthA;
  while (depth--) {
    if (instA === instB || instA === instB.alternate) {
      return instA;
    }
    instA = getParent(instA);
    instB = getParent(instB);
  }
  return null;
}

/**
 * Return if A is an ancestor of B.
 * A 是否是B的父级节点
 */
export function isAncestor(instA, instB) {
  while (instB) {
    if (instA === instB || instA === instB.alternate) {
      return true;
    }
    instB = getParent(instB);
  }
  return false;
}

/**
 * Return the parent instance of the passed-in instance.
 * 返回父级实例
 */
export function getParentInstance(inst) {
  return getParent(inst);
}

/**
 * Simulates the traversal of a two-phase, capture/bubble event dispatch.
 * 模拟捕获和冒泡阶段事件的派发
 */
export function traverseTwoPhase(inst, fn, arg) {
  const path = [];
  // 将当前及父级节点手机到数组中  根级节点在数组开头
  while (inst) {
    path.push(inst);
    inst = getParent(inst);
  }
  let i;
  // 模拟捕获阶段 从最开始根节点处理 
  for (i = path.length; i-- > 0; ) {
    fn(path[i], 'captured', arg);
  }
  for (i = 0; i < path.length; i++) {
    fn(path[i], 'bubbled', arg);
  }
}

/**
 * Traverses the ID hierarchy and invokes the supplied `cb` on any IDs that
 * should would receive a `mouseEnter` or `mouseLeave` event.
 *
 * Does not invoke the callback on the nearest common ancestor because nothing
 * "entered" or "left" that element.
 */
export function traverseEnterLeave(from, to, fn, argFrom, argTo) {
  const common = from && to ? getLowestCommonAncestor(from, to) : null;
  const pathFrom = [];
  while (true) {
    if (!from) {
      break;
    }
    if (from === common) {
      break;
    }
    const alternate = from.alternate;
    if (alternate !== null && alternate === common) {
      break;
    }
    pathFrom.push(from);
    from = getParent(from);
  }
  const pathTo = [];
  while (true) {
    if (!to) {
      break;
    }
    if (to === common) {
      break;
    }
    const alternate = to.alternate;
    if (alternate !== null && alternate === common) {
      break;
    }
    pathTo.push(to);
    to = getParent(to);
  }
  for (let i = 0; i < pathFrom.length; i++) {
    fn(pathFrom[i], 'bubbled', argFrom);
  }
  for (let i = pathTo.length; i-- > 0; ) {
    fn(pathTo[i], 'captured', argTo);
  }
}
