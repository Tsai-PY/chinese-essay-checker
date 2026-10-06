/**
 * 英文作文規則與語言判定輔助模組
 */

/**
 * 判定文字主要是中文還是英文
 * @param {string} text
 * @returns {'zh' | 'en'}
 */
export function detectLanguage(text) {
  if (!text || typeof text !== 'string') return 'zh';
  const clean = text.trim();
  if (!clean) return 'zh';

  // 計算中文字元數（CJK）
  const cjkMatches = clean.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || [];
  // 計算英文單字數（連續英文字母，包含含撇號的縮寫如 don't）
  const engWords = clean.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || [];

  const cjkCount = cjkMatches.length;
  const engWordCount = engWords.length;

  // 若英文單字數明顯多於中文字數，或中文字少於 6 個且英文單字大於等於 5 個
  if (engWordCount > cjkCount * 1.2 || (cjkCount < 6 && engWordCount >= 5)) {
    return 'en';
  }
  return 'zh';
}

/**
 * 檢查英文作文中常見的半形/全形標點與空格規範
 * @param {string} text
 * @returns {Array<{type:'punctuation', original:string, suggestion:string, explanation:string, start:number, end:number, source:'rule'}>}
 */
export function findEnglishPunctuationIssues(text) {
  const out = [];

  // 1. 全形標點在英文作文中的誤用（例如中文輸入法忘記切換）
  const FULL_TO_HALF = {
    '，': ', ',
    '。': '. ',
    '！': '! ',
    '？': '? ',
    '：': ': ',
    '；': '; ',
    '“': '"',
    '”': '"',
    '‘': "'",
    '’': "'",
    '（': ' (',
    '）': ') ',
  };

  const fullRe = /[，。！？：；“”‘’（）]/g;
  let m;
  while ((m = fullRe.exec(text))) {
    const original = m[0];
    const start = m.index;
    const end = start + original.length;
    const suggestion = FULL_TO_HALF[original] ?? original;
    out.push({
      type: 'punctuation',
      original,
      suggestion,
      explanation: `英文寫作應使用半形標點「${suggestion.trim()}」，標點後並需空格，不可使用全形中文標點「${original}」。`,
      start,
      end,
      source: 'rule',
    });
  }

  // 2. 標點符號前多餘的空格 (例如 "hello , world" -> "hello, world")
  const spaceBeforeRe = /\s+([,.:;?!])/g;
  while ((m = spaceBeforeRe.exec(text))) {
    const original = m[0];
    const punc = m[1];
    const start = m.index;
    const end = start + original.length;
    out.push({
      type: 'punctuation',
      original,
      suggestion: punc,
      explanation: `英文標點「${punc}」前面不應有空格。`,
      start,
      end,
      source: 'rule',
    });
  }

  // 3. 逗號後面漏掉空格 (例如 "apple,banana" -> "apple, banana")
  const missingSpaceCommaRe = /([A-Za-z0-9]),([A-Za-z])/g;
  while ((m = missingSpaceCommaRe.exec(text))) {
    const original = m[0];
    const start = m.index;
    const end = start + original.length;
    const suggestion = `${m[1]}, ${m[2]}`;
    out.push({
      type: 'punctuation',
      original,
      suggestion,
      explanation: '英文逗號「,」後面接單字時應空一格。',
      start,
      end,
      source: 'rule',
    });
  }

  // 4. 句號後面漏掉空格 (例如 "world.He" -> "world. He")
  const missingSpacePeriodRe = /([a-z])\.([A-Z])/g;
  while ((m = missingSpacePeriodRe.exec(text))) {
    const original = m[0];
    const start = m.index;
    const end = start + original.length;
    const suggestion = `${m[1]}. ${m[2]}`;
    out.push({
      type: 'punctuation',
      original,
      suggestion,
      explanation: '英文句號「.」後開始新句子時應空一格。',
      start,
      end,
      source: 'rule',
    });
  }

  return out;
}
