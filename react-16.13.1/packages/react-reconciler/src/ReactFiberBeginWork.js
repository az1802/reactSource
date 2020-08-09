/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactProviderType, ReactContext} from 'shared/ReactTypes';
import type {Fiber} from './ReactFiber';
import type {FiberRoot} from './ReactFiberRoot';
import type {ExpirationTime} from './ReactFiberExpirationTime';
import type {
  SuspenseState,
  SuspenseListRenderState,
  SuspenseListTailMode,
} from './ReactFiberSuspenseComponent';
import type {SuspenseContext} from './ReactFiberSuspenseContext';

import checkPropTypes from 'prop-types/checkPropTypes';

import {
  IndeterminateComponent,
  FunctionComponent,
  ClassComponent,
  HostRoot,
  HostComponent,
  HostText,
  HostPortal,
  ForwardRef,
  Fragment,
  Mode,
  ContextProvider,
  ContextConsumer,
  Profiler,
  SuspenseComponent,
  SuspenseListComponent,
  MemoComponent,
  SimpleMemoComponent,
  LazyComponent,
  IncompleteClassComponent,
  FundamentalComponent,
  ScopeComponent,
  Block,
} from 'shared/ReactWorkTags';
import {
  NoEffect,
  PerformedWork,
  Placement,
  Hydrating,
  ContentReset,
  DidCapture,
  Update,
  Ref,
  Deletion,
} from 'shared/ReactSideEffectTags';
import ReactSharedInternals from 'shared/ReactSharedInternals';
import {
  debugRenderPhaseSideEffectsForStrictMode,
  disableLegacyContext,
  enableProfilerTimer,
  enableSchedulerTracing,
  enableSuspenseServerRenderer,
  enableFundamentalAPI,
  warnAboutDefaultPropsOnFunctionComponents,
  enableScopeAPI,
  enableBlocksAPI,
} from 'shared/ReactFeatureFlags';
import invariant from 'shared/invariant';
import shallowEqual from 'shared/shallowEqual';
import getComponentName from 'shared/getComponentName';
import ReactStrictModeWarnings from './ReactStrictModeWarnings';
import {refineResolvedLazyComponent} from 'shared/ReactLazyComponent';
import {REACT_LAZY_TYPE, getIteratorFn} from 'shared/ReactSymbols';
import {
  getCurrentFiberOwnerNameInDevOrNull,
  getCurrentFiberStackInDev,
  setIsRendering,
} from './ReactCurrentFiber';
import {startWorkTimer, cancelWorkTimer} from './ReactDebugFiberPerf';
import {
  resolveFunctionForHotReloading,
  resolveForwardRefForHotReloading,
  resolveClassForHotReloading,
} from './ReactFiberHotReloading';

import {
  mountChildFibers,
  reconcileChildFibers,
  cloneChildFibers,
} from './ReactChildFiber';
import {
  processUpdateQueue,
  cloneUpdateQueue,
  initializeUpdateQueue,
} from './ReactUpdateQueue';
import {
  NoWork,
  Never,
  Sync,
  computeAsyncExpiration,
} from './ReactFiberExpirationTime';
import {
  ConcurrentMode,
  NoMode,
  ProfileMode,
  StrictMode,
  BlockingMode,
} from './ReactTypeOfMode';
import {
  shouldSetTextContent,
  shouldDeprioritizeSubtree,
  isSuspenseInstancePending,
  isSuspenseInstanceFallback,
  registerSuspenseInstanceRetry,
} from './ReactFiberHostConfig';
import type {SuspenseInstance} from './ReactFiberHostConfig';
import {shouldSuspend} from './ReactFiberReconciler';
import {pushHostContext, pushHostContainer} from './ReactFiberHostContext';
import {
  suspenseStackCursor,
  pushSuspenseContext,
  InvisibleParentSuspenseContext,
  ForceSuspenseFallback,
  hasSuspenseContext,
  setDefaultShallowSuspenseContext,
  addSubtreeSuspenseContext,
  setShallowSuspenseContext,
} from './ReactFiberSuspenseContext';
import {findFirstSuspended} from './ReactFiberSuspenseComponent';
import {
  pushProvider,
  propagateContextChange,
  readContext,
  prepareToReadContext,
  calculateChangedBits,
  scheduleWorkOnParentPath,
} from './ReactFiberNewContext';
import {renderWithHooks, bailoutHooks} from './ReactFiberHooks';
import {stopProfilerTimerIfRunning} from './ReactProfilerTimer';
import {
  getMaskedContext,
  getUnmaskedContext,
  hasContextChanged as hasLegacyContextChanged,
  pushContextProvider as pushLegacyContextProvider,
  isContextProvider as isLegacyContextProvider,
  pushTopLevelContextObject,
  invalidateContextProvider,
} from './ReactFiberContext';
import {
  enterHydrationState,
  reenterHydrationStateFromDehydratedSuspenseInstance,
  resetHydrationState,
  tryToClaimNextHydratableInstance,
  warnIfHydrating,
} from './ReactFiberHydrationContext';
import {
  adoptClassInstance,
  applyDerivedStateFromProps,
  constructClassInstance,
  mountClassInstance,
  resumeMountClassInstance,
  updateClassInstance,
} from './ReactFiberClassComponent';
import {
  readLazyComponentType,
  resolveDefaultProps,
} from './ReactFiberLazyComponent';
import {
  resolveLazyComponentTag,
  createFiberFromTypeAndProps,
  createFiberFromFragment,
  createWorkInProgress,
  isSimpleFunctionComponent,
} from './ReactFiber';
import {
  markSpawnedWork,
  requestCurrentTimeForUpdate,
  retryDehydratedSuspenseBoundary,
  scheduleWork,
  renderDidSuspendDelayIfPossible,
  markUnprocessedUpdateTime,
} from './ReactFiberWorkLoop';

const ReactCurrentOwner = ReactSharedInternals.ReactCurrentOwner;

let didReceiveUpdate: boolean = false;

let didWarnAboutBadClass;
let didWarnAboutModulePatternComponent;
let didWarnAboutContextTypeOnFunctionComponent;
let didWarnAboutGetDerivedStateOnFunctionComponent;
let didWarnAboutFunctionRefs;
export let didWarnAboutReassigningProps;
let didWarnAboutRevealOrder;
let didWarnAboutTailOptions;
let didWarnAboutDefaultPropsOnFunctionComponent;

if (__DEV__) {
  didWarnAboutBadClass = {};
  didWarnAboutModulePatternComponent = {};
  didWarnAboutContextTypeOnFunctionComponent = {};
  didWarnAboutGetDerivedStateOnFunctionComponent = {};
  didWarnAboutFunctionRefs = {};
  didWarnAboutReassigningProps = false;
  didWarnAboutRevealOrder = {};
  didWarnAboutTailOptions = {};
  didWarnAboutDefaultPropsOnFunctionComponent = {};
}

// 处理子节点部分
export function reconcileChildren(
  current: Fiber | null,
  workInProgress: Fiber,
  nextChildren: any,
  renderExpirationTime: ExpirationTime,
) {
  if (current === null) {
    // If this is a fresh new component that hasn't been rendered yet, we
    // won't update its child set by applying minimal side-effects. Instead,
    // we will add them all to the child before it gets rendered. That means
    // we can optimize this reconciliation pass by not tracking side-effects.
    // 如果这是一个尚未渲染的节点(后续通过state相关组件进行了显示),这里不会通过effect的模式进行更新
    // 而是直接进行mount这样更快捷的方式进行渲染更新
    workInProgress.child = mountChildFibers(
      workInProgress,
      null,
      nextChildren,
      renderExpirationTime, 
    );
  } else {
    // If the current child is the same as the work in progress, it means that
    // we haven't yet started any work on these children. Therefore, we use
    // the clone algorithm to create a copy of all the current children.

    // If we had any progressed work already, that is invalid at this point so
    // let's throw it out.
    // 更新处理子节点
    workInProgress.child = reconcileChildFibers(
      workInProgress,
      current.child,
      nextChildren,
      renderExpirationTime,
    );
  }
}

// TODO 强制解绑当前组件
function forceUnmountCurrentAndReconcile(
  current: Fiber,
  workInProgress: Fiber,
  nextChildren: any,
  renderExpirationTime: ExpirationTime,
) {
  // This function is fork of reconcileChildren. It's used in cases where we
  // want to reconcile without matching against the existing set. This has the
  // effect of all current children being unmounted; even if the type and key
  // are the same, the old child is unmounted and a new child is created.
  //
  // To do this, we're going to go through the reconcile algorithm twice. In
  // the first pass, we schedule a deletion for all the current children by
  // passing null.
  workInProgress.child = reconcileChildFibers(
    workInProgress,
    current.child,
    null,
    renderExpirationTime,
  );
  // In the second pass, we mount the new children. The trick here is that we
  // pass null in place of where we usually pass the current child set. This has
  // the effect of remounting all children regardless of whether their
  // identities match.
  workInProgress.child = reconcileChildFibers(
    workInProgress,
    null,
    nextChildren,
    renderExpirationTime,
  );
}

function updateForwardRef(
  current: Fiber | null,
  workInProgress: Fiber,
  Component: any,
  nextProps: any,
  renderExpirationTime: ExpirationTime,
) {
  // TODO: current can be non-null here even if the component
  // hasn't yet mounted. This happens after the first render suspends.
  // We'll need to figure out if this is fine or can cause issues.

  if (__DEV__) {
    if (workInProgress.type !== workInProgress.elementType) {
      // Lazy component props can't be validated in createElement
      // because they're only guaranteed to be resolved here.
      const innerPropTypes = Component.propTypes;
      if (innerPropTypes) {
        checkPropTypes(
          innerPropTypes,
          nextProps, // Resolved props
          'prop',
          getComponentName(Component),
          getCurrentFiberStackInDev,
        );
      }
    }
  }

  const render = Component.render;
  const ref = workInProgress.ref;

  // The rest is a fork of updateFunctionComponent
  let nextChildren;
  prepareToReadContext(workInProgress, renderExpirationTime);
  if (__DEV__) {
    ReactCurrentOwner.current = workInProgress;
    setIsRendering(true);
    nextChildren = renderWithHooks(
      current,
      workInProgress,
      render,
      nextProps,
      ref,
      renderExpirationTime,
    );
    if (
      debugRenderPhaseSideEffectsForStrictMode &&
      workInProgress.mode & StrictMode
    ) {
      // Only double-render components with Hooks
      if (workInProgress.memoizedState !== null) {
        nextChildren = renderWithHooks(
          current,
          workInProgress,
          render,
          nextProps,
          ref,
          renderExpirationTime,
        );
      }
    }
    setIsRendering(false);
  } else {
    nextChildren = renderWithHooks(
      current,
      workInProgress,
      render,
      nextProps,
      ref,
      renderExpirationTime,
    );
  }

  if (current !== null && !didReceiveUpdate) {
    bailoutHooks(current, workInProgress, renderExpirationTime);
    return bailoutOnAlreadyFinishedWork(
      current,
      workInProgress,
      renderExpirationTime,
    );
  }

  // React DevTools reads this flag.
  workInProgress.effectTag |= PerformedWork;
  reconcileChildren(
    current,
    workInProgress,
    nextChildren,
    renderExpirationTime,
  );
  return workInProgress.child;
}

function updateMemoComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  Component: any,
  nextProps: any,
  updateExpirationTime,
  renderExpirationTime: ExpirationTime,
): null | Fiber {
  if (current === null) {
    let type = Component.type;
    if (
      isSimpleFunctionComponent(type) &&
      Component.compare === null &&
      // SimpleMemoComponent codepath doesn't resolve outer props either.
      Component.defaultProps === undefined
    ) {
      let resolvedType = type;
      if (__DEV__) {
        resolvedType = resolveFunctionForHotReloading(type);
      }
      // If this is a plain function component without default props,
      // and with only the default shallow comparison, we upgrade it
      // to a SimpleMemoComponent to allow fast path updates.
      workInProgress.tag = SimpleMemoComponent;
      workInProgress.type = resolvedType;
      if (__DEV__) {
        validateFunctionComponentInDev(workInProgress, type);
      }
      return updateSimpleMemoComponent(
        current,
        workInProgress,
        resolvedType,
        nextProps,
        updateExpirationTime,
        renderExpirationTime,
      );
    }
    if (__DEV__) {
      const innerPropTypes = type.propTypes;
      if (innerPropTypes) {
        // Inner memo component props aren't currently validated in createElement.
        // We could move it there, but we'd still need this for lazy code path.
        checkPropTypes(
          innerPropTypes,
          nextProps, // Resolved props
          'prop',
          getComponentName(type),
          getCurrentFiberStackInDev,
        );
      }
    }
    let child = createFiberFromTypeAndProps(
      Component.type,
      null,
      nextProps,
      null,
      workInProgress.mode,
      renderExpirationTime,
    );
    child.ref = workInProgress.ref;
    child.return = workInProgress;
    workInProgress.child = child;
    return child;
  }
  if (__DEV__) {
    const type = Component.type;
    const innerPropTypes = type.propTypes;
    if (innerPropTypes) {
      // Inner memo component props aren't currently validated in createElement.
      // We could move it there, but we'd still need this for lazy code path.
      checkPropTypes(
        innerPropTypes,
        nextProps, // Resolved props
        'prop',
        getComponentName(type),
        getCurrentFiberStackInDev,
      );
    }
  }
  let currentChild = ((current.child: any): Fiber); // This is always exactly one child
  if (updateExpirationTime < renderExpirationTime) {
    // This will be the props with resolved defaultProps,
    // unlike current.memoizedProps which will be the unresolved ones.
    const prevProps = currentChild.memoizedProps;
    // Default to shallow comparison
    let compare = Component.compare;
    compare = compare !== null ? compare : shallowEqual;
    if (compare(prevProps, nextProps) && current.ref === workInProgress.ref) {
      return bailoutOnAlreadyFinishedWork(
        current,
        workInProgress,
        renderExpirationTime,
      );
    }
  }
  // React DevTools reads this flag.
  workInProgress.effectTag |= PerformedWork;
  let newChild = createWorkInProgress(currentChild, nextProps);
  newChild.ref = workInProgress.ref;
  newChild.return = workInProgress;
  workInProgress.child = newChild;
  return newChild;
}

function updateSimpleMemoComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  Component: any,
  nextProps: any,
  updateExpirationTime,
  renderExpirationTime: ExpirationTime,
): null | Fiber {
  // TODO: current can be non-null here even if the component
  // hasn't yet mounted. This happens when the inner render suspends.
  // We'll need to figure out if this is fine or can cause issues.

  if (__DEV__) {
    if (workInProgress.type !== workInProgress.elementType) {
      // Lazy component props can't be validated in createElement
      // because they're only guaranteed to be resolved here.
      let outerMemoType = workInProgress.elementType;
      if (outerMemoType.$$typeof === REACT_LAZY_TYPE) {
        // We warn when you define propTypes on lazy()
        // so let's just skip over it to find memo() outer wrapper.
        // Inner props for memo are validated later.
        outerMemoType = refineResolvedLazyComponent(outerMemoType);
      }
      const outerPropTypes = outerMemoType && (outerMemoType: any).propTypes;
      if (outerPropTypes) {
        checkPropTypes(
          outerPropTypes,
          nextProps, // Resolved (SimpleMemoComponent has no defaultProps)
          'prop',
          getComponentName(outerMemoType),
          getCurrentFiberStackInDev,
        );
      }
      // Inner propTypes will be validated in the function component path.
    }
  }
  if (current !== null) {
    const prevProps = current.memoizedProps;
    if (
      shallowEqual(prevProps, nextProps) &&
      current.ref === workInProgress.ref &&
      // Prevent bailout if the implementation changed due to hot reload.
      (__DEV__ ? workInProgress.type === current.type : true)
    ) {
      didReceiveUpdate = false;
      if (updateExpirationTime < renderExpirationTime) {
        // The pending update priority was cleared at the beginning of
        // beginWork. We're about to bail out, but there might be additional
        // updates at a lower priority. Usually, the priority level of the
        // remaining updates is accumlated during the evaluation of the
        // component (i.e. when processing the update queue). But since since
        // we're bailing out early *without* evaluating the component, we need
        // to account for it here, too. Reset to the value of the current fiber.
        // NOTE: This only applies to SimpleMemoComponent, not MemoComponent,
        // because a MemoComponent fiber does not have hooks or an update queue;
        // rather, it wraps around an inner component, which may or may not
        // contains hooks.
        // TODO: Move the reset at in beginWork out of the common path so that
        // this is no longer necessary.
        workInProgress.expirationTime = current.expirationTime;
        return bailoutOnAlreadyFinishedWork(
          current,
          workInProgress,
          renderExpirationTime,
        );
      }
    }
  }
  return updateFunctionComponent(
    current,
    workInProgress,
    Component,
    nextProps,
    renderExpirationTime,
  );
}

// 更新代码片段
function updateFragment(
  current: Fiber | null,
  workInProgress: Fiber,
  renderExpirationTime: ExpirationTime,
) {
  // children 被放入了props.children中
  const nextChildren = workInProgress.pendingProps;
  reconcileChildren(
    current,
    workInProgress,
    nextChildren,
    renderExpirationTime,
  );
  return workInProgress.child;
}

function updateMode(
  current: Fiber | null,
  workInProgress: Fiber,
  renderExpirationTime: ExpirationTime,
) {
  const nextChildren = workInProgress.pendingProps.children;
  reconcileChildren(
    current,
    workInProgress,
    nextChildren,
    renderExpirationTime,
  );
  return workInProgress.child;
}

function updateProfiler(
  current: Fiber | null,
  workInProgress: Fiber,
  renderExpirationTime: ExpirationTime,
) {
  if (enableProfilerTimer) {
    workInProgress.effectTag |= Update;
  }
  const nextProps = workInProgress.pendingProps;
  const nextChildren = nextProps.children;
  reconcileChildren(
    current,
    workInProgress,
    nextChildren,
    renderExpirationTime,
  );
  return workInProgress.child;
}

function markRef(current: Fiber | null, workInProgress: Fiber) {
  const ref = workInProgress.ref;
  if (
    (current === null && ref !== null) ||
    (current !== null && current.ref !== ref)
  ) {
    // Schedule a Ref effect
    workInProgress.effectTag |= Ref;
  }
}

// 更新函数式组件
function updateFunctionComponent(
  current,
  workInProgress,
  Component,
  nextProps: any,
  renderExpirationTime,
) {
  if (__DEV__) {
    if (workInProgress.type !== workInProgress.elementType) {
      // Lazy component props can't be validated in createElement
      // because they're only guaranteed to be resolved here.
      const innerPropTypes = Component.propTypes;
      if (innerPropTypes) {
        checkPropTypes(
          innerPropTypes,
          nextProps, // Resolved props
          'prop',
          getComponentName(Component),
          getCurrentFiberStackInDev,
        );
      }
    }
  }

  let context;
  if (!disableLegacyContext) {
    const unmaskedContext = getUnmaskedContext(workInProgress, Component, true);
    context = getMaskedContext(workInProgress, unmaskedContext);
  }

  let nextChildren;
  prepareToReadContext(workInProgress, renderExpirationTime);
  if (__DEV__) {
    ReactCurrentOwner.current = workInProgress;
    setIsRendering(true);
    nextChildren = renderWithHooks(
      current,
      workInProgress,
      Component,
      nextProps,
      context,
      renderExpirationTime,
    );
    if (
      debugRenderPhaseSideEffectsForStrictMode &&
      workInProgress.mode & StrictMode
    ) {
      // Only double-render components with Hooks
      if (workInProgress.memoizedState !== null) {
        nextChildren = renderWithHooks(
          current,
          workInProgress,
          Component,
          nextProps,
          context,
          renderExpirationTime,
        );
      }
    }
    setIsRendering(false);
  } else {
    nextChildren = renderWithHooks(
      current,
      workInProgress,
      Component,
      nextProps,
      context,
      renderExpirationTime,
    );
  }

  // 处理hooks
  if (current !== null && !didReceiveUpdate) {
    bailoutHooks(current, workInProgress, renderExpirationTime);
    return bailoutOnAlreadyFinishedWork(
      current,
      workInProgress,
      renderExpirationTime,
    );
  }

  // React DevTools reads this flag.
  workInProgress.effectTag |= PerformedWork;
  reconcileChildren(
    current,
    workInProgress,
    nextChildren,
    renderExpirationTime,
  );
  return workInProgress.child;
}

function updateBlock(
  current: Fiber | null,
  workInProgress: Fiber,
  block: any,
  nextProps: any,
  renderExpirationTime: ExpirationTime,
) {
  // TODO: current can be non-null here even if the component
  // hasn't yet mounted. This happens after the first render suspends.
  // We'll need to figure out if this is fine or can cause issues.

  const render = block.render;
  const data = block.query();

  // The rest is a fork of updateFunctionComponent
  let nextChildren;
  prepareToReadContext(workInProgress, renderExpirationTime);
  if (__DEV__) {
    ReactCurrentOwner.current = workInProgress;
    setIsRendering(true);
    nextChildren = renderWithHooks(
      current,
      workInProgress,
      render,
      nextProps,
      data,
      renderExpirationTime,
    );
    if (
      debugRenderPhaseSideEffectsForStrictMode &&
      workInProgress.mode & StrictMode
    ) {
      // Only double-render components with Hooks
      if (workInProgress.memoizedState !== null) {
        nextChildren = renderWithHooks(
          current,
          workInProgress,
          render,
          nextProps,
          data,
          renderExpirationTime,
        );
      }
    }
    setIsRendering(false);
  } else {
    nextChildren = renderWithHooks(
      current,
      workInProgress,
      render,
      nextProps,
      data,
      renderExpirationTime,
    );
  }

  if (current !== null && !didReceiveUpdate) {
    bailoutHooks(current, workInProgress, renderExpirationTime);
    return bailoutOnAlreadyFinishedWork(
      current,
      workInProgress,
      renderExpirationTime,
    );
  }

  // React DevTools reads this flag.
  workInProgress.effectTag |= PerformedWork;
  reconcileChildren(
    current,
    workInProgress,
    nextChildren,
    renderExpirationTime,
  );
  return workInProgress.child;
}

// 更新class类型的组件
function updateClassComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  Component: any,
  nextProps,
  renderExpirationTime: ExpirationTime,
) {
  if (__DEV__) {
    if (workInProgress.type !== workInProgress.elementType) {
      // Lazy component props can't be validated in createElement
      // because they're only guaranteed to be resolved here.
      const innerPropTypes = Component.propTypes;
      if (innerPropTypes) {
        checkPropTypes(
          innerPropTypes,
          nextProps, // Resolved props
          'prop',
          getComponentName(Component),
          getCurrentFiberStackInDev,
        );
      }
    }
  }

  // Push context providers early to prevent context stack mismatches.
  // During mounting we don't know the child context yet as the instance doesn't exist.
  // We will invalidate the child context in finishClassComponent() right after rendering.
  // 是否有废弃的上下文使用方式
  let hasContext;
  if (isLegacyContextProvider(Component)) {
    hasContext = true;
    pushLegacyContextProvider(workInProgress);
  } else {
    hasContext = false;
  }
  prepareToReadContext(workInProgress, renderExpirationTime);

  // workInProgress节点可能是进行复用的所以实例对象可能存在
  const instance = workInProgress.stateNode;
  let shouldUpdate;
  if (instance === null) {
    if (current !== null) {
      // A class component without an instance only mounts if it suspended
      // inside a non-concurrent tree, in an inconsistent state. We want to
      // treat it like a new mount, even though an empty version of it already
      // committed. Disconnect the alternate pointers.
      current.alternate = null;
      workInProgress.alternate = null;
      // Since this is conceptually a new fiber, schedule a Placement effect
      workInProgress.effectTag |= Placement;
    }
    // In the initial pass we might need to construct the instance.
    // 根据属性运行构造函数
    constructClassInstance(workInProgress, Component, nextProps);
    // 绑定组件实例对象 并会执行willMount等生命周期方法(没有复用表明第一次渲染改组件实例)
    mountClassInstance(
      workInProgress,
      Component,
      nextProps,
      renderExpirationTime,
    );
    // 默认触发更新
    shouldUpdate = true;
  } else if (current === null) {
    // In a resume, we'll already have an instance we can reuse.
    //render阶段可能是中断之后进行恢复的 所以可能存在实例对象没有旧的fiber对象对应
    shouldUpdate = resumeMountClassInstance(
      workInProgress,
      Component,
      nextProps,
      renderExpirationTime,
    );
  } else {
    // 复用之后更新react组件实例对象
    shouldUpdate = updateClassInstance(
      current,
      workInProgress,
      Component,
      nextProps,
      renderExpirationTime,
    );
  }

  // 组件更新完成返回下一个需要处理的fiber节点
  const nextUnitOfWork = finishClassComponent(
    current,
    workInProgress,
    Component,
    shouldUpdate,
    hasContext,
    renderExpirationTime,
  );
  if (__DEV__) {
    let inst = workInProgress.stateNode;
    if (inst.props !== nextProps) {
      if (!didWarnAboutReassigningProps) {
        console.error(
          'It looks like %s is reassigning its own `this.props` while rendering. ' +
            'This is not supported and can lead to confusing bugs.',
          getComponentName(workInProgress.type) || 'a component',
        );
      }
      didWarnAboutReassigningProps = true;
    }
  }
  return nextUnitOfWork;
}


// classComponent处理完毕 返回下一个待处理的fiber节点
function finishClassComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  Component: any,
  shouldUpdate: boolean,
  hasContext: boolean,
  renderExpirationTime: ExpirationTime,
) {
  // Refs should update even if shouldComponentUpdate returns false 存在ref属性则需要添加Ref tag便于后续更新
  markRef(current, workInProgress);

  // 前面执行组件实例的更新等操作出现错误则会有DidCapture effectTag
  const didCaptureError = (workInProgress.effectTag & DidCapture) !== NoEffect;

  // 不需要更新该节点则跳过子节点更新直接标记此节点的完成工作
  if (!shouldUpdate && !didCaptureError) {
    // Context providers should defer to sCU for rendering
    if (hasContext) {
      invalidateContextProvider(workInProgress, Component, false);
    }

    return bailoutOnAlreadyFinishedWork(
      current,
      workInProgress,
      renderExpirationTime,
    );
  }

  const instance = workInProgress.stateNode;

  // Rerender
  ReactCurrentOwner.current = workInProgress;
  let nextChildren;
  if (
    didCaptureError &&
    typeof Component.getDerivedStateFromError !== 'function'
  ) {
    // 出现错误进行捕获
    // If we captured an error, but getDerivedStateFromError is not defined,
    // unmount all the children. componentDidCatch will schedule an update to
    // re-render a fallback. This is temporary until we migrate everyone to
    // the new API.
    // TODO: Warn in a future release.
    nextChildren = null;

    if (enableProfilerTimer) {
      stopProfilerTimerIfRunning(workInProgress);
    }
  } else {
    if (__DEV__) {
      setIsRendering(true);
      nextChildren = instance.render();//运行render函数获取子节点
      if (
        debugRenderPhaseSideEffectsForStrictMode &&
        workInProgress.mode & StrictMode
      ) {
        instance.render();
      }
      setIsRendering(false);
    } else {
      // 调用render方法获取新的chilren
      nextChildren = instance.render();
    }
  }

  // React DevTools reads this flag.
  workInProgress.effectTag |= PerformedWork;
  if (current !== null && didCaptureError) {
    // If we're recovering from an error, reconcile without reusing any of
    // the existing children. Conceptually, the normal children and the children
    // that are shown on error are two different sets, so we shouldn't reuse
    // normal children even if their identities match.
    // TODO 发生错误进行解绑然后重新绑定 
    forceUnmountCurrentAndReconcile(
      current,
      workInProgress,
      nextChildren,
      renderExpirationTime,
    );
  } else {
    // 正常的对子节点进行递归处理
    reconcileChildren(
      current,
      workInProgress,
      nextChildren,
      renderExpirationTime,
    );
  }

  // Memoize state using the values we just used to render.
  // TODO: Restructure so we never read values from the instance.
  workInProgress.memoizedState = instance.state;

  // The context might have changed so we need to recalculate it. 重新计算context是否发生改变
  if (hasContext) {
    invalidateContextProvider(workInProgress, Component, true);
  }

  return workInProgress.child;
}
// 处理根节点的上下文 主要是各种栈的处理
function pushHostRootContext(workInProgress) {
  const root = (workInProgress.stateNode: FiberRoot);
  if (root.pendingContext) {
    pushTopLevelContextObject(
      workInProgress,
      root.pendingContext,
      root.pendingContext !== root.context,
    );
  } else if (root.context) {
    // Should always be set  处理顶层的上下文对象即在根节点外层的context
    pushTopLevelContextObject(workInProgress, root.context, false);
  }
  pushHostContainer(workInProgress, root.containerInfo);
}

// host root 节点执行更新
function updateHostRoot(current, workInProgress, renderExpirationTime) {
  // 处理跟实例节点的上下文
  pushHostRootContext(workInProgress);
  const updateQueue = workInProgress.updateQueue;
  invariant(
    current !== null && updateQueue !== null,
    'If the root does not have an updateQueue, we should have already ' +
      'bailed out. This error is likely caused by a bug in React. Please ' +
      'file an issue.',
  );
  const nextProps = workInProgress.pendingProps;
  const prevState = workInProgress.memoizedState;
  const prevChildren = prevState !== null ? prevState.element : null;
  // 复制一个更新队列到workInProgress fiber节点上
  cloneUpdateQueue(current, workInProgress);
  // 处理workInProgress 节点上的更新队列  更新每个队列对象上的state
  processUpdateQueue(workInProgress, nextProps, null, renderExpirationTime);
  const nextState = workInProgress.memoizedState;
  // Caution: React DevTools currently depends on this property
  // being called "element".
  const nextChildren = nextState.element;
  // 针对根节点子节点没有发生变化则可以结束流程
  if (nextChildren === prevChildren) {
    // If the state is the same as before, that's a bailout because we had
    // no work that expires at this time.
    resetHydrationState();
    return bailoutOnAlreadyFinishedWork(
      current,
      workInProgress,
      renderExpirationTime,
    );
  }
  const root: FiberRoot = workInProgress.stateNode;
  if (root.hydrate && enterHydrationState(workInProgress)) {
    // If we don't have any current children this might be the first pass.
    // We always try to hydrate. If this isn't a hydration pass there won't
    // be any children to hydrate which is effectively the same thing as
    // not hydrating.

    let child = mountChildFibers(
      workInProgress,
      null,
      nextChildren,
      renderExpirationTime,
    );
    workInProgress.child = child;

    let node = child;
    while (node) {
      // Mark each child as hydrating. This is a fast path to know whether this
      // tree is part of a hydrating tree. This is used to determine if a child
      // node has fully mounted yet, and for scheduling event replaying.
      // Conceptually this is similar to Placement in that a new subtree is
      // inserted into the React tree here. It just happens to not need DOM
      // mutations because it already exists.
      node.effectTag = (node.effectTag & ~Placement) | Hydrating;
      node = node.sibling;
    }
  } else {
    // Otherwise reset hydration state in case we aborted and resumed another
    // root.
    // 调度处理根节点的子节点,递归使用
    reconcileChildren(
      current,
      workInProgress,
      nextChildren,
      renderExpirationTime,
    );
    resetHydrationState();
  }
  // 返回子节点的处理任务
  return workInProgress.child;
}

// 更新普通的组件
function updateHostComponent(current, workInProgress, renderExpirationTime) {
  // 上下文 context的处理 
  pushHostContext(workInProgress);

  if (current === null) {
    tryToClaimNextHydratableInstance(workInProgress);
  }

  const type = workInProgress.type;
  const nextProps = workInProgress.pendingProps;
  const prevProps = current !== null ? current.memoizedProps : null;

  let nextChildren = nextProps.children;
  // 是否直接是一个文本类型的子节点
  const isDirectTextChild = shouldSetTextContent(type, nextProps);

  if (isDirectTextChild) {
    // We special case a direct text child of a host node. This is a common
    // case. We won't handle it as a reified child. We will instead handle
    // this in the host environment that also has access to this prop. That
    // avoids allocating another HostText fiber and traversing it.
    // 直接的文本类型会直接处理不会再构造一层fiber子节点进行处理  这里也是一个性能的优化 会将文本类型节点直接处理为props.children
    nextChildren = null;
  } else if (prevProps !== null && shouldSetTextContent(type, prevProps)) {
    // If we're switching from a direct text child to a normal child, or to
    // empty, we need to schedule the text content to be reset.
    // 如果从直接文本子对象切换到普通对象 需要重新设置文本内容
    workInProgress.effectTag |= ContentReset;
  }

  // 查看fiber节点上的ref是否需要进行更新
  markRef(current, workInProgress);

  // Check the host config to see if the children are offscreen/hidden.
  // 检查子节点是否在屏幕内或者被隐藏,主要是一种优化  ConcurrentMode 为并发模式
  if (
    workInProgress.mode & ConcurrentMode &&
    renderExpirationTime !== Never &&
    shouldDeprioritizeSubtree(type, nextProps)
  ) {
    if (enableSchedulerTracing) {
      markSpawnedWork(Never);
    }
    // Schedule this fiber to re-render at offscreen priority. Then bailout.
    // 调整这个屏幕的优先级
    workInProgress.expirationTime = workInProgress.childExpirationTime = Never;
    return null;
  }

  // 再次处理其子节点 nextChilrenw为null则不会往下层递归
  reconcileChildren(
    current,
    workInProgress,
    nextChildren,
    renderExpirationTime,
  );
  return workInProgress.child;
}

// 更新纯文本节点
function updateHostText(current, workInProgress) {
  if (current === null) {
    tryToClaimNextHydratableInstance(workInProgress);
  }
  // Nothing to do here. This is terminal. We'll do the completion step
  // immediately after.
  return null;
}

function mountLazyComponent(
  _current,
  workInProgress,
  elementType,
  updateExpirationTime,
  renderExpirationTime,
) {
  if (_current !== null) {
    // A lazy component only mounts if it suspended inside a non-
    // concurrent tree, in an inconsistent state. We want to treat it like
    // a new mount, even though an empty version of it already committed.
    // Disconnect the alternate pointers.
    _current.alternate = null;
    workInProgress.alternate = null;
    // Since this is conceptually a new fiber, schedule a Placement effect
    workInProgress.effectTag |= Placement;
  }

  const props = workInProgress.pendingProps;
  // We can't start a User Timing measurement with correct label yet.
  // Cancel and resume right after we know the tag.
  cancelWorkTimer(workInProgress);
  let Component = readLazyComponentType(elementType);
  // Store the unwrapped component in the type.
  workInProgress.type = Component;
  const resolvedTag = (workInProgress.tag = resolveLazyComponentTag(Component));
  startWorkTimer(workInProgress);
  const resolvedProps = resolveDefaultProps(Component, props);
  let child;
  switch (resolvedTag) {
    case FunctionComponent: {
      if (__DEV__) {
        validateFunctionComponentInDev(workInProgress, Component);
        workInProgress.type = Component = resolveFunctionForHotReloading(
          Component,
        );
      }
      child = updateFunctionComponent(
        null,
        workInProgress,
        Component,
        resolvedProps,
        renderExpirationTime,
      );
      return child;
    }
    case ClassComponent: {
      if (__DEV__) {
        workInProgress.type = Component = resolveClassForHotReloading(
          Component,
        );
      }
      child = updateClassComponent(
        null,
        workInProgress,
        Component,
        resolvedProps,
        renderExpirationTime,
      );
      return child;
    }
    case ForwardRef: {
      if (__DEV__) {
        workInProgress.type = Component = resolveForwardRefForHotReloading(
          Component,
        );
      }
      child = updateForwardRef(
        null,
        workInProgress,
        Component,
        resolvedProps,
        renderExpirationTime,
      );
      return child;
    }
    case MemoComponent: {
      if (__DEV__) {
        if (workInProgress.type !== workInProgress.elementType) {
          const outerPropTypes = Component.propTypes;
          if (outerPropTypes) {
            checkPropTypes(
              outerPropTypes,
              resolvedProps, // Resolved for outer only
              'prop',
              getComponentName(Component),
              getCurrentFiberStackInDev,
            );
          }
        }
      }
      child = updateMemoComponent(
        null,
        workInProgress,
        Component,
        resolveDefaultProps(Component.type, resolvedProps), // The inner type can have defaults too
        updateExpirationTime,
        renderExpirationTime,
      );
      return child;
    }
    case Block: {
      if (enableBlocksAPI) {
        // TODO: Resolve for Hot Reloading.
        child = updateBlock(
          null,
          workInProgress,
          Component,
          props,
          renderExpirationTime,
        );
        return child;
      }
      break;
    }
  }
  let hint = '';
  if (__DEV__) {
    if (
      Component !== null &&
      typeof Component === 'object' &&
      Component.$$typeof === REACT_LAZY_TYPE
    ) {
      hint = ' Did you wrap a component in React.lazy() more than once?';
    }
  }
  // This message intentionally doesn't mention ForwardRef or MemoComponent
  // because the fact that it's a separate type of work is an
  // implementation detail.
  invariant(
    false,
    'Element type is invalid. Received a promise that resolves to: %s. ' +
      'Lazy element type must resolve to a class or function.%s',
    Component,
    hint,
  );
}

function mountIncompleteClassComponent(
  _current,
  workInProgress,
  Component,
  nextProps,
  renderExpirationTime,
) {
  if (_current !== null) {
    // An incomplete component only mounts if it suspended inside a non-
    // concurrent tree, in an inconsistent state. We want to treat it like
    // a new mount, even though an empty version of it already committed.
    // Disconnect the alternate pointers.
    _current.alternate = null;
    workInProgress.alternate = null;
    // Since this is conceptually a new fiber, schedule a Placement effect
    workInProgress.effectTag |= Placement;
  }

  // Promote the fiber to a class and try rendering again.
  workInProgress.tag = ClassComponent;

  // The rest of this function is a fork of `updateClassComponent`

  // Push context providers early to prevent context stack mismatches.
  // During mounting we don't know the child context yet as the instance doesn't exist.
  // We will invalidate the child context in finishClassComponent() right after rendering.
  let hasContext;
  if (isLegacyContextProvider(Component)) {
    hasContext = true;
    pushLegacyContextProvider(workInProgress);
  } else {
    hasContext = false;
  }
  prepareToReadContext(workInProgress, renderExpirationTime);

  constructClassInstance(workInProgress, Component, nextProps);
  mountClassInstance(
    workInProgress,
    Component,
    nextProps,
    renderExpirationTime,
  );

  return finishClassComponent(
    null,
    workInProgress,
    Component,
    true,
    hasContext,
    renderExpirationTime,
  );
}

// 绑定不确定的组件
function mountIndeterminateComponent(
  _current,
  workInProgress,
  Component,
  renderExpirationTime,
) {
  if (_current !== null) {
    // An indeterminate component only mounts if it suspended inside a non-
    // concurrent tree, in an inconsistent state. We want to treat it like
    // a new mount, even though an empty version of it already committed.
    // Disconnect the alternate pointers.
    _current.alternate = null;
    workInProgress.alternate = null;
    // Since this is conceptually a new fiber, schedule a Placement effect
    workInProgress.effectTag |= Placement;
  }

  const props = workInProgress.pendingProps;
  let context;
  if (!disableLegacyContext) {
    const unmaskedContext = getUnmaskedContext(
      workInProgress,
      Component,
      false,
    );
    context = getMaskedContext(workInProgress, unmaskedContext);
  }

  prepareToReadContext(workInProgress, renderExpirationTime);

  let value;

  if (__DEV__) {
    if (
      Component.prototype &&
      typeof Component.prototype.render === 'function'
    ) {
      const componentName = getComponentName(Component) || 'Unknown';

      if (!didWarnAboutBadClass[componentName]) {
        console.error(
          "The <%s /> component appears to have a render method, but doesn't extend React.Component. " +
            'This is likely to cause errors. Change %s to extend React.Component instead.',
          componentName,
          componentName,
        );
        didWarnAboutBadClass[componentName] = true;
      }
    }

    if (workInProgress.mode & StrictMode) {
      ReactStrictModeWarnings.recordLegacyContextWarning(workInProgress, null);
    }

    setIsRendering(true);
    ReactCurrentOwner.current = workInProgress;
    value = renderWithHooks(
      null,
      workInProgress,
      Component,
      props,
      context,
      renderExpirationTime,
    );
    setIsRendering(false);
  } else {
    // 函数形式的组件.返回children
    value = renderWithHooks(
      null,
      workInProgress,
      Component,
      props,
      context,
      renderExpirationTime,
    );
  }
  // React DevTools reads this flag.
  workInProgress.effectTag |= PerformedWork;

  if (
    typeof value === 'object' &&
    value !== null &&
    typeof value.render === 'function' &&
    value.$$typeof === undefined
  ) {
    // 返回的是一个class类型的组件 过程与updateClassComponent 一样
    if (__DEV__) {
      const componentName = getComponentName(Component) || 'Unknown';
      if (!didWarnAboutModulePatternComponent[componentName]) {
        console.error(
          'The <%s /> component appears to be a function component that returns a class instance. ' +
            'Change %s to a class that extends React.Component instead. ' +
            "If you can't use a class try assigning the prototype on the function as a workaround. " +
            "`%s.prototype = React.Component.prototype`. Don't use an arrow function since it " +
            'cannot be called with `new` by React.',
          componentName,
          componentName,
          componentName,
        );
        didWarnAboutModulePatternComponent[componentName] = true;
      }
    }

    // Proceed under the assumption that this is a class instance
    workInProgress.tag = ClassComponent;

    // Throw out any hooks that were used.
    workInProgress.memoizedState = null;
    workInProgress.updateQueue = null;

    // Push context providers early to prevent context stack mismatches.
    // During mounting we don't know the child context yet as the instance doesn't exist.
    // We will invalidate the child context in finishClassComponent() right after rendering.
    let hasContext = false;
    if (isLegacyContextProvider(Component)) {
      hasContext = true;
      pushLegacyContextProvider(workInProgress);
    } else {
      hasContext = false;
    }

    workInProgress.memoizedState =
      value.state !== null && value.state !== undefined ? value.state : null;

    initializeUpdateQueue(workInProgress);

    const getDerivedStateFromProps = Component.getDerivedStateFromProps;
    if (typeof getDerivedStateFromProps === 'function') {
      applyDerivedStateFromProps(
        workInProgress,
        Component,
        getDerivedStateFromProps,
        props,
      );
    }

    adoptClassInstance(workInProgress, value);
    mountClassInstance(workInProgress, Component, props, renderExpirationTime);
    return finishClassComponent(
      null,
      workInProgress,
      Component,
      true,
      hasContext,
      renderExpirationTime,
    );
  } else {
    // Proceed under the assumption that this is a function component
    workInProgress.tag = FunctionComponent;
    if (__DEV__) {
      if (disableLegacyContext && Component.contextTypes) {
        console.error(
          '%s uses the legacy contextTypes API which is no longer supported. ' +
            'Use React.createContext() with React.useContext() instead.',
          getComponentName(Component) || 'Unknown',
        );
      }

      if (
        debugRenderPhaseSideEffectsForStrictMode &&
        workInProgress.mode & StrictMode
      ) {
        // Only double-render components with Hooks
        if (workInProgress.memoizedState !== null) {
          value = renderWithHooks(
            null,
            workInProgress,
            Component,
            props,
            context,
            renderExpirationTime,
          );
        }
      }
    }
    // 构造子级节点的fiber对象仅处理一个层级不会深度处理
    reconcileChildren(null, workInProgress, value, renderExpirationTime);
    if (__DEV__) {
      validateFunctionComponentInDev(workInProgress, Component);
    }
    return workInProgress.child;
  }
}

function validateFunctionComponentInDev(workInProgress: Fiber, Component: any) {
  if (__DEV__) {
    if (Component) {
      if (Component.childContextTypes) {
        console.error(
          '%s(...): childContextTypes cannot be defined on a function component.',
          Component.displayName || Component.name || 'Component',
        );
      }
    }
    if (workInProgress.ref !== null) {
      let info = '';
      const ownerName = getCurrentFiberOwnerNameInDevOrNull();
      if (ownerName) {
        info += '\n\nCheck the render method of `' + ownerName + '`.';
      }

      let warningKey = ownerName || workInProgress._debugID || '';
      const debugSource = workInProgress._debugSource;
      if (debugSource) {
        warningKey = debugSource.fileName + ':' + debugSource.lineNumber;
      }
      if (!didWarnAboutFunctionRefs[warningKey]) {
        didWarnAboutFunctionRefs[warningKey] = true;
        console.error(
          'Function components cannot be given refs. ' +
            'Attempts to access this ref will fail. ' +
            'Did you mean to use React.forwardRef()?%s',
          info,
        );
      }
    }

    if (
      warnAboutDefaultPropsOnFunctionComponents &&
      Component.defaultProps !== undefined
    ) {
      const componentName = getComponentName(Component) || 'Unknown';

      if (!didWarnAboutDefaultPropsOnFunctionComponent[componentName]) {
        console.error(
          '%s: Support for defaultProps will be removed from function components ' +
            'in a future major release. Use JavaScript default parameters instead.',
          componentName,
        );
        didWarnAboutDefaultPropsOnFunctionComponent[componentName] = true;
      }
    }

    if (typeof Component.getDerivedStateFromProps === 'function') {
      const componentName = getComponentName(Component) || 'Unknown';

      if (!didWarnAboutGetDerivedStateOnFunctionComponent[componentName]) {
        console.error(
          '%s: Function components do not support getDerivedStateFromProps.',
          componentName,
        );
        didWarnAboutGetDerivedStateOnFunctionComponent[componentName] = true;
      }
    }

    if (
      typeof Component.contextType === 'object' &&
      Component.contextType !== null
    ) {
      const componentName = getComponentName(Component) || 'Unknown';

      if (!didWarnAboutContextTypeOnFunctionComponent[componentName]) {
        console.error(
          '%s: Function components do not support contextType.',
          componentName,
        );
        didWarnAboutContextTypeOnFunctionComponent[componentName] = true;
      }
    }
  }
}

const SUSPENDED_MARKER: SuspenseState = {
  dehydrated: null,
  retryTime: NoWork,
};

function shouldRemainOnFallback(
  suspenseContext: SuspenseContext,
  current: null | Fiber,
  workInProgress: Fiber,
) {
  // If the context is telling us that we should show a fallback, and we're not
  // already showing content, then we should show the fallback instead.
  return (
    hasSuspenseContext(
      suspenseContext,
      (ForceSuspenseFallback: SuspenseContext),
    ) &&
    (current === null || current.memoizedState !== null)
  );
}

function updateSuspenseComponent(
  current,
  workInProgress,
  renderExpirationTime,
) {
  const mode = workInProgress.mode;
  const nextProps = workInProgress.pendingProps;

  // This is used by DevTools to force a boundary to suspend.
  if (__DEV__) {
    if (shouldSuspend(workInProgress)) {
      workInProgress.effectTag |= DidCapture;
    }
  }

  let suspenseContext: SuspenseContext = suspenseStackCursor.current;

  let nextDidTimeout = false;
  const didSuspend = (workInProgress.effectTag & DidCapture) !== NoEffect;

  if (
    didSuspend ||
    shouldRemainOnFallback(suspenseContext, current, workInProgress)
  ) {
    // Something in this boundary's subtree already suspended. Switch to
    // rendering the fallback children.
    nextDidTimeout = true;
    workInProgress.effectTag &= ~DidCapture;
  } else {
    // Attempting the main content
    if (
      current === null ||
      (current.memoizedState: null | SuspenseState) !== null
    ) {
      // This is a new mount or this boundary is already showing a fallback state.
      // Mark this subtree context as having at least one invisible parent that could
      // handle the fallback state.
      // Boundaries without fallbacks or should be avoided are not considered since
      // they cannot handle preferred fallback states.
      if (
        nextProps.fallback !== undefined &&
        nextProps.unstable_avoidThisFallback !== true
      ) {
        suspenseContext = addSubtreeSuspenseContext(
          suspenseContext,
          InvisibleParentSuspenseContext,
        );
      }
    }
  }

  suspenseContext = setDefaultShallowSuspenseContext(suspenseContext);

  pushSuspenseContext(workInProgress, suspenseContext);

  // This next part is a bit confusing. If the children timeout, we switch to
  // showing the fallback children in place of the "primary" children.
  // However, we don't want to delete the primary children because then their
  // state will be lost (both the React state and the host state, e.g.
  // uncontrolled form inputs). Instead we keep them mounted and hide them.
  // Both the fallback children AND the primary children are rendered at the
  // same time. Once the primary children are un-suspended, we can delete
  // the fallback children — don't need to preserve their state.
  //
  // The two sets of children are siblings in the host environment, but
  // semantically, for purposes of reconciliation, they are two separate sets.
  // So we store them using two fragment fibers.
  //
  // However, we want to avoid allocating extra fibers for every placeholder.
  // They're only necessary when the children time out, because that's the
  // only time when both sets are mounted.
  //
  // So, the extra fragment fibers are only used if the children time out.
  // Otherwise, we render the primary children directly. This requires some
  // custom reconciliation logic to preserve the state of the primary
  // children. It's essentially a very basic form of re-parenting.

  if (current === null) {
    // If we're currently hydrating, try to hydrate this boundary.
    // But only if this has a fallback.
    if (nextProps.fallback !== undefined) {
      tryToClaimNextHydratableInstance(workInProgress);
      // This could've been a dehydrated suspense component.
      if (enableSuspenseServerRenderer) {
        const suspenseState: null | SuspenseState =
          workInProgress.memoizedState;
        if (suspenseState !== null) {
          const dehydrated = suspenseState.dehydrated;
          if (dehydrated !== null) {
            return mountDehydratedSuspenseComponent(
              workInProgress,
              dehydrated,
              renderExpirationTime,
            );
          }
        }
      }
    }

    // This is the initial mount. This branch is pretty simple because there's
    // no previous state that needs to be preserved.
    if (nextDidTimeout) {
      // Mount separate fragments for primary and fallback children.
      const nextFallbackChildren = nextProps.fallback;
      const primaryChildFragment = createFiberFromFragment(
        null,
        mode,
        NoWork,
        null,
      );
      primaryChildFragment.return = workInProgress;

      if ((workInProgress.mode & BlockingMode) === NoMode) {
        // Outside of blocking mode, we commit the effects from the
        // partially completed, timed-out tree, too.
        const progressedState: SuspenseState = workInProgress.memoizedState;
        const progressedPrimaryChild: Fiber | null =
          progressedState !== null
            ? (workInProgress.child: any).child
            : (workInProgress.child: any);
        primaryChildFragment.child = progressedPrimaryChild;
        let progressedChild = progressedPrimaryChild;
        while (progressedChild !== null) {
          progressedChild.return = primaryChildFragment;
          progressedChild = progressedChild.sibling;
        }
      }

      const fallbackChildFragment = createFiberFromFragment(
        nextFallbackChildren,
        mode,
        renderExpirationTime,
        null,
      );
      fallbackChildFragment.return = workInProgress;
      primaryChildFragment.sibling = fallbackChildFragment;
      // Skip the primary children, and continue working on the
      // fallback children.
      workInProgress.memoizedState = SUSPENDED_MARKER;
      workInProgress.child = primaryChildFragment;
      return fallbackChildFragment;
    } else {
      // Mount the primary children without an intermediate fragment fiber.
      const nextPrimaryChildren = nextProps.children;
      workInProgress.memoizedState = null;
      return (workInProgress.child = mountChildFibers(
        workInProgress,
        null,
        nextPrimaryChildren,
        renderExpirationTime,
      ));
    }
  } else {
    // This is an update. This branch is more complicated because we need to
    // ensure the state of the primary children is preserved.
    const prevState: null | SuspenseState = current.memoizedState;
    if (prevState !== null) {
      if (enableSuspenseServerRenderer) {
        const dehydrated = prevState.dehydrated;
        if (dehydrated !== null) {
          if (!didSuspend) {
            return updateDehydratedSuspenseComponent(
              current,
              workInProgress,
              dehydrated,
              prevState,
              renderExpirationTime,
            );
          } else if (
            (workInProgress.memoizedState: null | SuspenseState) !== null
          ) {
            // Something suspended and we should still be in dehydrated mode.
            // Leave the existing child in place.
            workInProgress.child = current.child;
            // The dehydrated completion pass expects this flag to be there
            // but the normal suspense pass doesn't.
            workInProgress.effectTag |= DidCapture;
            return null;
          } else {
            // Suspended but we should no longer be in dehydrated mode.
            // Therefore we now have to render the fallback. Wrap the children
            // in a fragment fiber to keep them separate from the fallback
            // children.
            const nextFallbackChildren = nextProps.fallback;
            const primaryChildFragment = createFiberFromFragment(
              // It shouldn't matter what the pending props are because we aren't
              // going to render this fragment.
              null,
              mode,
              NoWork,
              null,
            );
            primaryChildFragment.return = workInProgress;

            // This is always null since we never want the previous child
            // that we're not going to hydrate.
            primaryChildFragment.child = null;

            if ((workInProgress.mode & BlockingMode) === NoMode) {
              // Outside of blocking mode, we commit the effects from the
              // partially completed, timed-out tree, too.
              let progressedChild = (primaryChildFragment.child =
                workInProgress.child);
              while (progressedChild !== null) {
                progressedChild.return = primaryChildFragment;
                progressedChild = progressedChild.sibling;
              }
            } else {
              // We will have dropped the effect list which contains the deletion.
              // We need to reconcile to delete the current child.
              reconcileChildFibers(
                workInProgress,
                current.child,
                null,
                renderExpirationTime,
              );
            }

            // Because primaryChildFragment is a new fiber that we're inserting as the
            // parent of a new tree, we need to set its treeBaseDuration.
            if (enableProfilerTimer && workInProgress.mode & ProfileMode) {
              // treeBaseDuration is the sum of all the child tree base durations.
              let treeBaseDuration = 0;
              let hiddenChild = primaryChildFragment.child;
              while (hiddenChild !== null) {
                treeBaseDuration += hiddenChild.treeBaseDuration;
                hiddenChild = hiddenChild.sibling;
              }
              primaryChildFragment.treeBaseDuration = treeBaseDuration;
            }

            // Create a fragment from the fallback children, too.
            const fallbackChildFragment = createFiberFromFragment(
              nextFallbackChildren,
              mode,
              renderExpirationTime,
              null,
            );
            fallbackChildFragment.return = workInProgress;
            primaryChildFragment.sibling = fallbackChildFragment;
            fallbackChildFragment.effectTag |= Placement;
            primaryChildFragment.childExpirationTime = NoWork;

            workInProgress.memoizedState = SUSPENDED_MARKER;
            workInProgress.child = primaryChildFragment;

            // Skip the primary children, and continue working on the
            // fallback children.
            return fallbackChildFragment;
          }
        }
      }
      // The current tree already timed out. That means each child set is
      // wrapped in a fragment fiber.
      const currentPrimaryChildFragment: Fiber = (current.child: any);
      const currentFallbackChildFragment: Fiber = (currentPrimaryChildFragment.sibling: any);
      if (nextDidTimeout) {
        // Still timed out. Reuse the current primary children by cloning
        // its fragment. We're going to skip over these entirely.
        const nextFallbackChildren = nextProps.fallback;
        const primaryChildFragment = createWorkInProgress(
          currentPrimaryChildFragment,
          currentPrimaryChildFragment.pendingProps,
        );
        primaryChildFragment.return = workInProgress;

        if ((workInProgress.mode & BlockingMode) === NoMode) {
          // Outside of blocking mode, we commit the effects from the
          // partially completed, timed-out tree, too.
          const progressedState: SuspenseState = workInProgress.memoizedState;
          const progressedPrimaryChild: Fiber | null =
            progressedState !== null
              ? (workInProgress.child: any).child
              : (workInProgress.child: any);
          if (progressedPrimaryChild !== currentPrimaryChildFragment.child) {
            primaryChildFragment.child = progressedPrimaryChild;
            let progressedChild = progressedPrimaryChild;
            while (progressedChild !== null) {
              progressedChild.return = primaryChildFragment;
              progressedChild = progressedChild.sibling;
            }
          }
        }

        // Because primaryChildFragment is a new fiber that we're inserting as the
        // parent of a new tree, we need to set its treeBaseDuration.
        if (enableProfilerTimer && workInProgress.mode & ProfileMode) {
          // treeBaseDuration is the sum of all the child tree base durations.
          let treeBaseDuration = 0;
          let hiddenChild = primaryChildFragment.child;
          while (hiddenChild !== null) {
            treeBaseDuration += hiddenChild.treeBaseDuration;
            hiddenChild = hiddenChild.sibling;
          }
          primaryChildFragment.treeBaseDuration = treeBaseDuration;
        }

        // Clone the fallback child fragment, too. These we'll continue
        // working on.
        const fallbackChildFragment = createWorkInProgress(
          currentFallbackChildFragment,
          nextFallbackChildren,
        );
        fallbackChildFragment.return = workInProgress;
        primaryChildFragment.sibling = fallbackChildFragment;
        primaryChildFragment.childExpirationTime = NoWork;
        // Skip the primary children, and continue working on the
        // fallback children.
        workInProgress.memoizedState = SUSPENDED_MARKER;
        workInProgress.child = primaryChildFragment;
        return fallbackChildFragment;
      } else {
        // No longer suspended. Switch back to showing the primary children,
        // and remove the intermediate fragment fiber.
        const nextPrimaryChildren = nextProps.children;
        const currentPrimaryChild = currentPrimaryChildFragment.child;
        const primaryChild = reconcileChildFibers(
          workInProgress,
          currentPrimaryChild,
          nextPrimaryChildren,
          renderExpirationTime,
        );

        // If this render doesn't suspend, we need to delete the fallback
        // children. Wait until the complete phase, after we've confirmed the
        // fallback is no longer needed.
        // TODO: Would it be better to store the fallback fragment on
        // the stateNode?

        // Continue rendering the children, like we normally do.
        workInProgress.memoizedState = null;
        return (workInProgress.child = primaryChild);
      }
    } else {
      // The current tree has not already timed out. That means the primary
      // children are not wrapped in a fragment fiber.
      const currentPrimaryChild = current.child;
      if (nextDidTimeout) {
        // Timed out. Wrap the children in a fragment fiber to keep them
        // separate from the fallback children.
        const nextFallbackChildren = nextProps.fallback;
        const primaryChildFragment = createFiberFromFragment(
          // It shouldn't matter what the pending props are because we aren't
          // going to render this fragment.
          null,
          mode,
          NoWork,
          null,
        );
        primaryChildFragment.return = workInProgress;
        primaryChildFragment.child = currentPrimaryChild;
        if (currentPrimaryChild !== null) {
          currentPrimaryChild.return = primaryChildFragment;
        }

        // Even though we're creating a new fiber, there are no new children,
        // because we're reusing an already mounted tree. So we don't need to
        // schedule a placement.
        // primaryChildFragment.effectTag |= Placement;

        if ((workInProgress.mode & BlockingMode) === NoMode) {
          // Outside of blocking mode, we commit the effects from the
          // partially completed, timed-out tree, too.
          const progressedState: SuspenseState = workInProgress.memoizedState;
          const progressedPrimaryChild: Fiber | null =
            progressedState !== null
              ? (workInProgress.child: any).child
              : (workInProgress.child: any);
          primaryChildFragment.child = progressedPrimaryChild;
          let progressedChild = progressedPrimaryChild;
          while (progressedChild !== null) {
            progressedChild.return = primaryChildFragment;
            progressedChild = progressedChild.sibling;
          }
        }

        // Because primaryChildFragment is a new fiber that we're inserting as the
        // parent of a new tree, we need to set its treeBaseDuration.
        if (enableProfilerTimer && workInProgress.mode & ProfileMode) {
          // treeBaseDuration is the sum of all the child tree base durations.
          let treeBaseDuration = 0;
          let hiddenChild = primaryChildFragment.child;
          while (hiddenChild !== null) {
            treeBaseDuration += hiddenChild.treeBaseDuration;
            hiddenChild = hiddenChild.sibling;
          }
          primaryChildFragment.treeBaseDuration = treeBaseDuration;
        }

        // Create a fragment from the fallback children, too.
        const fallbackChildFragment = createFiberFromFragment(
          nextFallbackChildren,
          mode,
          renderExpirationTime,
          null,
        );
        fallbackChildFragment.return = workInProgress;
        primaryChildFragment.sibling = fallbackChildFragment;
        fallbackChildFragment.effectTag |= Placement;
        primaryChildFragment.childExpirationTime = NoWork;
        // Skip the primary children, and continue working on the
        // fallback children.
        workInProgress.memoizedState = SUSPENDED_MARKER;
        workInProgress.child = primaryChildFragment;
        return fallbackChildFragment;
      } else {
        // Still haven't timed out. Continue rendering the children, like we
        // normally do.
        workInProgress.memoizedState = null;
        const nextPrimaryChildren = nextProps.children;
        return (workInProgress.child = reconcileChildFibers(
          workInProgress,
          currentPrimaryChild,
          nextPrimaryChildren,
          renderExpirationTime,
        ));
      }
    }
  }
}

function retrySuspenseComponentWithoutHydrating(
  current: Fiber,
  workInProgress: Fiber,
  renderExpirationTime: ExpirationTime,
) {
  // We're now not suspended nor dehydrated.
  workInProgress.memoizedState = null;
  // Retry with the full children.
  const nextProps = workInProgress.pendingProps;
  const nextChildren = nextProps.children;
  // This will ensure that the children get Placement effects and
  // that the old child gets a Deletion effect.
  // We could also call forceUnmountCurrentAndReconcile.
  reconcileChildren(
    current,
    workInProgress,
    nextChildren,
    renderExpirationTime,
  );
  return workInProgress.child;
}

function mountDehydratedSuspenseComponent(
  workInProgress: Fiber,
  suspenseInstance: SuspenseInstance,
  renderExpirationTime: ExpirationTime,
): null | Fiber {
  // During the first pass, we'll bail out and not drill into the children.
  // Instead, we'll leave the content in place and try to hydrate it later.
  if ((workInProgress.mode & BlockingMode) === NoMode) {
    if (__DEV__) {
      console.error(
        'Cannot hydrate Suspense in legacy mode. Switch from ' +
          'ReactDOM.hydrate(element, container) to ' +
          'ReactDOM.createBlockingRoot(container, { hydrate: true })' +
          '.render(element) or remove the Suspense components from ' +
          'the server rendered components.',
      );
    }
    workInProgress.expirationTime = Sync;
  } else if (isSuspenseInstanceFallback(suspenseInstance)) {
    // This is a client-only boundary. Since we won't get any content from the server
    // for this, we need to schedule that at a higher priority based on when it would
    // have timed out. In theory we could render it in this pass but it would have the
    // wrong priority associated with it and will prevent hydration of parent path.
    // Instead, we'll leave work left on it to render it in a separate commit.

    // TODO This time should be the time at which the server rendered response that is
    // a parent to this boundary was displayed. However, since we currently don't have
    // a protocol to transfer that time, we'll just estimate it by using the current
    // time. This will mean that Suspense timeouts are slightly shifted to later than
    // they should be.
    let serverDisplayTime = requestCurrentTimeForUpdate();
    // Schedule a normal pri update to render this content.
    let newExpirationTime = computeAsyncExpiration(serverDisplayTime);
    if (enableSchedulerTracing) {
      markSpawnedWork(newExpirationTime);
    }
    workInProgress.expirationTime = newExpirationTime;
  } else {
    // We'll continue hydrating the rest at offscreen priority since we'll already
    // be showing the right content coming from the server, it is no rush.
    workInProgress.expirationTime = Never;
    if (enableSchedulerTracing) {
      markSpawnedWork(Never);
    }
  }
  return null;
}

function updateDehydratedSuspenseComponent(
  current: Fiber,
  workInProgress: Fiber,
  suspenseInstance: SuspenseInstance,
  suspenseState: SuspenseState,
  renderExpirationTime: ExpirationTime,
): null | Fiber {
  // We should never be hydrating at this point because it is the first pass,
  // but after we've already committed once.
  warnIfHydrating();

  if ((workInProgress.mode & BlockingMode) === NoMode) {
    return retrySuspenseComponentWithoutHydrating(
      current,
      workInProgress,
      renderExpirationTime,
    );
  }

  if (isSuspenseInstanceFallback(suspenseInstance)) {
    // This boundary is in a permanent fallback state. In this case, we'll never
    // get an update and we'll never be able to hydrate the final content. Let's just try the
    // client side render instead.
    return retrySuspenseComponentWithoutHydrating(
      current,
      workInProgress,
      renderExpirationTime,
    );
  }
  // We use childExpirationTime to indicate that a child might depend on context, so if
  // any context has changed, we need to treat is as if the input might have changed.
  const hasContextChanged = current.childExpirationTime >= renderExpirationTime;
  if (didReceiveUpdate || hasContextChanged) {
    // This boundary has changed since the first render. This means that we are now unable to
    // hydrate it. We might still be able to hydrate it using an earlier expiration time, if
    // we are rendering at lower expiration than sync.
    if (renderExpirationTime < Sync) {
      if (suspenseState.retryTime <= renderExpirationTime) {
        // This render is even higher pri than we've seen before, let's try again
        // at even higher pri.
        let attemptHydrationAtExpirationTime = renderExpirationTime + 1;
        suspenseState.retryTime = attemptHydrationAtExpirationTime;
        scheduleWork(current, attemptHydrationAtExpirationTime);
        // TODO: Early abort this render.
      } else {
        // We have already tried to ping at a higher priority than we're rendering with
        // so if we got here, we must have failed to hydrate at those levels. We must
        // now give up. Instead, we're going to delete the whole subtree and instead inject
        // a new real Suspense boundary to take its place, which may render content
        // or fallback. This might suspend for a while and if it does we might still have
        // an opportunity to hydrate before this pass commits.
      }
    }
    // If we have scheduled higher pri work above, this will probably just abort the render
    // since we now have higher priority work, but in case it doesn't, we need to prepare to
    // render something, if we time out. Even if that requires us to delete everything and
    // skip hydration.
    // Delay having to do this as long as the suspense timeout allows us.
    renderDidSuspendDelayIfPossible();
    return retrySuspenseComponentWithoutHydrating(
      current,
      workInProgress,
      renderExpirationTime,
    );
  } else if (isSuspenseInstancePending(suspenseInstance)) {
    // This component is still pending more data from the server, so we can't hydrate its
    // content. We treat it as if this component suspended itself. It might seem as if
    // we could just try to render it client-side instead. However, this will perform a
    // lot of unnecessary work and is unlikely to complete since it often will suspend
    // on missing data anyway. Additionally, the server might be able to render more
    // than we can on the client yet. In that case we'd end up with more fallback states
    // on the client than if we just leave it alone. If the server times out or errors
    // these should update this boundary to the permanent Fallback state instead.
    // Mark it as having captured (i.e. suspended).
    workInProgress.effectTag |= DidCapture;
    // Leave the child in place. I.e. the dehydrated fragment.
    workInProgress.child = current.child;
    // Register a callback to retry this boundary once the server has sent the result.
    registerSuspenseInstanceRetry(
      suspenseInstance,
      retryDehydratedSuspenseBoundary.bind(null, current),
    );
    return null;
  } else {
    // This is the first attempt.
    reenterHydrationStateFromDehydratedSuspenseInstance(
      workInProgress,
      suspenseInstance,
    );
    const nextProps = workInProgress.pendingProps;
    const nextChildren = nextProps.children;
    const child = mountChildFibers(
      workInProgress,
      null,
      nextChildren,
      renderExpirationTime,
    );
    let node = child;
    while (node) {
      // Mark each child as hydrating. This is a fast path to know whether this
      // tree is part of a hydrating tree. This is used to determine if a child
      // node has fully mounted yet, and for scheduling event replaying.
      // Conceptually this is similar to Placement in that a new subtree is
      // inserted into the React tree here. It just happens to not need DOM
      // mutations because it already exists.
      node.effectTag |= Hydrating;
      node = node.sibling;
    }
    workInProgress.child = child;
    return workInProgress.child;
  }
}+


function scheduleWorkOnFiber(
  fiber: Fiber,
  renderExpirationTime: ExpirationTime,
) {
  if (fiber.expirationTime < renderExpirationTime) {
    fiber.expirationTime = renderExpirationTime;
  }
  let alternate = fiber.alternate;
  if (alternate !== null && alternate.expirationTime < renderExpirationTime) {
    alternate.expirationTime = renderExpirationTime;
  }
  scheduleWorkOnParentPath(fiber.return, renderExpirationTime);
}

function propagateSuspenseContextChange(
  workInProgress: Fiber,
  firstChild: null | Fiber,
  renderExpirationTime: ExpirationTime,
): void {
  // Mark any Suspense boundaries with fallbacks as having work to do.
  // If they were previously forced into fallbacks, they may now be able
  // to unblock.
  let node = firstChild;
  while (node !== null) {
    if (node.tag === SuspenseComponent) {
      const state: SuspenseState | null = node.memoizedState;
      if (state !== null) {
        scheduleWorkOnFiber(node, renderExpirationTime);
      }
    } else if (node.tag === SuspenseListComponent) {
      // If the tail is hidden there might not be an Suspense boundaries
      // to schedule work on. In this case we have to schedule it on the
      // list itself.
      // We don't have to traverse to the children of the list since
      // the list will propagate the change when it rerenders.
      scheduleWorkOnFiber(node, renderExpirationTime);
    } else if (node.child !== null) {
      node.child.return = node;
      node = node.child;
      continue;
    }
    if (node === workInProgress) {
      return;
    }
    while (node.sibling === null) {
      if (node.return === null || node.return === workInProgress) {
        return;
      }
      node = node.return;
    }
    node.sibling.return = node.return;
    node = node.sibling;
  }
}

function findLastContentRow(firstChild: null | Fiber): null | Fiber {
  // This is going to find the last row among these children that is already
  // showing content on the screen, as opposed to being in fallback state or
  // new. If a row has multiple Suspense boundaries, any of them being in the
  // fallback state, counts as the whole row being in a fallback state.
  // Note that the "rows" will be workInProgress, but any nested children
  // will still be current since we haven't rendered them yet. The mounted
  // order may not be the same as the new order. We use the new order.
  let row = firstChild;
  let lastContentRow: null | Fiber = null;
  while (row !== null) {
    let currentRow = row.alternate;
    // New rows can't be content rows.
    if (currentRow !== null && findFirstSuspended(currentRow) === null) {
      lastContentRow = row;
    }
    row = row.sibling;
  }
  return lastContentRow;
}

type SuspenseListRevealOrder = 'forwards' | 'backwards' | 'together' | void;

function validateRevealOrder(revealOrder: SuspenseListRevealOrder) {
  if (__DEV__) {
    if (
      revealOrder !== undefined &&
      revealOrder !== 'forwards' &&
      revealOrder !== 'backwards' &&
      revealOrder !== 'together' &&
      !didWarnAboutRevealOrder[revealOrder]
    ) {
      didWarnAboutRevealOrder[revealOrder] = true;
      if (typeof revealOrder === 'string') {
        switch (revealOrder.toLowerCase()) {
          case 'together':
          case 'forwards':
          case 'backwards': {
            console.error(
              '"%s" is not a valid value for revealOrder on <SuspenseList />. ' +
                'Use lowercase "%s" instead.',
              revealOrder,
              revealOrder.toLowerCase(),
            );
            break;
          }
          case 'forward':
          case 'backward': {
            console.error(
              '"%s" is not a valid value for revealOrder on <SuspenseList />. ' +
                'React uses the -s suffix in the spelling. Use "%ss" instead.',
              revealOrder,
              revealOrder.toLowerCase(),
            );
            break;
          }
          default:
            console.error(
              '"%s" is not a supported revealOrder on <SuspenseList />. ' +
                'Did you mean "together", "forwards" or "backwards"?',
              revealOrder,
            );
            break;
        }
      } else {
        console.error(
          '%s is not a supported value for revealOrder on <SuspenseList />. ' +
            'Did you mean "together", "forwards" or "backwards"?',
          revealOrder,
        );
      }
    }
  }
}

function validateTailOptions(
  tailMode: SuspenseListTailMode,
  revealOrder: SuspenseListRevealOrder,
) {
  if (__DEV__) {
    if (tailMode !== undefined && !didWarnAboutTailOptions[tailMode]) {
      if (tailMode !== 'collapsed' && tailMode !== 'hidden') {
        didWarnAboutTailOptions[tailMode] = true;
        console.error(
          '"%s" is not a supported value for tail on <SuspenseList />. ' +
            'Did you mean "collapsed" or "hidden"?',
          tailMode,
        );
      } else if (revealOrder !== 'forwards' && revealOrder !== 'backwards') {
        didWarnAboutTailOptions[tailMode] = true;
        console.error(
          '<SuspenseList tail="%s" /> is only valid if revealOrder is ' +
            '"forwards" or "backwards". ' +
            'Did you mean to specify revealOrder="forwards"?',
          tailMode,
        );
      }
    }
  }
}

function validateSuspenseListNestedChild(childSlot: mixed, index: number) {
  if (__DEV__) {
    let isArray = Array.isArray(childSlot);
    let isIterable = !isArray && typeof getIteratorFn(childSlot) === 'function';
    if (isArray || isIterable) {
      let type = isArray ? 'array' : 'iterable';
      console.error(
        'A nested %s was passed to row #%s in <SuspenseList />. Wrap it in ' +
          'an additional SuspenseList to configure its revealOrder: ' +
          '<SuspenseList revealOrder=...> ... ' +
          '<SuspenseList revealOrder=...>{%s}</SuspenseList> ... ' +
          '</SuspenseList>',
        type,
        index,
        type,
      );
      return false;
    }
  }
  return true;
}

function validateSuspenseListChildren(
  children: mixed,
  revealOrder: SuspenseListRevealOrder,
) {
  if (__DEV__) {
    if (
      (revealOrder === 'forwards' || revealOrder === 'backwards') &&
      children !== undefined &&
      children !== null &&
      children !== false
    ) {
      if (Array.isArray(children)) {
        for (let i = 0; i < children.length; i++) {
          if (!validateSuspenseListNestedChild(children[i], i)) {
            return;
          }
        }
      } else {
        let iteratorFn = getIteratorFn(children);
        if (typeof iteratorFn === 'function') {
          const childrenIterator = iteratorFn.call(children);
          if (childrenIterator) {
            let step = childrenIterator.next();
            let i = 0;
            for (; !step.done; step = childrenIterator.next()) {
              if (!validateSuspenseListNestedChild(step.value, i)) {
                return;
              }
              i++;
            }
          }
        } else {
          console.error(
            'A single row was passed to a <SuspenseList revealOrder="%s" />. ' +
              'This is not useful since it needs multiple rows. ' +
              'Did you mean to pass multiple children or an array?',
            revealOrder,
          );
        }
      }
    }
  }
}

function initSuspenseListRenderState(
  workInProgress: Fiber,
  isBackwards: boolean,
  tail: null | Fiber,
  lastContentRow: null | Fiber,
  tailMode: SuspenseListTailMode,
  lastEffectBeforeRendering: null | Fiber,
): void {
  let renderState: null | SuspenseListRenderState =
    workInProgress.memoizedState;
  if (renderState === null) {
    workInProgress.memoizedState = ({
      isBackwards: isBackwards,
      rendering: null,
      renderingStartTime: 0,
      last: lastContentRow,
      tail: tail,
      tailExpiration: 0,
      tailMode: tailMode,
      lastEffect: lastEffectBeforeRendering,
    }: SuspenseListRenderState);
  } else {
    // We can reuse the existing object from previous renders.
    renderState.isBackwards = isBackwards;
    renderState.rendering = null;
    renderState.renderingStartTime = 0;
    renderState.last = lastContentRow;
    renderState.tail = tail;
    renderState.tailExpiration = 0;
    renderState.tailMode = tailMode;
    renderState.lastEffect = lastEffectBeforeRendering;
  }
}

// This can end up rendering this component multiple passes.
// The first pass splits the children fibers into two sets. A head and tail.
// We first render the head. If anything is in fallback state, we do another
// pass through beginWork to rerender all children (including the tail) with
// the force suspend context. If the first render didn't have anything in
// in fallback state. Then we render each row in the tail one-by-one.
// That happens in the completeWork phase without going back to beginWork.
function updateSuspenseListComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  renderExpirationTime: ExpirationTime,
) {
  const nextProps = workInProgress.pendingProps;
  const revealOrder: SuspenseListRevealOrder = nextProps.revealOrder;
  const tailMode: SuspenseListTailMode = nextProps.tail;
  const newChildren = nextProps.children;

  validateRevealOrder(revealOrder);
  validateTailOptions(tailMode, revealOrder);
  validateSuspenseListChildren(newChildren, revealOrder);

  reconcileChildren(current, workInProgress, newChildren, renderExpirationTime);

  let suspenseContext: SuspenseContext = suspenseStackCursor.current;

  let shouldForceFallback = hasSuspenseContext(
    suspenseContext,
    (ForceSuspenseFallback: SuspenseContext),
  );
  if (shouldForceFallback) {
    suspenseContext = setShallowSuspenseContext(
      suspenseContext,
      ForceSuspenseFallback,
    );
    workInProgress.effectTag |= DidCapture;
  } else {
    const didSuspendBefore =
      current !== null && (current.effectTag & DidCapture) !== NoEffect;
    if (didSuspendBefore) {
      // If we previously forced a fallback, we need to schedule work
      // on any nested boundaries to let them know to try to render
      // again. This is the same as context updating.
      propagateSuspenseContextChange(
        workInProgress,
        workInProgress.child,
        renderExpirationTime,
      );
    }
    suspenseContext = setDefaultShallowSuspenseContext(suspenseContext);
  }
  pushSuspenseContext(workInProgress, suspenseContext);

  if ((workInProgress.mode & BlockingMode) === NoMode) {
    // Outside of blocking mode, SuspenseList doesn't work so we just
    // use make it a noop by treating it as the default revealOrder.
    workInProgress.memoizedState = null;
  } else {
    switch (revealOrder) {
      case 'forwards': {
        let lastContentRow = findLastContentRow(workInProgress.child);
        let tail;
        if (lastContentRow === null) {
          // The whole list is part of the tail.
          // TODO: We could fast path by just rendering the tail now.
          tail = workInProgress.child;
          workInProgress.child = null;
        } else {
          // Disconnect the tail rows after the content row.
          // We're going to render them separately later.
          tail = lastContentRow.sibling;
          lastContentRow.sibling = null;
        }
        initSuspenseListRenderState(
          workInProgress,
          false, // isBackwards
          tail,
          lastContentRow,
          tailMode,
          workInProgress.lastEffect,
        );
        break;
      }
      case 'backwards': {
        // We're going to find the first row that has existing content.
        // At the same time we're going to reverse the list of everything
        // we pass in the meantime. That's going to be our tail in reverse
        // order.
        let tail = null;
        let row = workInProgress.child;
        workInProgress.child = null;
        while (row !== null) {
          let currentRow = row.alternate;
          // New rows can't be content rows.
          if (currentRow !== null && findFirstSuspended(currentRow) === null) {
            // This is the beginning of the main content.
            workInProgress.child = row;
            break;
          }
          let nextRow = row.sibling;
          row.sibling = tail;
          tail = row;
          row = nextRow;
        }
        // TODO: If workInProgress.child is null, we can continue on the tail immediately.
        initSuspenseListRenderState(
          workInProgress,
          true, // isBackwards
          tail,
          null, // last
          tailMode,
          workInProgress.lastEffect,
        );
        break;
      }
      case 'together': {
        initSuspenseListRenderState(
          workInProgress,
          false, // isBackwards
          null, // tail
          null, // last
          undefined,
          workInProgress.lastEffect,
        );
        break;
      }
      default: {
        // The default reveal order is the same as not having
        // a boundary.
        workInProgress.memoizedState = null;
      }
    }
  }
  return workInProgress.child;
}

function updatePortalComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  renderExpirationTime: ExpirationTime,
) {
  pushHostContainer(workInProgress, workInProgress.stateNode.containerInfo);
  const nextChildren = workInProgress.pendingProps;
  if (current === null) {
    // Portals are special because we don't append the children during mount
    // but at commit. Therefore we need to track insertions which the normal
    // flow doesn't do during mount. This doesn't happen at the root because
    // the root always starts with a "current" with a null child.
    // TODO: Consider unifying this with how the root works.
    workInProgress.child = reconcileChildFibers(
      workInProgress,
      null,
      nextChildren,
      renderExpirationTime,
    );
  } else {
    reconcileChildren(
      current,
      workInProgress,
      nextChildren,
      renderExpirationTime,
    );
  }
  return workInProgress.child;
}

// 处理context Provider组件
function updateContextProvider(
  current: Fiber | null,
  workInProgress: Fiber,
  renderExpirationTime: ExpirationTime,
) {
  const providerType: ReactProviderType<any> = workInProgress.type;
  const context: ReactContext<any> = providerType._context;

  // 提取新旧属性和新的值
  const newProps = workInProgress.pendingProps;
  const oldProps = workInProgress.memoizedProps;

  const newValue = newProps.value;

  if (__DEV__) {
    const providerPropTypes = workInProgress.type.propTypes;

    if (providerPropTypes) {
      checkPropTypes(
        providerPropTypes,
        newProps,
        'prop',
        'Context.Provider',
        getCurrentFiberStackInDev,
      );
    }
  }

  // 修改context中的值为新值
  pushProvider(workInProgress, newValue);

  if (oldProps !== null) {
    const oldValue = oldProps.value;
    const changedBits = calculateChangedBits(context, newValue, oldValue); //可以通过自定义的判断看是否跳过此次context的更新
    if (changedBits === 0) {
      // No change. Bailout early if children are the same.没有发生变化不需要进行更新
      if (
        oldProps.children === newProps.children &&
        !hasLegacyContextChanged()
      ) {
        return bailoutOnAlreadyFinishedWork(
          current,
          workInProgress,
          renderExpirationTime,
        );
      }
    } else {
      // The context value changed. Search for matching consumers and schedule
      // them to update. 找到匹配的consumers进行更新
      propagateContextChange(
        workInProgress,
        context,
        changedBits,
        renderExpirationTime,
      );
    }
  }

  const newChildren = newProps.children;
  reconcileChildren(current, workInProgress, newChildren, renderExpirationTime);
  return workInProgress.child;
}

let hasWarnedAboutUsingContextAsConsumer = false;

function updateContextConsumer(
  current: Fiber | null,
  workInProgress: Fiber,
  renderExpirationTime: ExpirationTime,
) {
  let context: ReactContext<any> = workInProgress.type;
  // The logic below for Context differs depending on PROD or DEV mode. In
  // DEV mode, we create a separate object for Context.Consumer that acts
  // like a proxy to Context. This proxy object adds unnecessary code in PROD
  // so we use the old behaviour (Context.Consumer references Context) to
  // reduce size and overhead. The separate object references context via
  // a property called "_context", which also gives us the ability to check
  // in DEV mode if this property exists or not and warn if it does not.
  if (__DEV__) {
    if ((context: any)._context === undefined) {
      // This may be because it's a Context (rather than a Consumer).
      // Or it may be because it's older React where they're the same thing.
      // We only want to warn if we're sure it's a new React.
      if (context !== context.Consumer) {
        if (!hasWarnedAboutUsingContextAsConsumer) {
          hasWarnedAboutUsingContextAsConsumer = true;
          console.error(
            'Rendering <Context> directly is not supported and will be removed in ' +
              'a future major release. Did you mean to render <Context.Consumer> instead?',
          );
        }
      }
    } else {
      context = (context: any)._context;
    }
  }
  const newProps = workInProgress.pendingProps;
  const render = newProps.children;

  if (__DEV__) {
    if (typeof render !== 'function') {
      console.error(
        'A context consumer was rendered with multiple children, or a child ' +
          "that isn't a function. A context consumer expects a single child " +
          'that is a function. If you did pass a function, make sure there ' +
          'is no trailing or leading whitespace around it.',
      );
    }
  }

  prepareToReadContext(workInProgress, renderExpirationTime);
  const newValue = readContext(context, newProps.unstable_observedBits);
  let newChildren;
  if (__DEV__) {
    ReactCurrentOwner.current = workInProgress;
    setIsRendering(true);
    newChildren = render(newValue);
    setIsRendering(false);
  } else {
    newChildren = render(newValue);
  }

  // React DevTools reads this flag.
  workInProgress.effectTag |= PerformedWork;
  reconcileChildren(current, workInProgress, newChildren, renderExpirationTime);
  return workInProgress.child;
}

function updateFundamentalComponent(
  current,
  workInProgress,
  renderExpirationTime,
) {
  const fundamentalImpl = workInProgress.type.impl;
  if (fundamentalImpl.reconcileChildren === false) {
    return null;
  }
  const nextProps = workInProgress.pendingProps;
  const nextChildren = nextProps.children;

  reconcileChildren(
    current,
    workInProgress,
    nextChildren,
    renderExpirationTime,
  );
  return workInProgress.child;
}

function updateScopeComponent(current, workInProgress, renderExpirationTime) {
  const nextProps = workInProgress.pendingProps;
  const nextChildren = nextProps.children;

  reconcileChildren(
    current,
    workInProgress,
    nextChildren,
    renderExpirationTime,
  );
  return workInProgress.child;
}

export function markWorkInProgressReceivedUpdate() {
  didReceiveUpdate = true;
}

// 提交标记fiber节点为完成 这样子树就不用再次遍历 属于优化的过程
function bailoutOnAlreadyFinishedWork(
  current: Fiber | null,
  workInProgress: Fiber,
  renderExpirationTime: ExpirationTime,
): Fiber | null {
  cancelWorkTimer(workInProgress);

  if (current !== null) {
    // Reuse previous dependencies
    workInProgress.dependencies = current.dependencies;
  }

  if (enableProfilerTimer) {
    // Don't update "base" render times for bailouts.
    stopProfilerTimerIfRunning(workInProgress);
  }

  const updateExpirationTime = workInProgress.expirationTime;
  if (updateExpirationTime !== NoWork) {
    markUnprocessedUpdateTime(updateExpirationTime);
  }

  // Check if the children have any pending work.
  const childExpirationTime = workInProgress.childExpirationTime;
  if (childExpirationTime < renderExpirationTime) {
    // The children don't have any work either. We can skip them.
    // TODO: Once we add back resuming, we should check if the children are
    // a work-in-progress set. If so, we need to transfer their effects.
    return null;
  } else {
    // This fiber doesn't have work, but its subtree does. Clone the child
    // fibers and continue.
    // 当球按子节点没有更新但是其子节点可能有因此复制子节点然后返回子节点继续循环
    cloneChildFibers(current, workInProgress);
    return workInProgress.child;
  }
}

function remountFiber(
  current: Fiber,
  oldWorkInProgress: Fiber,
  newWorkInProgress: Fiber,
): Fiber | null {
  if (__DEV__) {
    const returnFiber = oldWorkInProgress.return;
    if (returnFiber === null) {
      throw new Error('Cannot swap the root fiber.');
    }

    // Disconnect from the old current.
    // It will get deleted.
    current.alternate = null;
    oldWorkInProgress.alternate = null;

    // Connect to the new tree.
    newWorkInProgress.index = oldWorkInProgress.index;
    newWorkInProgress.sibling = oldWorkInProgress.sibling;
    newWorkInProgress.return = oldWorkInProgress.return;
    newWorkInProgress.ref = oldWorkInProgress.ref;

    // Replace the child/sibling pointers above it.
    if (oldWorkInProgress === returnFiber.child) {
      returnFiber.child = newWorkInProgress;
    } else {
      let prevSibling = returnFiber.child;
      if (prevSibling === null) {
        throw new Error('Expected parent to have a child.');
      }
      while (prevSibling.sibling !== oldWorkInProgress) {
        prevSibling = prevSibling.sibling;
        if (prevSibling === null) {
          throw new Error('Expected to find the previous sibling.');
        }
      }
      prevSibling.sibling = newWorkInProgress;
    }

    // Delete the old fiber and place the new one.
    // Since the old fiber is disconnected, we have to schedule it manually.
    const last = returnFiber.lastEffect;
    if (last !== null) {
      last.nextEffect = current;
      returnFiber.lastEffect = current;
    } else {
      returnFiber.firstEffect = returnFiber.lastEffect = current;
    }
    current.nextEffect = null;
    current.effectTag = Deletion;

    newWorkInProgress.effectTag |= Placement;

    // Restart work from the new fiber.
    return newWorkInProgress;
  } else {
    throw new Error(
      'Did not expect this call in production. ' +
        'This is a bug in React. Please file an issue.',
    );
  }
}

// 每一个fiber节点进行处理
// current为原始fiber节点  workInProgress为未来版本中的节点  renderExpirationTime  render阶段的过期时间
function beginWork( 
  current: Fiber | null,
  workInProgress: Fiber,
  renderExpirationTime: ExpirationTime,
): Fiber | null {
  const updateExpirationTime = workInProgress.expirationTime;

  if (__DEV__) {
    if (workInProgress._debugNeedsRemount && current !== null) {
      // This will restart the begin phase with a new fiber.
      // 重新绑定fiber节点
      return remountFiber(
        current,
        workInProgress,
        createFiberFromTypeAndProps(
          workInProgress.type,
          workInProgress.key,
          workInProgress.pendingProps,
          workInProgress._debugOwner || null,
          workInProgress.mode,
          workInProgress.expirationTime,
        ),
      );
    }
  }

  if (current !== null) { //更新操作
    const oldProps = current.memoizedProps;
    const newProps = workInProgress.pendingProps;

    if (
      oldProps !== newProps ||
      hasLegacyContextChanged() ||
      // Force a re-render if the implementation changed due to hot reload:
      (__DEV__ ? workInProgress.type !== current.type : false)
    ) {
      // If props or context changed, mark the fiber as having performed work.
      // This may be unset if the props are determined to be equal later (memo).
      // 属性不一致 或者 订阅的context的发生变化表明组件存在更新
      didReceiveUpdate = true;
    } else if (updateExpirationTime < renderExpirationTime) {
      //TODO:  没有待处理的属性
      didReceiveUpdate = false;
      // This fiber does not have any pending work. Bailout without entering
      // the begin phase. There's still some bookkeeping we that needs to be done
      // in this optimized path, mostly pushing stuff onto the stack.
      // 处理上下文
      switch (workInProgress.tag) {
        case HostRoot:
          pushHostRootContext(workInProgress);
          resetHydrationState();
          break;
        case HostComponent:
          pushHostContext(workInProgress);
          if (
            workInProgress.mode & ConcurrentMode &&
            renderExpirationTime !== Never &&
            shouldDeprioritizeSubtree(workInProgress.type, newProps)
          ) {
            if (enableSchedulerTracing) {
              markSpawnedWork(Never);
            }
            // Schedule this fiber to re-render at offscreen priority. Then bailout.
            workInProgress.expirationTime = workInProgress.childExpirationTime = Never;
            return null;
          }
          break;
        case ClassComponent: {
          const Component = workInProgress.type;
          if (isLegacyContextProvider(Component)) {
            pushLegacyContextProvider(workInProgress);
          }
          break;
        }
        case HostPortal:
          pushHostContainer(
            workInProgress,
            workInProgress.stateNode.containerInfo,
          );
          break;
        case ContextProvider: {
          const newValue = workInProgress.memoizedProps.value;
          pushProvider(workInProgress, newValue);
          break;
        }
        case Profiler:
          if (enableProfilerTimer) {
            // Profiler should only call onRender when one of its descendants actually rendered.
            const hasChildWork =
              workInProgress.childExpirationTime >= renderExpirationTime;
            if (hasChildWork) {
              workInProgress.effectTag |= Update;
            }
          }
          break;
        case SuspenseComponent: {
          const state: SuspenseState | null = workInProgress.memoizedState;
          if (state !== null) {
            if (enableSuspenseServerRenderer) {
              if (state.dehydrated !== null) {
                pushSuspenseContext(
                  workInProgress,
                  setDefaultShallowSuspenseContext(suspenseStackCursor.current),
                );
                // We know that this component will suspend again because if it has
                // been unsuspended it has committed as a resolved Suspense component.
                // If it needs to be retried, it should have work scheduled on it.
                workInProgress.effectTag |= DidCapture;
                break;
              }
            }

            // If this boundary is currently timed out, we need to decide
            // whether to retry the primary children, or to skip over it and
            // go straight to the fallback. Check the priority of the primary
            // child fragment.
            const primaryChildFragment: Fiber = (workInProgress.child: any);
            const primaryChildExpirationTime =
              primaryChildFragment.childExpirationTime;
            if (
              primaryChildExpirationTime !== NoWork &&
              primaryChildExpirationTime >= renderExpirationTime
            ) {
              // The primary children have pending work. Use the normal path
              // to attempt to render the primary children again.
              return updateSuspenseComponent(
                current,
                workInProgress,
                renderExpirationTime,
              );
            } else {
              pushSuspenseContext(
                workInProgress,
                setDefaultShallowSuspenseContext(suspenseStackCursor.current),
              );
              // The primary children do not have pending work with sufficient
              // priority. Bailout.
              const child = bailoutOnAlreadyFinishedWork(
                current,
                workInProgress,
                renderExpirationTime,
              );
              if (child !== null) {
                // The fallback children have pending work. Skip over the
                // primary children and work on the fallback.
                return child.sibling;
              } else {
                return null;
              }
            }
          } else {
            pushSuspenseContext(
              workInProgress,
              setDefaultShallowSuspenseContext(suspenseStackCursor.current),
            );
          }
          break;
        }
        case SuspenseListComponent: {
          const didSuspendBefore =
            (current.effectTag & DidCapture) !== NoEffect;

          const hasChildWork =
            workInProgress.childExpirationTime >= renderExpirationTime;

          if (didSuspendBefore) {
            if (hasChildWork) {
              // If something was in fallback state last time, and we have all the
              // same children then we're still in progressive loading state.
              // Something might get unblocked by state updates or retries in the
              // tree which will affect the tail. So we need to use the normal
              // path to compute the correct tail.
              return updateSuspenseListComponent(
                current,
                workInProgress,
                renderExpirationTime,
              );
            }
            // If none of the children had any work, that means that none of
            // them got retried so they'll still be blocked in the same way
            // as before. We can fast bail out.
            workInProgress.effectTag |= DidCapture;
          }

          // If nothing suspended before and we're rendering the same children,
          // then the tail doesn't matter. Anything new that suspends will work
          // in the "together" mode, so we can continue from the state we had.
          let renderState = workInProgress.memoizedState;
          if (renderState !== null) {
            // Reset to the "together" mode in case we've started a different
            // update in the past but didn't complete it.
            renderState.rendering = null;
            renderState.tail = null;
          }
          pushSuspenseContext(workInProgress, suspenseStackCursor.current);

          if (hasChildWork) {
            break;
          } else {
            // If none of the children had any work, that means that none of
            // them got retried so they'll still be blocked in the same way
            // as before. We can fast bail out.
            return null;
          }
        }
      }
      return bailoutOnAlreadyFinishedWork(
        current,
        workInProgress,
        renderExpirationTime,
      );
    } else {
      // An update was scheduled on this fiber, but there are no new props
      // nor legacy context. Set this to false. If an update queue or context
      // consumer produces a changed value, it will set this to true. Otherwise,
      // the component will assume the children have not changed and bail out.
      // TODO props 以及context都没有变化  可能这个节点不需要处理更新  性能优化的手段
      didReceiveUpdate = false;
    }
  } else {
    didReceiveUpdate = false;
  }

  // Before entering the begin phase, clear pending update priority.
  // TODO: This assumes that we're about to evaluate the component and process
  // the update queue. However, there's an exception: SimpleMemoComponent
  // sometimes bails out later in the begin phase. This indicates that we should
  // move this assignment out of the common path and into each branch.
  // 节点处理之后将其expirationTime只为NoWork避免重复处理
  workInProgress.expirationTime = NoWork;

  // 不同类型的组件执行不同的更新操作
  switch (workInProgress.tag) {
    case IndeterminateComponent: {
      return mountIndeterminateComponent(
        current,
        workInProgress,
        workInProgress.type,
        renderExpirationTime,
      );
    }
    case LazyComponent: {
      const elementType = workInProgress.elementType;
      return mountLazyComponent(
        current,
        workInProgress,
        elementType,
        updateExpirationTime,
        renderExpirationTime,
      );
    }
    case FunctionComponent: {
      const Component = workInProgress.type;
      const unresolvedProps = workInProgress.pendingProps;
      const resolvedProps =
        workInProgress.elementType === Component
          ? unresolvedProps
          : resolveDefaultProps(Component, unresolvedProps);
      return updateFunctionComponent(
        current,
        workInProgress,
        Component,
        resolvedProps,
        renderExpirationTime,
      );
    }
    case ClassComponent: {
      const Component = workInProgress.type;
      const unresolvedProps = workInProgress.pendingProps;//新的组件属性
      const resolvedProps =
        workInProgress.elementType === Component
          ? unresolvedProps
          : resolveDefaultProps(Component, unresolvedProps);//使用默认属性
      return updateClassComponent(
        current,
        workInProgress,
        Component,
        resolvedProps,
        renderExpirationTime,
      );
    }
    case HostRoot:
      // 更新host root节点
      return updateHostRoot(current, workInProgress, renderExpirationTime);
    case HostComponent:
      return updateHostComponent(current, workInProgress, renderExpirationTime);
    case HostText:
      return updateHostText(current, workInProgress);
    case SuspenseComponent:
      return updateSuspenseComponent(
        current,
        workInProgress,
        renderExpirationTime,
      );
    case HostPortal:
      return updatePortalComponent(
        current,
        workInProgress,
        renderExpirationTime,
      );
    case ForwardRef: {
      const type = workInProgress.type;
      const unresolvedProps = workInProgress.pendingProps;
      const resolvedProps =
        workInProgress.elementType === type
          ? unresolvedProps
          : resolveDefaultProps(type, unresolvedProps);
      return updateForwardRef(
        current,
        workInProgress,
        type,
        resolvedProps,
        renderExpirationTime,
      );
    }
    case Fragment:
      return updateFragment(current, workInProgress, renderExpirationTime);
    case Mode:
      return updateMode(current, workInProgress, renderExpirationTime);
    case Profiler:
      return updateProfiler(current, workInProgress, renderExpirationTime);
    case ContextProvider:
      return updateContextProvider(
        current,
        workInProgress,
        renderExpirationTime,
      );
    case ContextConsumer:
      return updateContextConsumer(
        current,
        workInProgress,
        renderExpirationTime,
      );
    case MemoComponent: {
      const type = workInProgress.type;
      const unresolvedProps = workInProgress.pendingProps;
      // Resolve outer props first, then resolve inner props.
      let resolvedProps = resolveDefaultProps(type, unresolvedProps);
      if (__DEV__) {
        if (workInProgress.type !== workInProgress.elementType) {
          const outerPropTypes = type.propTypes;
          if (outerPropTypes) {
            checkPropTypes(
              outerPropTypes,
              resolvedProps, // Resolved for outer only
              'prop',
              getComponentName(type),
              getCurrentFiberStackInDev,
            );
          }
        }
      }
      resolvedProps = resolveDefaultProps(type.type, resolvedProps);
      return updateMemoComponent(
        current,
        workInProgress,
        type,
        resolvedProps,
        updateExpirationTime,
        renderExpirationTime,
      );
    }
    case SimpleMemoComponent: {
      return updateSimpleMemoComponent(
        current,
        workInProgress,
        workInProgress.type,
        workInProgress.pendingProps,
        updateExpirationTime,
        renderExpirationTime,
      );
    }
    case IncompleteClassComponent: {
      const Component = workInProgress.type;
      const unresolvedProps = workInProgress.pendingProps;
      const resolvedProps =
        workInProgress.elementType === Component
          ? unresolvedProps
          : resolveDefaultProps(Component, unresolvedProps);
      return mountIncompleteClassComponent(
        current,
        workInProgress,
        Component,
        resolvedProps,
        renderExpirationTime,
      );
    }
    case SuspenseListComponent: {
      return updateSuspenseListComponent(
        current,
        workInProgress,
        renderExpirationTime,
      );
    }
    case FundamentalComponent: {
      if (enableFundamentalAPI) {
        return updateFundamentalComponent(
          current,
          workInProgress,
          renderExpirationTime,
        );
      }
      break;
    }
    case ScopeComponent: {
      if (enableScopeAPI) {
        return updateScopeComponent(
          current,
          workInProgress,
          renderExpirationTime,
        );
      }
      break;
    }
    case Block: {
      if (enableBlocksAPI) {
        const block = workInProgress.type;
        const props = workInProgress.pendingProps;
        return updateBlock(
          current,
          workInProgress,
          block,
          props,
          renderExpirationTime,
        );
      }
      break;
    }
  }
  invariant(
    false,
    'Unknown unit of work tag (%s). This error is likely caused by a bug in ' +
      'React. Please file an issue.',
    workInProgress.tag,
  );
}

export {beginWork};
