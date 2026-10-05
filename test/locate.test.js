import assert from 'node:assert/strict';
import { locateIssues } from '../lib/locate.js';
import { findHalfWidthPunctuation } from '../lib/punctuation.js';

const text = '我覺的很好,我覺的很棒。天氣很好我們去郊遊';

const { located, unlocated } = locateIssues(text, [
  { type: 'typo', original: '覺的', suggestion: '覺得', context_before: '我', explanation: '' },
  { type: 'punctuation', original: ',', suggestion: '，', context_before: '我覺的很好', explanation: '' },
  // 第二個「覺的」：靠前文「很好,我」區分
  { type: 'typo', original: '覺的', suggestion: '覺得', context_before: '很好,我', explanation: '' },
  { type: 'punctuation', original: '很好我們', suggestion: '很好，我們', context_before: '很棒。天氣', explanation: '' },
  { type: 'usage', original: '不存在的字', suggestion: 'x', context_before: '', explanation: '' },
  { type: 'typo', original: '相同', suggestion: '相同', context_before: '', explanation: '' },
]);

assert.equal(located.length, 4);
assert.deepEqual(located.map((i) => [i.start, i.end]), [[1, 3], [5, 6], [7, 9], [14, 18]]);
assert.deepEqual(located.map((i) => i.id), [1, 2, 3, 4]);
assert.equal(unlocated.length, 1);

// 模型順序錯亂時也能靠前文定位
const r2 = locateIssues('在見，再見', [
  { type: 'typo', original: '在', suggestion: '再', context_before: '', explanation: '' },
]);
assert.equal(r2.located[0].start, 0);

// 重疊：較大範圍取代較小範圍；矛盾的部分重疊建議被捨棄（不進 unlocated）
const t3 = '那時我覺的,能把';
const r3 = locateIssues(t3, [
  { type: 'typo', original: '覺的', suggestion: '覺得', context_before: '那時我', explanation: '' },
  { type: 'typo', original: '覺的,', suggestion: '覺得，', context_before: '那時我', explanation: '' },
  { type: 'punctuation', original: '的,能', suggestion: '的能', context_before: '', explanation: '' },
]);
assert.equal(r3.located.length, 1);
assert.equal(r3.located[0].suggestion, '覺得，');
assert.equal(r3.unlocated.length, 0);

// 半形標點規則
const t4 = '每個人都有夢想,有人想當醫生!!我覺得...很好。Hello, world. 價格是3.5元';
const rules = findHalfWidthPunctuation(t4);
assert.deepEqual(
  rules.map((r) => [r.original, r.suggestion]),
  [[',', '，'], ['!!', '！'], ['...', '……']],
);

// 規則項目只補在 AI 沒處理的地方
const t5 = '我的夢想,有人想當醫生,有人';
const r5 = locateIssues(
  t5,
  [{ type: 'punctuation', original: '夢想,', suggestion: '夢想；', context_before: '我的', explanation: '' }],
  findHalfWidthPunctuation(t5),
);
assert.deepEqual(r5.located.map((i) => i.suggestion), ['夢想；', '，']);

console.log('✅ all tests passed');
