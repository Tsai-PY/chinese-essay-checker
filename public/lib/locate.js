/**
 * 將 AI 回傳的錯誤項目（original + context_before）對應回原文中的確切位置。
 *
 * 大型語言模型回報的「字元位移」通常不可靠，因此我們請模型回傳
 * 「原文中的錯誤片段」與「緊鄰其前的幾個字」，再由程式自行搜尋定位。
 */

/** 計算 a 的結尾與 b 的結尾有幾個字元相同 */
function trailingMatch(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function allIndexesOf(text, needle) {
  const out = [];
  if (!needle) return out;
  let i = text.indexOf(needle);
  while (i !== -1) {
    out.push(i);
    i = text.indexOf(needle, i + 1);
  }
  return out;
}

/**
 * @param {string} text 學生原文
 * @param {Array<{type:string, original:string, suggestion:string, context_before?:string, explanation:string}>} issues AI 回傳的項目
 * @param {Array<{start:number, end:number}>} [ruleIssues] 程式規則找到、已有精確位置的項目
 * @returns {{located: Array<object>, unlocated: Array<object>}}
 */
export function locateIssues(text, issues, ruleIssues = []) {
  let located = [];
  const unlocated = [];
  let cursor = 0;

  const overlapping = (s, e) => located.filter((it) => s < it.end && e > it.start);

  for (const raw of issues) {
    const issue = {
      type: raw.type,
      original: String(raw.original ?? ''),
      suggestion: String(raw.suggestion ?? ''),
      explanation: String(raw.explanation ?? ''),
    };
    const ctx = String(raw.context_before ?? '');

    // 原文與建議相同 → 不是錯誤，略過
    if (!issue.original || issue.original === issue.suggestion) continue;

    const all = allIndexesOf(text, issue.original);
    if (all.length === 0) {
      unlocated.push(issue);
      continue;
    }

    // 允許的位置：不重疊，或「完全涵蓋」既有項目（較完整的修正，會取代較小的那條）
    const candidates = all.filter((i) => {
      const e = i + issue.original.length;
      return overlapping(i, e).every((it) => i <= it.start && e >= it.end);
    });
    if (candidates.length === 0) continue; // 與既有建議衝突 → 捨棄重複/矛盾的建議

    // 評分：前文吻合度越高越好；吻合度相同時，優先選擇在游標之後、且最接近游標者
    let best = candidates[0];
    let bestScore = -Infinity;
    for (const i of candidates) {
      const before = text.slice(Math.max(0, i - ctx.length), i);
      const ctxScore = ctx ? trailingMatch(before, ctx) / ctx.length : 0;
      const orderScore = i >= cursor ? 1 - (i - cursor) / (text.length + 1) : -1;
      const score = ctxScore * 10 + orderScore;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }

    const start = best;
    const end = best + issue.original.length;
    const covered = new Set(overlapping(start, end));
    located = located.filter((it) => !covered.has(it));
    located.push({ ...issue, start, end });
    cursor = end;
  }

  // 規則項目：只補上 AI 沒有處理到的位置
  for (const r of ruleIssues) {
    if (overlapping(r.start, r.end).length === 0) located.push({ ...r });
  }

  located.sort((a, b) => a.start - b.start);
  located.forEach((it, idx) => (it.id = idx + 1));
  return { located, unlocated };
}
