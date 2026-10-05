/**
 * 以程式規則找出「中文語境中的半形標點」，這類錯誤不需要 AI 判斷、也不該被漏掉。
 * 回傳的項目已帶有精確的 start / end。
 */

const CJK = /[\u3400-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/;

const MAP = { ',': '，', '?': '？', '!': '！', ':': '：', ';': '；', '(': '（', ')': '）', '.': '。' };

const isCjk = (ch) => !!ch && CJK.test(ch);

/**
 * @param {string} text
 * @returns {Array<{type:'punctuation', original:string, suggestion:string, explanation:string, start:number, end:number, source:'rule'}>}
 */
export function findHalfWidthPunctuation(text) {
  const out = [];
  const re = /\.{3,}|。{2,}|[,?!:;().]+/g;
  let m;
  while ((m = re.exec(text))) {
    const original = m[0];
    const start = m.index;
    const end = start + original.length;
    const prev = text[start - 1];
    const next = text[end];
    // 只處理中文語境：前一個字或後一個字是中文（避免誤判英文、數字小數點、網址等）
    if (!isCjk(prev) && !isCjk(next)) continue;
    if (/^[.]+$/.test(original) && original.length < 3 && /\d/.test(prev ?? '') && /\d/.test(next ?? '')) continue;

    let suggestion;
    let explanation;
    if (/^\.{3,}$|^。{2,}$/.test(original)) {
      suggestion = '……';
      explanation = '刪節號應寫成六個點的「……」（佔兩格），不能用「...」或「。。。」代替。';
    } else if (/^[!?]{2,}$/.test(original)) {
      suggestion = original.includes('?') && original.includes('!') ? '？！' : MAP[original[0]];
      explanation = '作文中不宜連用多個驚嘆號或問號，用一個全形符號即可表達語氣。';
    } else {
      suggestion = [...original].map((c) => MAP[c] ?? c).join('');
      explanation = `中文作文要使用全形標點「${suggestion}」，不可使用半形的「${original}」。`;
    }
    out.push({ type: 'punctuation', original, suggestion, explanation, start, end, source: 'rule' });
  }
  return out;
}
