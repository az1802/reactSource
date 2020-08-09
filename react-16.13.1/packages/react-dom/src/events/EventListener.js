/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

//  添加冒泡的事件监听
export function addEventBubbleListener(
  element: Document | Element | Node,
  eventType: string,
  listener: Function,
): void {
  element.addEventListener(eventType, listener, false);
}

//  添加捕获的事件监听
export function addEventCaptureListener(
  element: Document | Element | Node,
  eventType: string,
  listener: Function,
): void {
  element.addEventListener(eventType, listener, true);
}

// passive为true表示永远不会调用preventDefault.如果调用了则会在控制台报错
// Unable to preventDefault inside passive event listener invocation.
export function addEventCaptureListenerWithPassiveFlag(
  element: Document | Element | Node,
  eventType: string,
  listener: Function,
  passive: boolean,
): void {
  element.addEventListener(eventType, listener, {
    capture: true,
    passive,
  });
}
