/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from './ReactFiber';

import ReactSharedInternals from 'shared/ReactSharedInternals';
import {
  HostRoot,
  HostPortal,
  HostText,
  Fragment,
  ContextProvider,
  ContextConsumer,
} from 'shared/ReactWorkTags';
import describeComponentFrame from 'shared/describeComponentFrame';
import getComponentName from 'shared/getComponentName';

const ReactDebugCurrentFrame = ReactSharedInternals.ReactDebugCurrentFrame;

// 返回fiber节点的描述信息
function describeFiber(fiber: Fiber): string {
  switch (fiber.tag) {
    case HostRoot:
    case HostPortal:
    case HostText:
    case Fragment:
    case ContextProvider:
    case ContextConsumer:
      return '';
    default:
      const owner = fiber._debugOwner;
      const source = fiber._debugSource;
      const name = getComponentName(fiber.type);
      let ownerName = null;
      if (owner) {
        ownerName = getComponentName(owner.type);
      }
      return describeComponentFrame(name, source, ownerName);
  }
}

// 获取fiber节点的栈信息
export function getStackByFiberInDevAndProd(workInProgress: Fiber): string {
  let info = '';
  let node = workInProgress;
  do {
    info += describeFiber(node);
    node = node.return;
  } while (node);
  return info;
}

export let current: Fiber | null = null;
export let isRendering: boolean = false;

// 当前fiber对应的组件type
export function getCurrentFiberOwnerNameInDevOrNull(): string | null {
  if (__DEV__) {
    if (current === null) {
      return null;
    }
    const owner = current._debugOwner;
    if (owner !== null && typeof owner !== 'undefined') {
      return getComponentName(owner.type);
    }
  }
  return null;
}

export function getCurrentFiberStackInDev(): string {
  if (__DEV__) {
    if (current === null) {
      return '';
    }
    // Safe because if current fiber exists, we are reconciling,
    // and it is guaranteed to be the work-in-progress version.
    return getStackByFiberInDevAndProd(current);
  }
  return '';
}

// 重置当前fiber信息
export function resetCurrentFiber() {
  if (__DEV__) {
    ReactDebugCurrentFrame.getCurrentStack = null;
    current = null;
    isRendering = false;
  }
}

// 设置当前处理的fiber节点
export function setCurrentFiber(fiber: Fiber) {
  if (__DEV__) {
    ReactDebugCurrentFrame.getCurrentStack = getCurrentFiberStackInDev;
    current = fiber;
    isRendering = false;
  }
}

// 设置isRendering变量
export function setIsRendering(rendering: boolean) {
  if (__DEV__) {
    isRendering = rendering;
  }
}
