/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import {enableProfilerTimer} from 'shared/ReactFeatureFlags';
import {getCurrentTime} from './ReactFiberWorkLoop';
import {inferPriorityFromExpirationTime} from './ReactFiberExpirationTime';

import type {Fiber} from './ReactFiber';
import type {FiberRoot} from './ReactFiberRoot';
import type {ExpirationTime} from './ReactFiberExpirationTime';
import type {ReactNodeList} from 'shared/ReactTypes';

import {DidCapture} from 'shared/ReactSideEffectTags';

declare var __REACT_DEVTOOLS_GLOBAL_HOOK__: Object | void;

let onScheduleFiberRoot = null;
let onCommitFiberRoot = null;
let onCommitFiberUnmount = null;
let hasLoggedError = false;

export const isDevToolsPresent =
  typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ !== 'undefined';

  //注入内部变量用于开发者工具的判断
export function injectInternals(internals: Object): boolean {
  if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ === 'undefined') {
    // No DevTools
    return false;
  }
  const hook = __REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (hook.isDisabled) {
    // This isn't a real property on the hook, but it can be set to opt out
    // of DevTools integration and associated warnings and logs.
    // https://github.com/facebook/react/issues/3877
    return true;
  }
  // 没有fiber表示react版本太久需要进行更新
  if (!hook.supportsFiber) {
    if (__DEV__) {
      console.error(
        'The installed version of React DevTools is too old and will not work ' +
          'with the current version of React. Please update React DevTools. ' +
          'https://fb.me/react-devtools',
      );
    }
    // DevTools exists, even though it doesn't support Fiber.
    return true;
  }
  try {
    const rendererID = hook.inject(internals);
    // We have successfully injected, so now it is safe to set up hooks.
    // 开发者环境下 onScheduleFiberRoot   onCommitFiberRoot  onCommitFiberUnmount添加其中函数运行时的错误捕获
    if (__DEV__) {
      // Only used by Fast Refresh
      if (typeof hook.onScheduleFiberRoot === 'function') {
        // 开发环境中使用
        onScheduleFiberRoot = (root, children) => {
          try {
            hook.onScheduleFiberRoot(rendererID, root, children);
          } catch (err) {
            if (__DEV__ && !hasLoggedError) {
              hasLoggedError = true;
              console.error(
                'React instrumentation encountered an error: %s',
                err,
              );
            }
          }
        };
      }
    }
    onCommitFiberRoot = (root, expirationTime) => {
      try {
        const didError = (root.current.effectTag & DidCapture) === DidCapture;
        if (enableProfilerTimer) {
          const currentTime = getCurrentTime();
          const priorityLevel = inferPriorityFromExpirationTime(
            currentTime,
            expirationTime,
          );
          hook.onCommitFiberRoot(rendererID, root, priorityLevel, didError);
        } else {
          hook.onCommitFiberRoot(rendererID, root, undefined, didError);
        }
      } catch (err) {
        if (__DEV__) {
          if (!hasLoggedError) {
            hasLoggedError = true;
            console.error(
              'React instrumentation encountered an error: %s',
              err,
            );
          }
        }
      }
    };
    onCommitFiberUnmount = fiber => {
      try {
        hook.onCommitFiberUnmount(rendererID, fiber);
      } catch (err) {
        if (__DEV__) {
          if (!hasLoggedError) {
            hasLoggedError = true;
            console.error(
              'React instrumentation encountered an error: %s',
              err,
            );
          }
        }
      }
    };
  } catch (err) {
    // Catch all errors because it is unsafe to throw during initialization.
    if (__DEV__) {
      console.error('React instrumentation encountered an error: %s.', err);
    }
  }
  // DevTools exists
  return true;
}

// 对fiber root节点进行调度
export function onScheduleRoot(root: FiberRoot, children: ReactNodeList) {
  if (typeof onScheduleFiberRoot === 'function') {
    onScheduleFiberRoot(root, children);
  }
}

// fiber节点开始commit阶段
export function onCommitRoot(root: FiberRoot, expirationTime: ExpirationTime) {
  if (typeof onCommitFiberRoot === 'function') {
    onCommitFiberRoot(root, expirationTime);
  }
}

// fiber节点解绑阶段
export function onCommitUnmount(fiber: Fiber) {
  if (typeof onCommitFiberUnmount === 'function') {
    onCommitFiberUnmount(fiber);
  }
}
