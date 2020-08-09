/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from './ReactFiber';
import type {ExpirationTime} from './ReactFiberExpirationTime';
import type {UpdateQueue} from './ReactUpdateQueue';

import * as React from 'react';
import {Update, Snapshot} from 'shared/ReactSideEffectTags';
import {
  debugRenderPhaseSideEffectsForStrictMode,
  disableLegacyContext,
  warnAboutDeprecatedLifecycles,
} from 'shared/ReactFeatureFlags';
import ReactStrictModeWarnings from './ReactStrictModeWarnings';
import {isMounted} from 'react-reconciler/reflection';
import {get as getInstance, set as setInstance} from 'shared/ReactInstanceMap';
import shallowEqual from 'shared/shallowEqual';
import getComponentName from 'shared/getComponentName';
import invariant from 'shared/invariant';
import {REACT_CONTEXT_TYPE, REACT_PROVIDER_TYPE} from 'shared/ReactSymbols';

import {startPhaseTimer, stopPhaseTimer} from './ReactDebugFiberPerf';
import {resolveDefaultProps} from './ReactFiberLazyComponent';
import {StrictMode} from './ReactTypeOfMode';

import {
  enqueueUpdate,
  processUpdateQueue,
  checkHasForceUpdateAfterProcessing,
  resetHasForceUpdateBeforeProcessing,
  createUpdate,
  ReplaceState,
  ForceUpdate,
  initializeUpdateQueue,
  cloneUpdateQueue,
} from './ReactUpdateQueue';
import {NoWork} from './ReactFiberExpirationTime';
import {
  cacheContext,
  getMaskedContext,
  getUnmaskedContext,
  hasContextChanged,
  emptyContextObject,
} from './ReactFiberContext';
import {readContext} from './ReactFiberNewContext';
import {
  requestCurrentTimeForUpdate,
  computeExpirationForFiber,
  scheduleWork,
} from './ReactFiberWorkLoop';
import {requestCurrentSuspenseConfig} from './ReactFiberSuspenseConfig';

const fakeInternalInstance = {};
const isArray = Array.isArray;

// React.Component uses a shared frozen object by default.
// We'll use it to determine whether we need to initialize legacy refs.
export const emptyRefsObject = new React.Component().refs;

let didWarnAboutStateAssignmentForComponent;
let didWarnAboutUninitializedState;
let didWarnAboutGetSnapshotBeforeUpdateWithoutDidUpdate;
let didWarnAboutLegacyLifecyclesAndDerivedState;
let didWarnAboutUndefinedDerivedState;
let warnOnUndefinedDerivedState;
let warnOnInvalidCallback;
let didWarnAboutDirectlyAssigningPropsToState;
let didWarnAboutContextTypeAndContextTypes;
let didWarnAboutInvalidateContextType;

if (__DEV__) {
  didWarnAboutStateAssignmentForComponent = new Set();
  didWarnAboutUninitializedState = new Set();
  didWarnAboutGetSnapshotBeforeUpdateWithoutDidUpdate = new Set();
  didWarnAboutLegacyLifecyclesAndDerivedState = new Set();
  didWarnAboutDirectlyAssigningPropsToState = new Set();
  didWarnAboutUndefinedDerivedState = new Set();
  didWarnAboutContextTypeAndContextTypes = new Set();
  didWarnAboutInvalidateContextType = new Set();

  const didWarnOnInvalidCallback = new Set();

  warnOnInvalidCallback = function(callback: mixed, callerName: string) {
    if (callback === null || typeof callback === 'function') {
      return;
    }
    const key = `${callerName}_${(callback: any)}`;
    if (!didWarnOnInvalidCallback.has(key)) {
      didWarnOnInvalidCallback.add(key);
      console.error(
        '%s(...): Expected the last optional `callback` argument to be a ' +
          'function. Instead received: %s.',
        callerName,
        callback,
      );
    }
  };

  warnOnUndefinedDerivedState = function(type, partialState) {
    if (partialState === undefined) {
      const componentName = getComponentName(type) || 'Component';
      if (!didWarnAboutUndefinedDerivedState.has(componentName)) {
        didWarnAboutUndefinedDerivedState.add(componentName);
        console.error(
          '%s.getDerivedStateFromProps(): A valid state object (or null) must be returned. ' +
            'You have returned undefined.',
          componentName,
        );
      }
    }
  };

  // This is so gross but it's at least non-critical and can be removed if
  // it causes problems. This is meant to give a nicer error message for
  // ReactDOM15.unstable_renderSubtreeIntoContainer(reactDOM16Component,
  // ...)) which otherwise throws a "_processChildContext is not a function"
  // exception.
  Object.defineProperty(fakeInternalInstance, '_processChildContext', {
    enumerable: false,
    value: function() {
      invariant(
        false,
        '_processChildContext is not available in React 16+. This likely ' +
          'means you have multiple copies of React and are attempting to nest ' +
          'a React 15 tree inside a React 16 tree using ' +
          "unstable_renderSubtreeIntoContainer, which isn't supported. Try " +
          'to make sure you have only one copy of React (and ideally, switch ' +
          'to ReactDOM.createPortal).',
      );
    },
  });
  Object.freeze(fakeInternalInstance);
}

// 调用getDerivedStateFromProps生命周期函数
export function applyDerivedStateFromProps(
  workInProgress: Fiber,
  ctor: any,
  getDerivedStateFromProps: (props: any, state: any) => any,
  nextProps: any,
) {
  const prevState = workInProgress.memoizedState;

  if (__DEV__) {
    if (
      debugRenderPhaseSideEffectsForStrictMode &&
      workInProgress.mode & StrictMode
    ) {
      // Invoke the function an extra time to help detect side-effects.
      getDerivedStateFromProps(nextProps, prevState);
    }
  }

  const partialState = getDerivedStateFromProps(nextProps, prevState);

  if (__DEV__) {
    warnOnUndefinedDerivedState(ctor, partialState);
  }
  // Merge the partial state and the previous state.
  // 合并生成新的State
  const memoizedState =
    partialState === null || partialState === undefined
      ? prevState
      : Object.assign({}, prevState, partialState);
  workInProgress.memoizedState = memoizedState;

  // Once the update queue is empty, persist the derived state onto the
  // base state.
  if (workInProgress.expirationTime === NoWork) {
    // Queue is always non-null for classes
    const updateQueue: UpdateQueue<any> = (workInProgress.updateQueue: any);
    updateQueue.baseState = memoizedState;
  }
}


// class类型组件的更新对象 
const classComponentUpdater = {
  isMounted,
  enqueueSetState(inst, payload, callback) {
    // inst为组件对应的实例对象  获取对应的fiber节点
    const fiber = getInstance(inst);
    // 在事件中触发setState会使用和事件一样的currentTime
    const currentTime = requestCurrentTimeForUpdate();
    const suspenseConfig = requestCurrentSuspenseConfig();
    const expirationTime = computeExpirationForFiber(
      currentTime,
      fiber,
      suspenseConfig,
    );

    const update = createUpdate(expirationTime, suspenseConfig);
    update.payload = payload;
    if (callback !== undefined && callback !== null) {
      if (__DEV__) {
        warnOnInvalidCallback(callback, 'setState');
      }
      update.callback = callback;
    }

    enqueueUpdate(fiber, update);
    scheduleWork(fiber, expirationTime);
  },
  enqueueReplaceState(inst, payload, callback) {
    const fiber = getInstance(inst);
    const currentTime = requestCurrentTimeForUpdate();
    const suspenseConfig = requestCurrentSuspenseConfig();
    const expirationTime = computeExpirationForFiber(
      currentTime,
      fiber,
      suspenseConfig,
    );

    // 创建update对象压入到更新队列中 然后进行组件的调度
    const update = createUpdate(expirationTime, suspenseConfig);
    update.tag = ReplaceState;
    update.payload = payload;

    if (callback !== undefined && callback !== null) {
      if (__DEV__) {
        warnOnInvalidCallback(callback, 'replaceState');
      }
      update.callback = callback;
    }

    enqueueUpdate(fiber, update);
    scheduleWork(fiber, expirationTime);
  },
  enqueueForceUpdate(inst, callback) {
    const fiber = getInstance(inst);
    const currentTime = requestCurrentTimeForUpdate();
    const suspenseConfig = requestCurrentSuspenseConfig();
    const expirationTime = computeExpirationForFiber(
      currentTime,
      fiber,
      suspenseConfig,
    );

    const update = createUpdate(expirationTime, suspenseConfig);
    update.tag = ForceUpdate;

    if (callback !== undefined && callback !== null) {
      if (__DEV__) {
        warnOnInvalidCallback(callback, 'forceUpdate');
      }
      update.callback = callback;
    }

    enqueueUpdate(fiber, update);
    scheduleWork(fiber, expirationTime);
  },
};

// 运行shouldComponentUpdate函数决定组件是否进行更新
function checkShouldComponentUpdate(
  workInProgress,
  ctor,
  oldProps,
  newProps,
  oldState,
  newState,
  nextContext,
) {
  const instance = workInProgress.stateNode;
  if (typeof instance.shouldComponentUpdate === 'function') {
    if (__DEV__) {
      if (
        debugRenderPhaseSideEffectsForStrictMode &&
        workInProgress.mode & StrictMode
      ) {
        // Invoke the function an extra time to help detect side-effects.
        instance.shouldComponentUpdate(newProps, newState, nextContext);
      }
    }
    startPhaseTimer(workInProgress, 'shouldComponentUpdate');
    const shouldUpdate = instance.shouldComponentUpdate(
      newProps,
      newState,
      nextContext,
    );
    stopPhaseTimer();

    if (__DEV__) {
      if (shouldUpdate === undefined) {
        console.error(
          '%s.shouldComponentUpdate(): Returned undefined instead of a ' +
            'boolean value. Make sure to return true or false.',
          getComponentName(ctor) || 'Component',
        );
      }
    }

    return shouldUpdate;
  }

  // 浅比较
  if (ctor.prototype && ctor.prototype.isPureReactComponent) {
    return (
      !shallowEqual(oldProps, newProps) || !shallowEqual(oldState, newState)
    );
  }

  return true;
}

// 检查组件实例对象的render函数 各个生命周期函数等是否合法
function checkClassInstance(workInProgress: Fiber, ctor: any, newProps: any) {
  const instance = workInProgress.stateNode;
  if (__DEV__) {
    const name = getComponentName(ctor) || 'Component';
    const renderPresent = instance.render;

    if (!renderPresent) {
      if (ctor.prototype && typeof ctor.prototype.render === 'function') {
        console.error(
          '%s(...): No `render` method found on the returned component ' +
            'instance: did you accidentally return an object from the constructor?',
          name,
        );
      } else {
        console.error(
          '%s(...): No `render` method found on the returned component ' +
            'instance: you may have forgotten to define `render`.',
          name,
        );
      }
    }

    if (
      instance.getInitialState &&
      !instance.getInitialState.isReactClassApproved &&
      !instance.state
    ) {
      console.error(
        'getInitialState was defined on %s, a plain JavaScript class. ' +
          'This is only supported for classes created using React.createClass. ' +
          'Did you mean to define a state property instead?',
        name,
      );
    }
    if (
      instance.getDefaultProps &&
      !instance.getDefaultProps.isReactClassApproved
    ) {
      console.error(
        'getDefaultProps was defined on %s, a plain JavaScript class. ' +
          'This is only supported for classes created using React.createClass. ' +
          'Use a static property to define defaultProps instead.',
        name,
      );
    }
    if (instance.propTypes) {
      console.error(
        'propTypes was defined as an instance property on %s. Use a static ' +
          'property to define propTypes instead.',
        name,
      );
    }
    if (instance.contextType) {
      console.error(
        'contextType was defined as an instance property on %s. Use a static ' +
          'property to define contextType instead.',
        name,
      );
    }

    if (disableLegacyContext) {
      if (ctor.childContextTypes) {
        console.error(
          '%s uses the legacy childContextTypes API which is no longer supported. ' +
            'Use React.createContext() instead.',
          name,
        );
      }
      if (ctor.contextTypes) {
        console.error(
          '%s uses the legacy contextTypes API which is no longer supported. ' +
            'Use React.createContext() with static contextType instead.',
          name,
        );
      }
    } else {
      if (instance.contextTypes) {
        console.error(
          'contextTypes was defined as an instance property on %s. Use a static ' +
            'property to define contextTypes instead.',
          name,
        );
      }

      if (
        ctor.contextType &&
        ctor.contextTypes &&
        !didWarnAboutContextTypeAndContextTypes.has(ctor)
      ) {
        didWarnAboutContextTypeAndContextTypes.add(ctor);
        console.error(
          '%s declares both contextTypes and contextType static properties. ' +
            'The legacy contextTypes property will be ignored.',
          name,
        );
      }
    }

    if (typeof instance.componentShouldUpdate === 'function') {
      console.error(
        '%s has a method called ' +
          'componentShouldUpdate(). Did you mean shouldComponentUpdate()? ' +
          'The name is phrased as a question because the function is ' +
          'expected to return a value.',
        name,
      );
    }
    if (
      ctor.prototype &&
      ctor.prototype.isPureReactComponent &&
      typeof instance.shouldComponentUpdate !== 'undefined'
    ) {
      console.error(
        '%s has a method called shouldComponentUpdate(). ' +
          'shouldComponentUpdate should not be used when extending React.PureComponent. ' +
          'Please extend React.Component if shouldComponentUpdate is used.',
        getComponentName(ctor) || 'A pure component',
      );
    }
    if (typeof instance.componentDidUnmount === 'function') {
      console.error(
        '%s has a method called ' +
          'componentDidUnmount(). But there is no such lifecycle method. ' +
          'Did you mean componentWillUnmount()?',
        name,
      );
    }
    if (typeof instance.componentDidReceiveProps === 'function') {
      console.error(
        '%s has a method called ' +
          'componentDidReceiveProps(). But there is no such lifecycle method. ' +
          'If you meant to update the state in response to changing props, ' +
          'use componentWillReceiveProps(). If you meant to fetch data or ' +
          'run side-effects or mutations after React has updated the UI, use componentDidUpdate().',
        name,
      );
    }
    if (typeof instance.componentWillRecieveProps === 'function') {
      console.error(
        '%s has a method called ' +
          'componentWillRecieveProps(). Did you mean componentWillReceiveProps()?',
        name,
      );
    }
    if (typeof instance.UNSAFE_componentWillRecieveProps === 'function') {
      console.error(
        '%s has a method called ' +
          'UNSAFE_componentWillRecieveProps(). Did you mean UNSAFE_componentWillReceiveProps()?',
        name,
      );
    }
    const hasMutatedProps = instance.props !== newProps;
    if (instance.props !== undefined && hasMutatedProps) {
      console.error(
        '%s(...): When calling super() in `%s`, make sure to pass ' +
          "up the same props that your component's constructor was passed.",
        name,
        name,
      );
    }
    if (instance.defaultProps) {
      console.error(
        'Setting defaultProps as an instance property on %s is not supported and will be ignored.' +
          ' Instead, define defaultProps as a static property on %s.',
        name,
        name,
      );
    }

    if (
      typeof instance.getSnapshotBeforeUpdate === 'function' &&
      typeof instance.componentDidUpdate !== 'function' &&
      !didWarnAboutGetSnapshotBeforeUpdateWithoutDidUpdate.has(ctor)
    ) {
      didWarnAboutGetSnapshotBeforeUpdateWithoutDidUpdate.add(ctor);
      console.error(
        '%s: getSnapshotBeforeUpdate() should be used with componentDidUpdate(). ' +
          'This component defines getSnapshotBeforeUpdate() only.',
        getComponentName(ctor),
      );
    }

    if (typeof instance.getDerivedStateFromProps === 'function') {
      console.error(
        '%s: getDerivedStateFromProps() is defined as an instance method ' +
          'and will be ignored. Instead, declare it as a static method.',
        name,
      );
    }
    if (typeof instance.getDerivedStateFromError === 'function') {
      console.error(
        '%s: getDerivedStateFromError() is defined as an instance method ' +
          'and will be ignored. Instead, declare it as a static method.',
        name,
      );
    }
    if (typeof ctor.getSnapshotBeforeUpdate === 'function') {
      console.error(
        '%s: getSnapshotBeforeUpdate() is defined as a static method ' +
          'and will be ignored. Instead, declare it as an instance method.',
        name,
      );
    }
    const state = instance.state;
    if (state && (typeof state !== 'object' || isArray(state))) {
      console.error('%s.state: must be set to an object or null', name);
    }
    if (
      typeof instance.getChildContext === 'function' &&
      typeof ctor.childContextTypes !== 'object'
    ) {
      console.error(
        '%s.getChildContext(): childContextTypes must be defined in order to ' +
          'use getChildContext().',
        name,
      );
    }
  }
}

// 组件实例对象上添加updater,stateNode以及与fiber节点建立联系
function adoptClassInstance(workInProgress: Fiber, instance: any): void {
  instance.updater = classComponentUpdater;
  // 将实例对象和fiber节点建立联系
  workInProgress.stateNode = instance;
  // The instance needs access to the fiber so that it can schedule updates
  setInstance(instance, workInProgress);
  if (__DEV__) {
    instance._reactInternalInstance = fakeInternalInstance;
  }
}

// class组件生成实例对象
function constructClassInstance(
  workInProgress: Fiber,
  ctor: any,
  props: any,
): any {
  let isLegacyContextConsumer = false;
  let unmaskedContext = emptyContextObject;
  let context = emptyContextObject;
  const contextType = ctor.contextType;

  if (__DEV__) {
    if ('contextType' in ctor) {
      let isValid =
        // Allow null for conditional declaration
        contextType === null ||
        (contextType !== undefined &&
          contextType.$$typeof === REACT_CONTEXT_TYPE &&
          contextType._context === undefined); // Not a <Context.Consumer>

      if (!isValid && !didWarnAboutInvalidateContextType.has(ctor)) {
        didWarnAboutInvalidateContextType.add(ctor);

        let addendum = '';
        if (contextType === undefined) {
          addendum =
            ' However, it is set to undefined. ' +
            'This can be caused by a typo or by mixing up named and default imports. ' +
            'This can also happen due to a circular dependency, so ' +
            'try moving the createContext() call to a separate file.';
        } else if (typeof contextType !== 'object') {
          addendum = ' However, it is set to a ' + typeof contextType + '.';
        } else if (contextType.$$typeof === REACT_PROVIDER_TYPE) {
          addendum = ' Did you accidentally pass the Context.Provider instead?';
        } else if (contextType._context !== undefined) {
          // <Context.Consumer>
          addendum = ' Did you accidentally pass the Context.Consumer instead?';
        } else {
          addendum =
            ' However, it is set to an object with keys {' +
            Object.keys(contextType).join(', ') +
            '}.';
        }
        console.error(
          '%s defines an invalid contextType. ' +
            'contextType should point to the Context object returned by React.createContext().%s',
          getComponentName(ctor) || 'Component',
          addendum,
        );
      }
    }
  }

  // 处理类组件中的context
  if (typeof contextType === 'object' && contextType !== null) {
    context = readContext((contextType: any));
  } else if (!disableLegacyContext) {
    unmaskedContext = getUnmaskedContext(workInProgress, ctor, true);
    const contextTypes = ctor.contextTypes;
    isLegacyContextConsumer =
      contextTypes !== null && contextTypes !== undefined;
    context = isLegacyContextConsumer
      ? getMaskedContext(workInProgress, unmaskedContext)
      : emptyContextObject;
  }

  // Instantiate twice to help detect side-effects.
  if (__DEV__) {
    if (
      debugRenderPhaseSideEffectsForStrictMode &&
      workInProgress.mode & StrictMode
    ) {
      new ctor(props, context); // eslint-disable-line no-new
    }
  }

  // 这里会传入两个值props 和 context生成组件实例
  const instance = new ctor(props, context);
  const state = (workInProgress.memoizedState =
    instance.state !== null && instance.state !== undefined
      ? instance.state
      : null);
  // fiber节点和react实例对象建立联系
  adoptClassInstance(workInProgress, instance);

  if (__DEV__) {
    // 使用getDerivedStateFromProps钩子函数是需要在构造函数内声明state
    if (typeof ctor.getDerivedStateFromProps === 'function' && state === null) {
      const componentName = getComponentName(ctor) || 'Component';
      if (!didWarnAboutUninitializedState.has(componentName)) {
        didWarnAboutUninitializedState.add(componentName);
        console.error(
          '`%s` uses `getDerivedStateFromProps` but its initial state is ' +
            '%s. This is not recommended. Instead, define the initial state by ' +
            'assigning an object to `this.state` in the constructor of `%s`. ' +
            'This ensures that `getDerivedStateFromProps` arguments have a consistent shape.',
          componentName,
          instance.state === null ? 'null' : 'undefined',
          componentName,
        );
      }
    }

    // If new component APIs are defined, "unsafe" lifecycles won't be called.
    // Warn about these lifecycles if they are present.
    // Don't warn about react-lifecycles-compat polyfilled methods though.
    if (
      typeof ctor.getDerivedStateFromProps === 'function' ||
      typeof instance.getSnapshotBeforeUpdate === 'function'
    ) {
      let foundWillMountName = null;
      let foundWillReceivePropsName = null;
      let foundWillUpdateName = null;
      if (
        typeof instance.componentWillMount === 'function' &&
        instance.componentWillMount.__suppressDeprecationWarning !== true
      ) {
        foundWillMountName = 'componentWillMount';
      } else if (typeof instance.UNSAFE_componentWillMount === 'function') {
        foundWillMountName = 'UNSAFE_componentWillMount';
      }
      if (
        typeof instance.componentWillReceiveProps === 'function' &&
        instance.componentWillReceiveProps.__suppressDeprecationWarning !== true
      ) {
        foundWillReceivePropsName = 'componentWillReceiveProps';
      } else if (
        typeof instance.UNSAFE_componentWillReceiveProps === 'function'
      ) {
        foundWillReceivePropsName = 'UNSAFE_componentWillReceiveProps';
      }
      if (
        typeof instance.componentWillUpdate === 'function' &&
        instance.componentWillUpdate.__suppressDeprecationWarning !== true
      ) {
        foundWillUpdateName = 'componentWillUpdate';
      } else if (typeof instance.UNSAFE_componentWillUpdate === 'function') {
        foundWillUpdateName = 'UNSAFE_componentWillUpdate';
      }
      if (
        foundWillMountName !== null ||
        foundWillReceivePropsName !== null ||
        foundWillUpdateName !== null
      ) {
        const componentName = getComponentName(ctor) || 'Component';
        const newApiName =
          typeof ctor.getDerivedStateFromProps === 'function'
            ? 'getDerivedStateFromProps()'
            : 'getSnapshotBeforeUpdate()';
        if (!didWarnAboutLegacyLifecyclesAndDerivedState.has(componentName)) {
          didWarnAboutLegacyLifecyclesAndDerivedState.add(componentName);
          console.error(
            'Unsafe legacy lifecycles will not be called for components using new component APIs.\n\n' +
              '%s uses %s but also contains the following legacy lifecycles:%s%s%s\n\n' +
              'The above lifecycles should be removed. Learn more about this warning here:\n' +
              'https://fb.me/react-unsafe-component-lifecycles',
            componentName,
            newApiName,
            foundWillMountName !== null ? `\n  ${foundWillMountName}` : '',
            foundWillReceivePropsName !== null
              ? `\n  ${foundWillReceivePropsName}`
              : '',
            foundWillUpdateName !== null ? `\n  ${foundWillUpdateName}` : '',
          );
        }
      }
    }
  }

  // Cache unmasked context so we can avoid recreating masked context unless necessary.
  // ReactFiberContext usually updates this cache but can't for newly-created instances.
  if (isLegacyContextConsumer) {
    cacheContext(workInProgress, unmaskedContext, context);
  }

  return instance;
}

// 调用组件willMount的生命周期函数
function callComponentWillMount(workInProgress, instance) {
  startPhaseTimer(workInProgress, 'componentWillMount');
  const oldState = instance.state;

  if (typeof instance.componentWillMount === 'function') {
    instance.componentWillMount();
  }
  if (typeof instance.UNSAFE_componentWillMount === 'function') {
    instance.UNSAFE_componentWillMount();
  }

  stopPhaseTimer();

  if (oldState !== instance.state) {
    if (__DEV__) {
      console.error(
        '%s.componentWillMount(): Assigning directly to this.state is ' +
          "deprecated (except inside a component's " +
          'constructor). Use setState instead.',
        getComponentName(workInProgress.type) || 'Component',
      );
    }
    // 根据state创建一个更新对象并压入到更新队列中
    classComponentUpdater.enqueueReplaceState(instance, instance.state, null);
  }
}

// 组件willReceiveProps接受属性调用生命周期函数
function callComponentWillReceiveProps(
  workInProgress,
  instance,
  newProps,
  nextContext,
) {
  const oldState = instance.state;
  startPhaseTimer(workInProgress, 'componentWillReceiveProps');
  if (typeof instance.componentWillReceiveProps === 'function') {
    instance.componentWillReceiveProps(newProps, nextContext);
  }
  if (typeof instance.UNSAFE_componentWillReceiveProps === 'function') {
    instance.UNSAFE_componentWillReceiveProps(newProps, nextContext);
  }
  stopPhaseTimer();

  if (instance.state !== oldState) {
    if (__DEV__) {
      const componentName =
        getComponentName(workInProgress.type) || 'Component';
      if (!didWarnAboutStateAssignmentForComponent.has(componentName)) {
        didWarnAboutStateAssignmentForComponent.add(componentName);
        console.error(
          '%s.componentWillReceiveProps(): Assigning directly to ' +
            "this.state is deprecated (except inside a component's " +
            'constructor). Use setState instead.',
          componentName,
        );
      }
    }
    classComponentUpdater.enqueueReplaceState(instance, instance.state, null);
  }
}

// Invokes the mount life-cycles on a previously never rendered instance.
// 组件实例对象的绑定过程
function mountClassInstance(
  workInProgress: Fiber,
  ctor: any,
  newProps: any,
  renderExpirationTime: ExpirationTime,
): void {
  if (__DEV__) {
    checkClassInstance(workInProgress, ctor, newProps);
  }

  // 复用实例对象更新state props refs
  const instance = workInProgress.stateNode;
  instance.props = newProps;
  instance.state = workInProgress.memoizedState;
  instance.refs = emptyRefsObject;

  // 初始化fiber节点的的updateQueue
  initializeUpdateQueue(workInProgress);

  // 处理上下context对象
  const contextType = ctor.contextType;
  if (typeof contextType === 'object' && contextType !== null) {
    instance.context = readContext(contextType);
  } else if (disableLegacyContext) {
    instance.context = emptyContextObject;
  } else {
    const unmaskedContext = getUnmaskedContext(workInProgress, ctor, true);
    instance.context = getMaskedContext(workInProgress, unmaskedContext);
  }

  if (__DEV__) {
    if (instance.state === newProps) {
      const componentName = getComponentName(ctor) || 'Component';
      if (!didWarnAboutDirectlyAssigningPropsToState.has(componentName)) {
        didWarnAboutDirectlyAssigningPropsToState.add(componentName);
        console.error(
          '%s: It is not recommended to assign props directly to state ' +
            "because updates to props won't be reflected in state. " +
            'In most cases, it is better to use props directly.',
          componentName,
        );
      }
    }

    if (workInProgress.mode & StrictMode) {
      ReactStrictModeWarnings.recordLegacyContextWarning(
        workInProgress,
        instance,
      );
    }

    if (warnAboutDeprecatedLifecycles) {
      ReactStrictModeWarnings.recordUnsafeLifecycleWarnings(
        workInProgress,
        instance,
      );
    }
  }

  // TODO此处处理更新队列得到新的state
  processUpdateQueue(workInProgress, newProps, instance, renderExpirationTime);
  instance.state = workInProgress.memoizedState;

  // 调用getDerivedStateFromProps生命周期函数
  const getDerivedStateFromProps = ctor.getDerivedStateFromProps;
  if (typeof getDerivedStateFromProps === 'function') {
    applyDerivedStateFromProps(
      workInProgress,
      ctor,
      getDerivedStateFromProps,
      newProps,
    );
    instance.state = workInProgress.memoizedState;
  }

  // In order to support react-lifecycles-compat polyfilled components,
  // Unsafe lifecycles should not be invoked for components using the new APIs.
  if (
    typeof ctor.getDerivedStateFromProps !== 'function' &&
    typeof instance.getSnapshotBeforeUpdate !== 'function' &&
    (typeof instance.UNSAFE_componentWillMount === 'function' ||
      typeof instance.componentWillMount === 'function')
  ) {
    callComponentWillMount(workInProgress, instance);
    // If we had additional state updates during this life-cycle, let's
    // process them now.
    // 如果在生命周期函数中执行了setSate 这里需要处理更新队列
    processUpdateQueue(
      workInProgress,
      newProps,
      instance,
      renderExpirationTime,
    );
    instance.state = workInProgress.memoizedState;
  }

  // mount的生命周期函数在处理effect的时候运行
  if (typeof instance.componentDidMount === 'function') {
    workInProgress.effectTag |= Update;
  }
}

//TODO 恢复组件实例对象的运行  与updateClassInstance逻辑差不多
function resumeMountClassInstance(
  workInProgress: Fiber,
  ctor: any,
  newProps: any,
  renderExpirationTime: ExpirationTime,
): boolean {
  const instance = workInProgress.stateNode;

  const oldProps = workInProgress.memoizedProps;
  instance.props = oldProps;

  const oldContext = instance.context;
  const contextType = ctor.contextType;
  let nextContext = emptyContextObject;
  if (typeof contextType === 'object' && contextType !== null) {
    nextContext = readContext(contextType);
  } else if (!disableLegacyContext) {
    const nextLegacyUnmaskedContext = getUnmaskedContext(
      workInProgress,
      ctor,
      true,
    );
    nextContext = getMaskedContext(workInProgress, nextLegacyUnmaskedContext);
  }

  const getDerivedStateFromProps = ctor.getDerivedStateFromProps;
  const hasNewLifecycles =
    typeof getDerivedStateFromProps === 'function' ||
    typeof instance.getSnapshotBeforeUpdate === 'function';

  // Note: During these life-cycles, instance.props/instance.state are what
  // ever the previously attempted to render - not the "current". However,
  // during componentDidUpdate we pass the "current" props.

  // In order to support react-lifecycles-compat polyfilled components,
  // Unsafe lifecycles should not be invoked for components using the new APIs.
  if (
    !hasNewLifecycles &&
    (typeof instance.UNSAFE_componentWillReceiveProps === 'function' ||
      typeof instance.componentWillReceiveProps === 'function')
  ) {
    if (oldProps !== newProps || oldContext !== nextContext) {
      callComponentWillReceiveProps(
        workInProgress,
        instance,
        newProps,
        nextContext,
      );
    }
  }

  resetHasForceUpdateBeforeProcessing();

  const oldState = workInProgress.memoizedState;
  let newState = (instance.state = oldState);
  processUpdateQueue(workInProgress, newProps, instance, renderExpirationTime);
  newState = workInProgress.memoizedState;
  if (
    oldProps === newProps &&
    oldState === newState &&
    !hasContextChanged() &&
    !checkHasForceUpdateAfterProcessing()
  ) {
    // If an update was already in progress, we should schedule an Update
    // effect even though we're bailing out, so that cWU/cDU are called.
    if (typeof instance.componentDidMount === 'function') {
      workInProgress.effectTag |= Update;
    }
    return false;
  }

  if (typeof getDerivedStateFromProps === 'function') {
    applyDerivedStateFromProps(
      workInProgress,
      ctor,
      getDerivedStateFromProps,
      newProps,
    );
    newState = workInProgress.memoizedState;
  }

  const shouldUpdate =
    checkHasForceUpdateAfterProcessing() ||
    checkShouldComponentUpdate(
      workInProgress,
      ctor,
      oldProps,
      newProps,
      oldState,
      newState,
      nextContext,
    );

  if (shouldUpdate) {
    // In order to support react-lifecycles-compat polyfilled components,
    // Unsafe lifecycles should not be invoked for components using the new APIs.
    if (
      !hasNewLifecycles &&
      (typeof instance.UNSAFE_componentWillMount === 'function' ||
        typeof instance.componentWillMount === 'function')
    ) {
      startPhaseTimer(workInProgress, 'componentWillMount');
      if (typeof instance.componentWillMount === 'function') {
        instance.componentWillMount();
      }
      if (typeof instance.UNSAFE_componentWillMount === 'function') {
        instance.UNSAFE_componentWillMount();
      }
      stopPhaseTimer();
    }
    if (typeof instance.componentDidMount === 'function') {
      workInProgress.effectTag |= Update;
    }
  } else {
    // If an update was already in progress, we should schedule an Update
    // effect even though we're bailing out, so that cWU/cDU are called.
    if (typeof instance.componentDidMount === 'function') {
      workInProgress.effectTag |= Update;
    }

    // If shouldComponentUpdate returned false, we should still update the
    // memoized state to indicate that this work can be reused.
    workInProgress.memoizedProps = newProps;
    workInProgress.memoizedState = newState;
  }

  // Update the existing instance's state, props, and context pointers even
  // if shouldComponentUpdate returns false.
  instance.props = newProps;
  instance.state = newState;
  instance.context = nextContext;

  return shouldUpdate;
}

// Invokes the update life-cycles and returns false if it shouldn't rerender.
// 组件实例的更新  主要是新旧props state 相关声明周期函数  update对象压入到updateQueue中
function updateClassInstance(
  current: Fiber,
  workInProgress: Fiber,
  ctor: any,
  newProps: any,
  renderExpirationTime: ExpirationTime,
): boolean {
  const instance = workInProgress.stateNode;

  cloneUpdateQueue(current, workInProgress);

  const oldProps = workInProgress.memoizedProps;
  instance.props =
    workInProgress.type === workInProgress.elementType
      ? oldProps
      : resolveDefaultProps(workInProgress.type, oldProps);

  const oldContext = instance.context;
  const contextType = ctor.contextType;
  let nextContext = emptyContextObject;
  if (typeof contextType === 'object' && contextType !== null) {
    nextContext = readContext(contextType);
  } else if (!disableLegacyContext) {
    const nextUnmaskedContext = getUnmaskedContext(workInProgress, ctor, true);
    nextContext = getMaskedContext(workInProgress, nextUnmaskedContext);
  }

  const getDerivedStateFromProps = ctor.getDerivedStateFromProps;
  const hasNewLifecycles =
    typeof getDerivedStateFromProps === 'function' ||
    typeof instance.getSnapshotBeforeUpdate === 'function';

  // Note: During these life-cycles, instance.props/instance.state are what
  // ever the previously attempted to render - not the "current". However,
  // during componentDidUpdate we pass the "current" props.

  // In order to support react-lifecycles-compat polyfilled components,
  // Unsafe lifecycles should not be invoked for components using the new APIs.
  if (
    !hasNewLifecycles &&
    (typeof instance.UNSAFE_componentWillReceiveProps === 'function' ||
      typeof instance.componentWillReceiveProps === 'function')
  ) {
    if (oldProps !== newProps || oldContext !== nextContext) {
      callComponentWillReceiveProps(
        workInProgress,
        instance,
        newProps,
        nextContext,
      );
    }
  }

  resetHasForceUpdateBeforeProcessing();

  const oldState = workInProgress.memoizedState;
  let newState = (instance.state = oldState);
  processUpdateQueue(workInProgress, newProps, instance, renderExpirationTime);
  newState = workInProgress.memoizedState;

  if (
    oldProps === newProps &&
    oldState === newState &&
    !hasContextChanged() &&
    !checkHasForceUpdateAfterProcessing()
  ) {
    // If an update was already in progress, we should schedule an Update
    // effect even though we're bailing out, so that cWU/cDU are called.
    // update生命周期函数在处理effect tag时进行更新
    if (typeof instance.componentDidUpdate === 'function') {
      if (
        oldProps !== current.memoizedProps ||
        oldState !== current.memoizedState
      ) {
        workInProgress.effectTag |= Update;
      }
    }
    if (typeof instance.getSnapshotBeforeUpdate === 'function') {
      if (
        oldProps !== current.memoizedProps ||
        oldState !== current.memoizedState
      ) {
        workInProgress.effectTag |= Snapshot;
      }
    }
    return false;
  }

  if (typeof getDerivedStateFromProps === 'function') {
    applyDerivedStateFromProps(
      workInProgress,
      ctor,
      getDerivedStateFromProps,
      newProps,
    );
    newState = workInProgress.memoizedState;
  }

  const shouldUpdate =
    checkHasForceUpdateAfterProcessing() ||
    checkShouldComponentUpdate(
      workInProgress,
      ctor,
      oldProps,
      newProps,
      oldState,
      newState,
      nextContext,
    );

  if (shouldUpdate) {
    // In order to support react-lifecycles-compat polyfilled components,
    // Unsafe lifecycles should not be invoked for components using the new APIs.
    if (
      !hasNewLifecycles &&
      (typeof instance.UNSAFE_componentWillUpdate === 'function' ||
        typeof instance.componentWillUpdate === 'function')
    ) {
      startPhaseTimer(workInProgress, 'componentWillUpdate');
      if (typeof instance.componentWillUpdate === 'function') {
        instance.componentWillUpdate(newProps, newState, nextContext);
      }
      if (typeof instance.UNSAFE_componentWillUpdate === 'function') {
        instance.UNSAFE_componentWillUpdate(newProps, newState, nextContext);
      }
      stopPhaseTimer();
    }
    if (typeof instance.componentDidUpdate === 'function') {
      workInProgress.effectTag |= Update;
    }
    if (typeof instance.getSnapshotBeforeUpdate === 'function') {
      workInProgress.effectTag |= Snapshot;
    }
  } else {
    // If an update was already in progress, we should schedule an Update
    // effect even though we're bailing out, so that cWU/cDU are called.
    if (typeof instance.componentDidUpdate === 'function') {
      if (
        oldProps !== current.memoizedProps ||
        oldState !== current.memoizedState
      ) {
        workInProgress.effectTag |= Update;
      }
    }
    if (typeof instance.getSnapshotBeforeUpdate === 'function') {
      if (
        oldProps !== current.memoizedProps ||
        oldState !== current.memoizedState
      ) {
        workInProgress.effectTag |= Snapshot;
      }
    }

    // If shouldComponentUpdate returned false, we should still update the
    // memoized props/state to indicate that this work can be reused.
    workInProgress.memoizedProps = newProps;
    workInProgress.memoizedState = newState;
  }

  // Update the existing instance's state, props, and context pointers even
  // if shouldComponentUpdate returns false.
  instance.props = newProps;
  instance.state = newState;
  instance.context = nextContext;

  return shouldUpdate;
}

export {
  adoptClassInstance,
  constructClassInstance,
  mountClassInstance,
  resumeMountClassInstance,
  updateClassInstance,
};
