/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/**
 * @see http://www.whatwg.org/specs/web-apps/current-work/multipage/the-input-element.html#input-type-attr-summary
 */
const supportedInputTypes: {[key: string]: true | void, ...} = {
  color: true,
  date: true,
  datetime: true,
  'datetime-local': true,
  email: true,
  month: true,
  number: true,
  password: true,
  range: true,
  search: true,
  tel: true,
  text: true,
  time: true,
  url: true,
  week: true,
};


// 是否是文本类型的标签
function isTextInputElement(elem: ?HTMLElement): boolean {
  const nodeName = elem && elem.nodeName && elem.nodeName.toLowerCase();

  if (nodeName === 'input') {//input标签还会检查其类型
    return !!supportedInputTypes[((elem: any): HTMLInputElement).type];
  }

  if (nodeName === 'textarea') {
    return true;
  }

  return false;
}

export default isTextInputElement;
