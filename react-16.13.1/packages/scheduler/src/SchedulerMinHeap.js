/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 */

//  内部的最小堆 采用数组进行存放。
// 历史版本采用的是环形链来存储这些任务但是每次插入一个任务进来的时候需要进行O(n)的比较。采用最小堆可以达到O(log2 n 的效率)
type Heap = Array<Node>;
type Node = {|
  id: number,
  sortIndex: number,
|};

// 添加堆节点
export function push(heap: Heap, node: Node): void {
  // 每次把节点压到最好然后再在堆中进行向上的移动
  const index = heap.length;
  heap.push(node);
  siftUp(heap, node, index);
}

// 返回堆顶点
export function peek(heap: Heap): Node | null {
  const first = heap[0];
  return first === undefined ? null : first;
}

// 树的根节点弹出 然后整理堆
export function pop(heap: Heap): Node | null {
  const first = heap[0];
  if (first !== undefined) {
    const last = heap.pop();
    if (last !== first) {
      heap[0] = last;
      siftDown(heap, last, 0);
    }
    return first;
  } else {
    return null;
  }
}

// 向上筛选
function siftUp(heap, node, i) {
  let index = i;
  while (true) {
    // 找到父节点的下标
    const parentIndex = (index - 1) >>> 1;
    const parent = heap[parentIndex];
    if (parent !== undefined && compare(parent, node) > 0) {
      // The parent is larger. Swap positions.
      heap[parentIndex] = node;
      heap[index] = parent;
      index = parentIndex;
    } else {
      // The parent is smaller. Exit.
      return;
    }
  }
}

// 向下筛选
function siftDown(heap, node, i) {
  let index = i;
  const length = heap.length;
  while (index < length) {
    const leftIndex = (index + 1) * 2 - 1;
    const left = heap[leftIndex];
    const rightIndex = leftIndex + 1;
    const right = heap[rightIndex];

    // If the left or right node is smaller, swap with the smaller of those.
    if (left !== undefined && compare(left, node) < 0) {
      if (right !== undefined && compare(right, left) < 0) {
        heap[index] = right;
        heap[rightIndex] = node;
        index = rightIndex;
      } else {
        heap[index] = left;
        heap[leftIndex] = node;
        index = leftIndex;
      }
    } else if (right !== undefined && compare(right, node) < 0) {
      heap[index] = right;
      heap[rightIndex] = node;
      index = rightIndex;
    } else {
      // Neither child is smaller. Exit.
      return;
    }
  }
}

// 判断方法判断节点是否进行移动
function compare(a, b) {
  // Compare sort index first, then task id.
  const diff = a.sortIndex - b.sortIndex;
  return diff !== 0 ? diff : a.id - b.id;
}
