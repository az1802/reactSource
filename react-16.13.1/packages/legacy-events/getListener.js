/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 * @flow
 */

import type {Fiber} from 'react-reconciler/src/ReactFiber';

import invariant from 'shared/invariant';

import {getFiberCurrentPropsFromNode} from './EventPluginUtils';

// 交互形式的标签
function isInteractive(tag) {
  return (
    tag === 'button' ||
    tag === 'input' ||
    tag === 'select' ||
    tag === 'textarea'
  );
}

// 包含disabled属性的时候某些回调不会触发
function shouldPreventMouseEvent(name, type, props) {
  switch (name) {
    case 'onClick':
    case 'onClickCapture':
    case 'onDoubleClick':
    case 'onDoubleClickCapture':
    case 'onMouseDown':
    case 'onMouseDownCapture':
    case 'onMouseMove':
    case 'onMouseMoveCapture':
    case 'onMouseUp':
    case 'onMouseUpCapture':
    case 'onMouseEnter':
      return !!(props.disabled && isInteractive(type));
    default:
      return false;
  }
}

/**
 * @param {object} inst The instance, which is the source of events.
 * @param {string} registrationName Name of listener (e.g. `onClick`).
 * @return {?function} The stored callback.
 */
// 查看fiber节点上 registrationName 事件对应的回调  有则返回没有返回null
export default function getListener(inst: Fiber, registrationName: string) {
  let listener;

  // TODO: shouldPreventMouseEvent is DOM-specific and definitely should not
  // live here; needs to be moved to a better place soon
  const stateNode = inst.stateNode;
  if (!stateNode) {
    // Work in progress (ex: onload events in incremental mode).
    return null;
  }
  // 从node节点获取props即react元素的props
  const props = getFiberCurrentPropsFromNode(stateNode);
  if (!props) {
    // Work in progress.
    return null;
  }
  // 获取事件对应的回调
  listener = props[registrationName];
  if (shouldPreventMouseEvent(registrationName, inst.type, props)) {
    return null;
  }
  invariant(
    !listener || typeof listener === 'function',
    'Expected `%s` listener to be a function, instead got a value of `%s` type.',
    registrationName,
    typeof listener,
  );
  return listener;
}
