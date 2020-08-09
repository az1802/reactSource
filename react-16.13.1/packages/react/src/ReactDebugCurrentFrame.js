/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactElement} from 'shared/ReactElementType';

import describeComponentFrame from 'shared/describeComponentFrame';
import getComponentName from 'shared/getComponentName';

const ReactDebugCurrentFrame = {};

// 当前正在验证的ReactElement
let currentlyValidatingElement = (null: null | ReactElement);

// 设置当前正在验证的reactElement
export function setCurrentlyValidatingElement(element: null | ReactElement) {
  if (__DEV__) {
    currentlyValidatingElement = element;
  }
}

if (__DEV__) {
  // Stack implementation injected by the current renderer.
  ReactDebugCurrentFrame.getCurrentStack = (null: null | (() => string));

  // 栈信息中添加代码来源和行信息
  ReactDebugCurrentFrame.getStackAddendum = function(): string {
    let stack = '';

    // Add an extra top frame while an element is being validated
    if (currentlyValidatingElement) {
      // 根据组件type获取组件名称
      const name = getComponentName(currentlyValidatingElement.type);
      const owner = currentlyValidatingElement._owner;
      // 获取组件栈的字符串信息 _source记录的文件和代码行信息  owner即父节点
      stack += describeComponentFrame(
        name,
        currentlyValidatingElement._source,
        owner && getComponentName(owner.type),
      );
    }

    // Delegate to the injected renderer-specific implementation
    // 外部注入的额外信息
    const impl = ReactDebugCurrentFrame.getCurrentStack;
    if (impl) {
      stack += impl() || '';
    }

    return stack;
  };
}

export default ReactDebugCurrentFrame;
