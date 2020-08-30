/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {
  Container
} from './ReactDOMHostConfig';
import type {
  RootType
} from './ReactDOMRoot';
import type {
  ReactNodeList
} from 'shared/ReactTypes';

import {
  getInstanceFromNode,
  isContainerMarkedAsRoot,
  unmarkContainerAsRoot,
} from './ReactDOMComponentTree';
import {
  createLegacyRoot,
  isValidContainer
} from './ReactDOMRoot';
import {
  ROOT_ATTRIBUTE_NAME
} from '../shared/DOMProperty';
import {
  DOCUMENT_NODE,
  ELEMENT_NODE,
  COMMENT_NODE,
} from '../shared/HTMLNodeType';

import {
  findHostInstanceWithNoPortals,
  updateContainer,
  unbatchedUpdates,
  getPublicRootInstance,
  findHostInstance,
  findHostInstanceWithWarning,
} from 'react-reconciler/inline.dom';
import getComponentName from 'shared/getComponentName';
import invariant from 'shared/invariant';
import ReactSharedInternals from 'shared/ReactSharedInternals';
import {
  has as hasInstance
} from 'shared/ReactInstanceMap';

const ReactCurrentOwner = ReactSharedInternals.ReactCurrentOwner;

let topLevelUpdateWarnings;
let warnedAboutHydrateAPI = false;

if (__DEV__) {
  // 顶层的更新警告
  topLevelUpdateWarnings = (container: Container) => {
    if (container._reactRootContainer && container.nodeType !==
      COMMENT_NODE) {
      const hostInstance = findHostInstanceWithNoPortals(
        container._reactRootContainer._internalRoot.current,
      );
      if (hostInstance) {
        if (hostInstance.parentNode !== container) {
          console.error(
            'render(...): It looks like the React-rendered content of this ' +
            'container was removed without using React. This is not ' +
            'supported and will cause errors. Instead, call ' +
            'ReactDOM.unmountComponentAtNode to empty a container.',
          );
        }
      }
    }

    const isRootRenderedBySomeReact = !!container._reactRootContainer;
    const rootEl = getReactRootElementInContainer(container);
    const hasNonRootReactChild = !!(rootEl && getInstanceFromNode(rootEl));

    if (hasNonRootReactChild && !isRootRenderedBySomeReact) {
      console.error(
        'render(...): Replacing React-rendered children with a new root ' +
        'component. If you intended to update the children of this node, ' +
        'you should instead have the existing children update their state ' +
        'and render the new components instead of calling ReactDOM.render.',
      );
    }

    if (
      container.nodeType === ELEMENT_NODE &&
      ((container: any): Element).tagName &&
      ((container: any): Element).tagName.toUpperCase() === 'BODY'
    ) {
      console.error(
        'render(): Rendering components directly into document.body is ' +
        'discouraged, since its children are often manipulated by third-party ' +
        'scripts and browser extensions. This may lead to subtle ' +
        'reconciliation issues. Try rendering into a container element created ' +
        'for your app.',
      );
    }
  };
}

function getReactRootElementInContainer(container: any) {
  if (!container) {
    return null;
  }

  if (container.nodeType === DOCUMENT_NODE) {
    return container.documentElement;
  } else {
    return container.firstChild;
  }
}

function shouldHydrateDueToLegacyHeuristic(container) {
  const rootElement = getReactRootElementInContainer(container);
  return !!(
    rootElement &&
    rootElement.nodeType === ELEMENT_NODE &&
    rootElement.hasAttribute(ROOT_ATTRIBUTE_NAME)
  );
}

/**
 * 根据DOM节点创建fiber root。非hydrate模式会逐步移除dom容器内的子节点
 * @param {*} container dom容器
 * @param {*} forceHydrate 
 */
function legacyCreateRootFromDOMContainer(
  container: Container,
  forceHydrate: boolean,
): RootType {
  const shouldHydrate =
    forceHydrate || shouldHydrateDueToLegacyHeuristic(container);
  // First clear any existing content.  首先清除DOM的内容
  if (!shouldHydrate) {
    let warned = false;
    let rootSibling;
    // 循环移除dom内部的所有子节点 如果子节点有DOM节点被react实例化作为根节点则会发出警告
    while ((rootSibling = container.lastChild)) {
      if (__DEV__) {
        if (
          !warned &&
          rootSibling.nodeType === ELEMENT_NODE &&
          (rootSibling: any).hasAttribute(ROOT_ATTRIBUTE_NAME)
        ) {
          warned = true;
          console.error(
            'render(): Target node has markup rendered by React, but there ' +
            'are unrelated nodes as well. This is most commonly caused by ' +
            'white-space inserted around server-rendered markup.',
          );
        }
      }
      container.removeChild(rootSibling);
    }
  }
  if (__DEV__) {
    if (shouldHydrate && !forceHydrate && !warnedAboutHydrateAPI) {
      warnedAboutHydrateAPI = true;
      console.warn(
        'render(): Calling ReactDOM.render() to hydrate server-rendered markup ' +
        'will stop working in React v17. Replace the ReactDOM.render() call ' +
        'with ReactDOM.hydrate() if you want React to attach to the server HTML.',
      );
    }
  }
  // 返回 fiber root根节点
  return createLegacyRoot(
    container,
    shouldHydrate ?
    {
      hydrate: true,
    } :
    undefined,
  );
}


// render方法传入的callback回调的检验
function warnOnInvalidCallback(callback: mixed, callerName: string): void {
  if (__DEV__) {
    if (callback !== null && typeof callback !== 'function') {
      console.error(
        '%s(...): Expected the last optional `callback` argument to be a ' +
        'function. Instead received: %s.',
        callerName,
        callback,
      );
    }
  }
}

/**
 * 将chilren树渲染到dom容器中
 * @param {*} parentComponent 为null表示根节点
 * @param {*} children 表示ReactElement树
 * @param {*} container  container表示DOM节点
 * @param {*} forceHydrate 
 * @param {*} callback 
 */
function legacyRenderSubtreeIntoContainer(
  parentComponent: ? React$Component < any, any > ,
  children : ReactNodeList,
  container: Container,
  forceHydrate: boolean,
  callback: ? Function,
) {
  if (__DEV__) {
    topLevelUpdateWarnings(container);
    // render方法传入的callback回调的检验
    warnOnInvalidCallback(callback === undefined ? null : callback, 'render');
  }

  // TODO: Without `any` type, Flow says "Property cannot be accessed on any
  // member of intersection type.
  let root: RootType = (container._reactRootContainer: any);
  let fiberRoot;
  if (!root) {
    // Initial mount 首次绑定 创建fiberRoot节点
    root = container._reactRootContainer = legacyCreateRootFromDOMContainer(
      container,
      forceHydrate,
    );
    fiberRoot = root._internalRoot;
    if (typeof callback === 'function') {
      const originalCallback = callback;
      callback = function () {
        const instance = getPublicRootInstance(fiberRoot);
        originalCallback.call(instance);
      };
    }
    // Initial mount should not be batched.  初次绑定不需要批量更新,直接更新
    unbatchedUpdates(() => {
      // 更新容器即将fiber节点更新到DOM中  chilren为react element 不是DOM节点
      updateContainer(children, fiberRoot, parentComponent, callback);
    });
  } else {
    // 更新
    fiberRoot = root._internalRoot;
    if (typeof callback === 'function') {
      const originalCallback = callback;
      // 对回调绑定this
      callback = function () {
        const instance = getPublicRootInstance(fiberRoot);
        originalCallback.call(instance);
      };
    }
    // Update
    updateContainer(children, fiberRoot, parentComponent, callback);
  }
  
  return getPublicRootInstance(fiberRoot);
}

// 通过DOM节点找到host fiber节点
export function findDOMNode(
  componentOrElement: Element | ? React$Component < any, any > ,
): null | Element | Text {
  if (__DEV__) {
    let owner = (ReactCurrentOwner.current: any);
    if (owner !== null && owner.stateNode !== null) {
      const warnedAboutRefsInRender = owner.stateNode
      ._warnedAboutRefsInRender;
      if (!warnedAboutRefsInRender) {
        console.error(
          '%s is accessing findDOMNode inside its render(). ' +
          'render() should be a pure function of props and state. It should ' +
          'never access something that requires stale data from the previous ' +
          'render, such as refs. Move this logic to componentDidMount and ' +
          'componentDidUpdate instead.',
          getComponentName(owner.type) || 'A component',
        );
      }
      owner.stateNode._warnedAboutRefsInRender = true;
    }
  }
  if (componentOrElement == null) {
    return null;
  }
  if ((componentOrElement: any).nodeType === ELEMENT_NODE) {
    return (componentOrElement: any);
  }
  if (__DEV__) {
    return findHostInstanceWithWarning(componentOrElement, 'findDOMNode');
  }
  return findHostInstance(componentOrElement);
}

export function hydrate(
  element: React$Node,
  container: Container,
  callback: ? Function,
) {
  invariant(
    isValidContainer(container),
    'Target container is not a DOM element.',
  );
  if (__DEV__) {
    const isModernRoot =
      isContainerMarkedAsRoot(container) &&
      container._reactRootContainer === undefined;
    if (isModernRoot) {
      console.error(
        'You are calling ReactDOM.hydrate() on a container that was previously ' +
        'passed to ReactDOM.createRoot(). This is not supported. ' +
        'Did you mean to call createRoot(container, {hydrate: true}).render(element)?',
      );
    }
  }
  // TODO: throw or warn if we couldn't hydrate?
  return legacyRenderSubtreeIntoContainer(
    null,
    element,
    container,
    true,
    callback,
  );
}

/**
 * reactElement 树渲染到DOM容器中的入口
 * @param {*} element reactElement元素
 * @param {*} container dom容器
 * @param {*} callback 渲染完成之后的话回调函数,未来版本可能不会返回ReactComponet实例对象,可以在回调函数中进行使用
 */
export function render(
  element: React$Element < any > ,
  container: Container,
  callback: ? Function,
) {
  // 容器必须是DOM元素
  invariant(
    isValidContainer(container),
    'Target container is not a DOM element.',
  );
  if (__DEV__) {
    // dom容器已经被react实例化处理过不能重复处理
    const isModernRoot =
      isContainerMarkedAsRoot(container) &&
      container._reactRootContainer === undefined;
    if (isModernRoot) {
      console.error(
        'You are calling ReactDOM.render() on a container that was previously ' +
        'passed to ReactDOM.createRoot(). This is not supported. ' +
        'Did you mean to call root.render(element)?',
      );
    }
  }
  return legacyRenderSubtreeIntoContainer(
    null,
    element,
    container,
    false,
    callback,
  );
}

// 渲染子节点 即此处插入了parent节点
export function unstable_renderSubtreeIntoContainer(
  parentComponent: React$Component < any, any > ,
  element: React$Element < any > ,
  containerNode: Container,
  callback: ? Function,
) {
  invariant(
    isValidContainer(containerNode),
    'Target container is not a DOM element.',
  );
  invariant(
    parentComponent != null && hasInstance(parentComponent),
    'parentComponent must be a valid React Component',
  );
  return legacyRenderSubtreeIntoContainer(
    parentComponent,
    element,
    containerNode,
    false,
    callback,
  );
}

// 解除绑定
export function unmountComponentAtNode(container: Container) {
  invariant(
    isValidContainer(container),
    'unmountComponentAtNode(...): Target container is not a DOM element.',
  );

  if (__DEV__) {
    const isModernRoot =
      isContainerMarkedAsRoot(container) &&
      container._reactRootContainer === undefined;
    if (isModernRoot) {
      console.error(
        'You are calling ReactDOM.unmountComponentAtNode() on a container that was previously ' +
        'passed to ReactDOM.createRoot(). This is not supported. Did you mean to call root.unmount()?',
      );
    }
  }

  // DOM节点中没有相关联的react root节点即不存在解绑过程
  if (container._reactRootContainer) {
    if (__DEV__) {
      const rootEl = getReactRootElementInContainer(container);
      const renderedByDifferentReact = rootEl && !getInstanceFromNode(rootEl);
      if (renderedByDifferentReact) {
        console.error(
          "unmountComponentAtNode(): The node you're attempting to unmount " +
          'was rendered by another copy of React.',
        );
      }
    }

    // Unmount should not be batched.   解绑非批量处理
    unbatchedUpdates(() => {
      legacyRenderSubtreeIntoContainer(null, null, container, false, () => {
        // $FlowFixMe This should probably use `delete container._reactRootContainer`
        container._reactRootContainer = null;
        unmarkContainerAsRoot(container);
      });
    });
    // If you call unmountComponentAtNode twice in quick succession, you'll
    // get `true` twice. That's probably fine?
    return true;
  } else {
    if (__DEV__) {
      const rootEl = getReactRootElementInContainer(container);
      const hasNonRootReactChild = !!(rootEl && getInstanceFromNode(rootEl));

      // Check if the container itself is a React root node.
      const isContainerReactRoot =
        container.nodeType === ELEMENT_NODE &&
        isValidContainer(container.parentNode) &&
        !!container.parentNode._reactRootContainer;

      if (hasNonRootReactChild) {
        console.error(
          "unmountComponentAtNode(): The node you're attempting to unmount " +
          'was rendered by React and is not a top-level container. %s',
          isContainerReactRoot ?
          'You may have accidentally passed in a React root node instead ' +
          'of its container.' :
          'Instead, have the parent component update its state and ' +
          'rerender in order to remove this component.',
        );
      }
    }

    return false;
  }
}
