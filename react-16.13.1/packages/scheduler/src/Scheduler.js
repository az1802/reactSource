/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/* eslint-disable no-var */

import {
  enableSchedulerDebugging,
  enableProfiling,
} from './SchedulerFeatureFlags';
import {
  requestHostCallback, 
  requestHostTimeout,
  cancelHostTimeout,
  shouldYieldToHost,
  getCurrentTime,
  forceFrameRate,
  requestPaint,
} from './SchedulerHostConfig';
import {push, pop, peek} from './SchedulerMinHeap';

// TODO: Use symbols?
import {
  ImmediatePriority,
  UserBlockingPriority,
  NormalPriority,
  LowPriority,
  IdlePriority,
} from './SchedulerPriorities';
import {
  sharedProfilingBuffer,
  markTaskRun,
  markTaskYield,
  markTaskCompleted,
  markTaskCanceled,
  markTaskErrored,
  markSchedulerSuspended,
  markSchedulerUnsuspended,
  markTaskStart,
  stopLoggingProfilingEvents,
  startLoggingProfilingEvents,
} from './SchedulerProfiling';

// Max 31 bit integer. The max integer size in V8 for 32-bit systems.
// Math.pow(2, 30) - 1
// 0b111111111111111111111111111111
var maxSigned31BitInt = 1073741823;

// Times out immediately  不同级别任务的超时时间限制
var IMMEDIATE_PRIORITY_TIMEOUT = -1;
// Eventually times out
var USER_BLOCKING_PRIORITY = 250;
var NORMAL_PRIORITY_TIMEOUT = 5000;
var LOW_PRIORITY_TIMEOUT = 10000;
// Never times out  用不超时采用最大时差
var IDLE_PRIORITY = maxSigned31BitInt;

// Tasks are stored on a min heap
var taskQueue = []; //执行任务队列
var timerQueue = [];//超时任务队列

// Incrementing id counter. Used to maintain insertion order.
// 任务的计数器变量,用于维护插入顺序
var taskIdCounter = 1;

// Pausing the scheduler is useful for debugging.  暂停任务调度便于调试
var isSchedulerPaused = false;

// 单线程同一时间只能执行一个任务,记录当前的任务和任务级别
var currentTask = null;
var currentPriorityLevel = NormalPriority;

// This is set while performing work, to prevent re-entrancy.
// 正在执行任务
var isPerformingWork = false;

var isHostCallbackScheduled = false;
var isHostTimeoutScheduled = false;

// 处理任务队列中的sortIndex 以及移除无效的任务(callback为null)
function advanceTimers(currentTime) {
  // Check for tasks that are no longer delayed and add them to the queue.
  // 获取优先级最高的task
  let timer = peek(timerQueue);
  while (timer !== null) {
    if (timer.callback === null) {
      // Timer was cancelled. 没有回调表示任务已取消
      pop(timerQueue);
    } else if (timer.startTime <= currentTime) {//
      // Timer fired. Transfer to the task queue. 将过期时间赋值给sortIndex然后放入最小堆中
      pop(timerQueue);
      timer.sortIndex = timer.expirationTime;
      push(taskQueue, timer);
      if (enableProfiling) { //开启性能标记此处做一个时间统计
        markTaskStart(timer, currentTime);
        timer.isQueued = true;
      }
    } else {
      // Remaining timers are pending.
      return;
    }
    timer = peek(timerQueue);
  }
}

// 延迟执行任务
function handleTimeout(currentTime) {
  isHostTimeoutScheduled = false;
  advanceTimers(currentTime);

  if (!isHostCallbackScheduled) {
    if (peek(taskQueue) !== null) {//没有同步的任务正在执行
      isHostCallbackScheduled = true;
      requestHostCallback(flushWork);
    } else {
      // 处理一些延迟处理的任务
      const firstTimer = peek(timerQueue);
      if (firstTimer !== null) {
        requestHostTimeout(handleTimeout, firstTimer.startTime - currentTime);
      }
    }
  }
}

// 开始执行任务队列内部调用workLoop
function flushWork(hasTimeRemaining, initialTime) {
  if (enableProfiling) {
    markSchedulerUnsuspended(initialTime);
  }

  // We'll need a host callback the next time work is scheduled.
  isHostCallbackScheduled = false;
  if (isHostTimeoutScheduled) { //有延迟任务的调度则取消延迟任务的执行
    // We scheduled a timeout but it's no longer needed. Cancel it.
    isHostTimeoutScheduled = false;
    cancelHostTimeout();
  }

  isPerformingWork = true;
  const previousPriorityLevel = currentPriorityLevel;
  try {
    if (enableProfiling) {
      try {
        return workLoop(hasTimeRemaining, initialTime);
      } catch (error) {
        if (currentTask !== null) {
          const currentTime = getCurrentTime();
          markTaskErrored(currentTask, currentTime);
          currentTask.isQueued = false;
        }
        throw error;
      }
    } else {
      // No catch in prod codepath.
      return workLoop(hasTimeRemaining, initialTime);
    }
  } finally {
    currentTask = null;
    currentPriorityLevel = previousPriorityLevel;
    isPerformingWork = false;
    if (enableProfiling) {
      const currentTime = getCurrentTime();
      markSchedulerSuspended(currentTime);
    }
  }
}

// 处理任务
function workLoop(hasTimeRemaining, initialTime) {
  let currentTime = initialTime;
  advanceTimers(currentTime);
  currentTask = peek(taskQueue); //去除优先级最高的任务

  // 任务在中间暂停或者进入debug状态则会跳出这个循环
  while (
    currentTask !== null &&
    !(enableSchedulerDebugging && isSchedulerPaused)
  ) {
    if (
      currentTask.expirationTime > currentTime &&
      (!hasTimeRemaining || shouldYieldToHost())
    ) {
      // This currentTask hasn't expired, and we've reached the deadline.
      // 当前优先级最高的任务没有过期且没有剩余时间或者需要将线程还给主线程 
      break;
    }
    const callback = currentTask.callback;
    if (callback !== null) {
      currentTask.callback = null;
      currentPriorityLevel = currentTask.priorityLevel;
      const didUserCallbackTimeout = currentTask.expirationTime <= currentTime;
      markTaskRun(currentTask, currentTime);
      // 执行callback
      const continuationCallback = callback(didUserCallbackTimeout);
      currentTime = getCurrentTime();
      if (typeof continuationCallback === 'function') {
        // 任务回调执行完成之后返回的是一个function 则会替代当前的callback
        currentTask.callback = continuationCallback;
        markTaskYield(currentTask, currentTime);
      } else {
        if (enableProfiling) {
          markTaskCompleted(currentTask, currentTime);
          currentTask.isQueued = false;
        }
        if (currentTask === peek(taskQueue)) {
          pop(taskQueue);
        }
      }
      advanceTimers(currentTime);
    } else {
      pop(taskQueue);
    }
    currentTask = peek(taskQueue);
  }

  // Return whether there's additional work
  if (currentTask !== null) {
    return true;
  } else {
    // 表示任务队列的任务全部处理完现在处理那些延迟的任务多列
    let firstTimer = peek(timerQueue);
    if (firstTimer !== null) {
      requestHostTimeout(handleTimeout, firstTimer.startTime - currentTime);
    }
    return false;
  }
}

// 根据优先级来运行任务
function unstable_runWithPriority(priorityLevel, eventHandler) {
  switch (priorityLevel) {
    case ImmediatePriority:
    case UserBlockingPriority:
    case NormalPriority:
    case LowPriority:
    case IdlePriority:
      break;
    default:
      priorityLevel = NormalPriority;
  }

  // 通过函数栈保留上一个task的任务等级
  var previousPriorityLevel = currentPriorityLevel;
  currentPriorityLevel = priorityLevel;

  try {
    return eventHandler();
  } finally {
    currentPriorityLevel = previousPriorityLevel;
  }
}

// 调整任务优先级然后执行回调
function unstable_next(eventHandler) { 
  var priorityLevel;
  switch (currentPriorityLevel) {
    case ImmediatePriority:
    case UserBlockingPriority:
    case NormalPriority:
      // Shift down to normal priority
      priorityLevel = NormalPriority;
      break;
    default:
      // Anything lower than normal priority should remain at the current level.
      priorityLevel = currentPriorityLevel;
      break;
  }

  var previousPriorityLevel = currentPriorityLevel;
  currentPriorityLevel = priorityLevel;

  try {
    return eventHandler();
  } finally {
    currentPriorityLevel = previousPriorityLevel;
  }
}

// 包装回调且利用闭包存储currentPriorityLevel值,保证回调运行时获取的任务级别是准确的
function unstable_wrapCallback(callback) {
  var parentPriorityLevel = currentPriorityLevel;
  return function() {
    // This is a fork of runWithPriority, inlined for performance.
    var previousPriorityLevel = currentPriorityLevel;
    currentPriorityLevel = parentPriorityLevel;

    try {
      return callback.apply(this, arguments);
    } finally {
      currentPriorityLevel = previousPriorityLevel;
    }
  };
}

// 不同级别任务可以延迟执行的时间有多少
function timeoutForPriorityLevel(priorityLevel) {
  switch (priorityLevel) {
    case ImmediatePriority:
      return IMMEDIATE_PRIORITY_TIMEOUT;
    case UserBlockingPriority:
      return USER_BLOCKING_PRIORITY;
    case IdlePriority:
      return IDLE_PRIORITY;
    case LowPriority:
      return LOW_PRIORITY_TIMEOUT;
    case NormalPriority:
    default:
      return NORMAL_PRIORITY_TIMEOUT;
  }
}

// 根据不同级别的任务查看其可以延迟执行的时间完成任务的执行
function unstable_scheduleCallback(priorityLevel, callback, options) {
  var currentTime = getCurrentTime();

  var startTime;
  var timeout;
  if (typeof options === 'object' && options !== null) {
    // 延迟时间
    var delay = options.delay;
    if (typeof delay === 'number' && delay > 0) {
      startTime = currentTime + delay;
    } else {
      startTime = currentTime;
    }
    // 有自定义的超时时间则采取自定义的否则采用任务级别的时间
    timeout =
      typeof options.timeout === 'number'
        ? options.timeout
        : timeoutForPriorityLevel(priorityLevel);
  } else {
    timeout = timeoutForPriorityLevel(priorityLevel);
    startTime = currentTime;
  }

  // 根据delay timout计算过期时间
  var expirationTime = startTime + timeout;

  // 构造一个新的task对象
  var newTask = {
    id: taskIdCounter++,
    callback,
    priorityLevel,
    startTime,
    expirationTime,
    sortIndex: -1,
  };
  if (enableProfiling) {
    newTask.isQueued = false;
  }

  // 延迟任务以starTime作为sortIndex 否则以expirationTime作为sortIndex
  if (startTime > currentTime) {
    // This is a delayed task. 延迟任务
    newTask.sortIndex = startTime;
    push(timerQueue, newTask);
    if (peek(taskQueue) === null && newTask === peek(timerQueue)) {
      // All tasks are delayed, and this is the task with the earliest delay.
      // 没有同步任务且第一个延迟执行的任务是当前任务
      if (isHostTimeoutScheduled) {
        // Cancel an existing timeout. 取消已经执行的延迟任务
        cancelHostTimeout();
      } else {
        isHostTimeoutScheduled = true;
      }
      // Schedule a timeout.
      requestHostTimeout(handleTimeout, startTime - currentTime);
    }
  } else {
    newTask.sortIndex = expirationTime;
    push(taskQueue, newTask);
    if (enableProfiling) {
      markTaskStart(newTask, currentTime);
      newTask.isQueued = true;
    }
    // Schedule a host callback, if needed. If we're already performing work,
    // wait until the next time we yield.
    // 没有任何任务正在执行则开始执行任务
    if (!isHostCallbackScheduled && !isPerformingWork) {
      isHostCallbackScheduled = true;
      requestHostCallback(flushWork);
    }
  }

  return newTask;
}

// 暂停任务执行
function unstable_pauseExecution() {
  isSchedulerPaused = true;
}

// 继续执行任务执行
function unstable_continueExecution() {
  isSchedulerPaused = false;
  // TODO 没有完成调度继续执行任务
  if (!isHostCallbackScheduled && !isPerformingWork) {
    isHostCallbackScheduled = true;
    requestHostCallback(flushWork);
  }
}

// 过去第一个任务节点
function unstable_getFirstCallbackNode() {
  return peek(taskQueue);
}

// 取消任务的执行 只需要设置callback null即可。以堆的形式存放这些任务没办法通过下标直接移除
function unstable_cancelCallback(task) {
  if (enableProfiling) {
    if (task.isQueued) {
      const currentTime = getCurrentTime();
      markTaskCanceled(task, currentTime);
      task.isQueued = false;
    }
  }

  // Null out the callback to indicate the task has been canceled. (Can't
  // remove from the queue because you can't remove arbitrary nodes from an
  // array based heap, only the first one.)
  task.callback = null;
}

// 获取当前任务等级
function unstable_getCurrentPriorityLevel() {
  return currentPriorityLevel;
}

// 是否可以暂停当前处理的任务
function unstable_shouldYield() {
  const currentTime = getCurrentTime();
  advanceTimers(currentTime);
  const firstTask = peek(taskQueue);
  return (
    (firstTask !== currentTask &&
      currentTask !== null &&
      firstTask !== null &&
      firstTask.callback !== null &&
      firstTask.startTime <= currentTime &&
      firstTask.expirationTime < currentTask.expirationTime) ||
    shouldYieldToHost()
  );
}

const unstable_requestPaint = requestPaint;

export {
  ImmediatePriority as unstable_ImmediatePriority,
  UserBlockingPriority as unstable_UserBlockingPriority,
  NormalPriority as unstable_NormalPriority,
  IdlePriority as unstable_IdlePriority,
  LowPriority as unstable_LowPriority,
  unstable_runWithPriority,
  unstable_next,
  unstable_scheduleCallback,
  unstable_cancelCallback,
  unstable_wrapCallback,
  unstable_getCurrentPriorityLevel,
  unstable_shouldYield,
  unstable_requestPaint,
  unstable_continueExecution,
  unstable_pauseExecution,
  unstable_getFirstCallbackNode,
  getCurrentTime as unstable_now,
  forceFrameRate as unstable_forceFrameRate,
};

export const unstable_Profiling = enableProfiling
  ? {
      startLoggingProfilingEvents,
      stopLoggingProfilingEvents,
      sharedProfilingBuffer,
    }
  : null;
