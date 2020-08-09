/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {DispatchConfig} from './ReactSyntheticEventType';
import type {
  AnyNativeEvent,
  PluginName,
  PluginModule,
} from './PluginModuleType';

import invariant from 'shared/invariant';

type NamesToPlugins = {[key: PluginName]: PluginModule<AnyNativeEvent>, ...};
type EventPluginOrder = null | Array<PluginName>;

/**
 * Injectable ordering of event plugins.
 */
let eventPluginOrder: EventPluginOrder = null;

/**
 * Injectable mapping from names to event plugin modules.
 * 名称到插件的映射
 */
const namesToPlugins: NamesToPlugins = {};

/**
 * Recomputes the plugin list using the injected plugins and plugin ordering.
 * 重新调整插件的顺序
 * @private
 */
function recomputePluginOrdering(): void {
  if (!eventPluginOrder) {
    // Wait until an `eventPluginOrder` is injected.
    return;
  }
  for (const pluginName in namesToPlugins) {
    const pluginModule = namesToPlugins[pluginName];
    const pluginIndex = eventPluginOrder.indexOf(pluginName);
    invariant(
      pluginIndex > -1,
      'EventPluginRegistry: Cannot inject event plugins that do not exist in ' +
        'the plugin ordering, `%s`.',
      pluginName,
    );
    if (plugins[pluginIndex]) {
      continue;
    }
    invariant(
      pluginModule.extractEvents,
      'EventPluginRegistry: Event plugins must implement an `extractEvents` ' +
        'method, but `%s` does not.',
      pluginName,
    );
    // eventPluginOrder的下标顺序将插件声明到plugins中
    plugins[pluginIndex] = pluginModule;

    const publishedEvents = pluginModule.eventTypes;
    for (const eventName in publishedEvents) {
      invariant(
        publishEventForPlugin(
          publishedEvents[eventName],
          pluginModule,
          eventName,
        ),
        'EventPluginRegistry: Failed to publish event `%s` for plugin `%s`.',
        eventName,
        pluginName,
      );
    }
  }
}

/**
 * Publishes an event so that it can be dispatched by the supplied plugin.
 * 注入事件
 * @param {object} dispatchConfig Dispatch configuration for the event.
 * @param {object} PluginModule Plugin publishing the event.
 * @return {boolean} True if the event was successfully published.
 * @private
 */
function publishEventForPlugin(
  dispatchConfig: DispatchConfig,
  pluginModule: PluginModule<AnyNativeEvent>,
  eventName: string,
): boolean {
  invariant(
    !eventNameDispatchConfigs.hasOwnProperty(eventName),
    'EventPluginRegistry: More than one plugin attempted to publish the same ' +
      'event name, `%s`.',
    eventName,
  );
  // 事件的分发配置  冒泡 和 捕获阶段对应的事件名称
  eventNameDispatchConfigs[eventName] = dispatchConfig;

  const phasedRegistrationNames = dispatchConfig.phasedRegistrationNames;
  if (phasedRegistrationNames) {
    for (const phaseName in phasedRegistrationNames) {
      if (phasedRegistrationNames.hasOwnProperty(phaseName)) {
        const phasedRegistrationName = phasedRegistrationNames[phaseName];
        // 注册事件按照不同事件阶段的模式
        publishRegistrationName(
          phasedRegistrationName, //不同阶段的事件名称
          pluginModule,
          eventName, //对外的事件名
        );
      }
    }
    return true;
  } else if (dispatchConfig.registrationName) {
    // 采取注册事件名
    publishRegistrationName(
      dispatchConfig.registrationName,
      pluginModule,
      eventName,
    );
    return true;
  }
  return false;
}

/**
 * Publishes a registration name that is used to identify dispatched events.
 *
 * @param {string} registrationName Registration name to add.
 * @param {object} PluginModule Plugin publishing the event.
 * @private
 */
// 注册事件  registrationName 对内的组件注册名称  pluginModule 最外层的事件模块  eventName react使用时的事件名
// registrationNameModules  所有事件都保存到该对象中
function publishRegistrationName(
  registrationName: string,
  pluginModule: PluginModule<AnyNativeEvent>,
  eventName: string,
): void {
  invariant(
    !registrationNameModules[registrationName],
    'EventPluginRegistry: More than one plugin attempted to publish the same ' +
      'registration name, `%s`.',
    registrationName,
  );
  registrationNameModules[registrationName] = pluginModule;
  registrationNameDependencies[registrationName] =
    pluginModule.eventTypes[eventName].dependencies;

  if (__DEV__) {
    const lowerCasedName = registrationName.toLowerCase();
    possibleRegistrationNames[lowerCasedName] = registrationName;

    if (registrationName === 'onDoubleClick') {
      possibleRegistrationNames.ondblclick = registrationName;
    }
  }
}

/**
 * Registers plugins so that they can extract and dispatch events.
 */

/**
 * Ordered list of injected plugins.
 */
export const plugins = [];

/**
 * Mapping from event name to dispatch config
 */
export const eventNameDispatchConfigs = {};

/**
 * Mapping from registration name to plugin module
 */
export const registrationNameModules = {};

/**
 * Mapping from registration name to event name
 */
export const registrationNameDependencies = {};

/**
 * Mapping from lowercase registration names to the properly cased version,
 * used to warn in the case of missing event handlers. Available
 * only in __DEV__.
 * @type {Object}
 */
export const possibleRegistrationNames = __DEV__ ? {} : (null: any);
// Trust the developer to only use possibleRegistrationNames in __DEV__

/**
 * Injects an ordering of plugins (by plugin name). This allows the ordering
 * to be decoupled from injection of the actual plugins so that ordering is
 * always deterministic regardless of packaging, on-the-fly injection, etc.
 *
 * @param {array} InjectedEventPluginOrder
 * @internal
 */
export function injectEventPluginOrder(
  injectedEventPluginOrder: EventPluginOrder,
): void {
  invariant(
    !eventPluginOrder,
    'EventPluginRegistry: Cannot inject event plugin ordering more than ' +
      'once. You are likely trying to load more than one copy of React.',
  );
  // Clone the ordering so it cannot be dynamically mutated. 复制一份插件的顺序
  eventPluginOrder = Array.prototype.slice.call(injectedEventPluginOrder);
  recomputePluginOrdering();
}

/**
 * Injects plugins to be used by plugin event system. The plugin names must be
 * in the ordering injected by `injectEventPluginOrder`.
 *
 * Plugins can be injected as part of page initialization or on-the-fly.
 *
 * @param {object} injectedNamesToPlugins Map from names to plugin modules.
 * @internal
 */
// 通过插件名插入插件
export function injectEventPluginsByName(
  injectedNamesToPlugins: NamesToPlugins,
): void {
  let isOrderingDirty = false;
  for (const pluginName in injectedNamesToPlugins) {
    if (!injectedNamesToPlugins.hasOwnProperty(pluginName)) {
      continue;
    }
    // 获取插件模块
    const pluginModule = injectedNamesToPlugins[pluginName];
    if (
      !namesToPlugins.hasOwnProperty(pluginName) ||
      namesToPlugins[pluginName] !== pluginModule
    ) {
      // 插件进行覆盖性注册
      invariant(
        !namesToPlugins[pluginName],
        'EventPluginRegistry: Cannot inject two different event plugins ' +
          'using the same name, `%s`.',
        pluginName,
      );
      namesToPlugins[pluginName] = pluginModule;
      isOrderingDirty = true;
    }
  }

  // 只有注册过程中不发生错误,这里才会重新调整顺序
  if (isOrderingDirty) {
    recomputePluginOrdering();
  }
}
