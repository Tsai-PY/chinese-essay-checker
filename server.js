import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';
import { locateIssues } from './lib/locate.js';
import { findHalfWidthPunctuation } from './lib/punctuation.js';
import { detectLanguage, findEnglishPunctuationIssues } from './lib/englishRules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- 讀取 .env（不需額外套件）----
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

const PORT = Number(process.env.PORT) || 3000;
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
// 主模型忙碌（503/429）時依序改用的備援模型
const FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS || 'gemini-3.5-flash-lite,gemini-3.1-flash-lite')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const MAX_CHARS = 5000;

if (!process.env.GEMINI_API_KEY) {
  console.error('⚠️  找不到 GEMINI_API_KEY，請在 .env 檔中設定（可參考 .env.example）。');
}
let ai;
const getClient = () => (ai ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));

// ---- 給模型的批改指示（國語文） ----
const ZH_SYSTEM_INSTRUCTION = `你是一位經驗豐富、細心且溫和的臺灣國中、高中國文老師，正在批改學生的作文。
請以教育部《重訂標點符號手冊》與《國語辭典》的臺灣正體中文用法為標準，找出作文中的下列問題：

1. punctuation（標點符號）：
   - 「半形標點改全形」已由程式自動檢查，你不需要為了單純的半形→全形另外列出；
     但若該處同時有用法錯誤（例如半形逗號其實應改為句號或分號），請照常列出，suggestion 使用全形標點。
   - 一逗到底、該斷句未斷、句號與逗號誤用、頓號與逗號誤用、引號使用錯誤（臺灣使用「」與『』）、
     刪節號應為六點「……」、破折號應為「——」、問句缺問號、書名號篇名號誤用等。
2. typo（錯別字）：同音或形近錯字，例如「在/再」、「的/得/地」誤用、「已/以」、「做/作」、「哪/那」、
   「辨/辯/辦」、「既/即」、「渡/度」、「部/步」、「象/像」、簡體字等。
3. usage（用詞或語法錯誤）：成語誤用或寫錯、詞語搭配不當、語意重複（如「大約……左右」）、
   句子成分殘缺或雜糅、關聯詞誤用、口語或網路用語不適合作文、語序不當等。

輸出規則（非常重要）：
- 依問題在文中出現的先後順序列出。
- original 必須「逐字」複製自學生原文（包含原本的標點與空白），不可改寫，且至少一個字。
  若是「缺少標點」，請把缺漏處前後相鄰的幾個字一起放進 original，並在 suggestion 中補上標點。
  例如原文「天氣很好我們去郊遊」→ original「很好我們」、suggestion「很好，我們」。
- original 盡量精簡，只涵蓋需要修改的部分（通常 1～8 個字），不要整句整段。
- suggestion 是用來直接取代 original 的修正文字。
- context_before 為原文中緊接在 original 之前的 4～6 個字（逐字複製；若在文章開頭則為空字串），用來協助定位。
- explanation 用一兩句簡短、親切、學生看得懂的話說明錯誤原因與正確用法。
- 只指出確定的錯誤，不要為了風格偏好而修改；學生的創意寫法若沒有錯就保留。
- 若完全沒有錯誤，issues 回傳空陣列。
- comment 給一段 80～150 字的整體評語，先肯定優點，再具體提出一到兩項可改進的方向。`;

// ---- 給模型的批改指示（英文作文） ----
const EN_SYSTEM_INSTRUCTION = `你是一位經驗豐富、專業細心且溫和鼓勵的英文老師，正在批改學生的英文作文（English Essay）。
請針對學生的英文作文，找出以下三類問題並給予親切詳盡的繁體中文說明：

1. punctuation（標點符號與空格）：
   - 全形中文標點符號誤用（如誤輸入全形逗號「，」、句號「。」、問號「？」等，應改為半形英文標點並於後方加空格）。
   - 標點後缺少空格（如 "apple,banana" 應改為 "apple, banana"、"good.He" 應改為 "good. He"）。
   - 標點前多餘空格（如 "hello , world" 應改為 "hello, world"）。
   - 連句錯誤（Run-on sentences / Comma splice，兩個獨立子句未加連接詞僅以逗號相連，應加上分號、連接詞或拆為兩句）。
   - 句子結尾缺少句號、問號或驚嘆號。
   - 縮寫撇號（Apostrophe）誤用或缺漏（如 dont -> don't, its 與 it's 混淆）。

2. typo（拼字與大小寫錯誤）：
   - 單字拼字錯誤（Spelling errors，例如 becuase -> because, tomorow -> tomorrow）。
   - 句首字母未大寫、專有名詞未大寫、第一人稱代名詞「I」未大寫。
   - 形似音近字混淆（如 weather/whether, their/there/they're, than/then, accept/except 等）。

3. usage（文法、句型與用詞）：
   - 主詞與動詞一致性（Subject-Verb Agreement，如 "He go to school" -> "He goes to school"）。
   - 時態錯誤（Tense consistency / errors，如敘述過去事件卻混用現在式或過去分詞）。
   - 冠詞誤用或遺漏（Articles: a, an, the 的用法）。
   - 名詞單複數錯誤（Plural/Singular forms, 可數與不可數名詞）。
   - 介系詞搭配錯誤（Prepositions，如 "depend of" -> "depend on"）。
   - 動詞形式錯誤（動名詞 Gerund / 不定詞 Infinitive，如 "enjoy to swim" -> "enjoy swimming"）。
   - 詞性混淆（Parts of speech，如形容詞當副詞用）。
   - 中式英文（Chinglish）或不自然表達，提供地道、道地的英文搭配詞（Collocations）與片語。

輸出規則（非常重要）：
- 依問題在文中出現的先後順序列出。
- original 必須「逐字」精確複製自學生原文（包含原本的大小寫、空格與標點），不可改寫，且至少一個字。
- original 盡量精簡，只涵蓋需要修改的單字或片語（通常 1～4 個英文單字），不要複製整句。
- suggestion 是用來直接取代 original 的修正文字（包含正確的英文大小寫與空格）。
- context_before 為原文中緊接在 original 之前的 2～5 個單字或 8～15 個字元（逐字複製；若在文章開頭則為空字串），用來協助定位。
- explanation 請用親切淺顯的「繁體中文」，清楚解釋文法規則、拼字重點或道地用法。
- 只指出確定的錯誤，若合乎文法則尊重學生原本表述。
- 若完全沒有錯誤，issues 回傳空陣列。
- comment 請以溫和鼓勵的英文老師口吻，給予 80～150 字的整體評語，先肯定文章優點，再具體提出一到兩項精進建議。`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['punctuation', 'typo', 'usage'] },
          original: { type: 'string', description: '逐字複製自原文的錯誤片段' },
          suggestion: { type: 'string', description: '用來取代 original 的修正文字' },
          context_before: { type: 'string', description: '原文中緊接在 original 前面的文字' },
          explanation: { type: 'string', description: '給學生的簡短說明' },
        },
        required: ['type', 'original', 'suggestion', 'context_before', 'explanation'],
      },
    },
    comment: { type: 'string', description: '整體評語' },
  },
  required: ['issues', 'comment'],
};

const isOverloaded = (err) => {
  const status = err?.status ?? err?.code;
  const msg = String(err?.message ?? '');
  return status === 503 || status === 429 || /timeout|timed out/i.test(err?.name ?? '') ||
    /\b(503|429)\b|high demand|overloaded|RESOURCE_EXHAUSTED|UNAVAILABLE|timed out/i.test(msg);
};

async function callModel(model, text, lang, { isLast }) {
  const isEn = lang === 'en';
  const systemInstruction = isEn ? EN_SYSTEM_INSTRUCTION : ZH_SYSTEM_INSTRUCTION;
  const inputPrompt = isEn
    ? `請批改以下英文作文：\n\n<essay>\n${text}\n</essay>`
    : `請批改以下作文：\n\n<作文>\n${text}\n</作文>`;

  return getClient().interactions.create(
    {
      model,
      system_instruction: systemInstruction,
      input: inputPrompt,
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: RESPONSE_SCHEMA,
      },
      store: false,
    },
    // 還有備援模型時不要在忙碌的模型上反覆重試，快速切換
    { maxRetries: isLast ? 2 : 0, timeout: 90_000 },
  );
}

async function checkEssay(text, requestedLang = 'auto') {
  const lang = (!requestedLang || requestedLang === 'auto')
    ? detectLanguage(text)
    : (requestedLang === 'en' ? 'en' : 'zh');

  const models = [MODEL, ...FALLBACK_MODELS.filter((m) => m !== MODEL)];
  let interaction;
  let usedModel;
  let lastErr;
  for (const [idx, model] of models.entries()) {
    try {
      interaction = await callModel(model, text, lang, { isLast: idx === models.length - 1 });
      usedModel = model;
      break;
    } catch (err) {
      lastErr = err;
      if (!isOverloaded(err)) throw err;
      console.warn(`⚠️  ${model} 忙碌中，改用下一個模型……`);
    }
  }
  if (!interaction) {
    throw new Error('目前 AI 服務使用人數過多，請稍後再試一次。（' + (lastErr?.message || lastErr) + '）');
  }

  const data = JSON.parse(interaction.output_text ?? '{}');
  const ruleIssues = lang === 'en' ? findEnglishPunctuationIssues(text) : findHalfWidthPunctuation(text);
  const { located, unlocated } = locateIssues(
    text,
    Array.isArray(data.issues) ? data.issues : [],
    ruleIssues,
  );
  return { text, issues: located, unlocated, comment: data.comment ?? '', model: usedModel, lang };
}

// ---- 給影像文字辨識（OCR）的指示 ----
const OCR_SYSTEM_INSTRUCTION = `你是一位專業且細心的作文辨識助手，專門轉錄學生手寫或印刷的國文或英文作文照片。
請仔細辨識圖片中的作文內容。若為英文，請忠實保留英文大小寫、單字空格與標點；若為中文，請轉為臺灣正體中文輸出。

重要規則：
1. 忠實原文：請按原樣抄寫學生寫的文字、英文拼字與標點符號。即使學生寫了錯別字、拼錯單字（例如 becuase、season 漏 s）或用錯標點，也「絕對不要」替學生修正，因為後續系統還要進行作文批改！
2. 排版結構：保留文章的原有分段、換行與空格。
3. 塗改痕跡：若文章中有劃掉、塗黑或立可帶塗改的字，請忽略被劃掉的部分，只辨識學生最後定稿的字；若字跡模糊難辨，請根據筆畫形狀盡最大可能判斷，切勿隨意省略。
4. 純淨輸出：直接輸出辨識出的作文文字本身，不要加任何引言、說明、提示或註解。`;

async function transcribeImage(base64Data, mimeType = 'image/jpeg') {
  const models = [MODEL, ...FALLBACK_MODELS.filter((m) => m !== MODEL)];
  let interaction;
  let usedModel;
  let lastErr;
  for (const [idx, model] of models.entries()) {
    try {
      interaction = await getClient().interactions.create(
        {
          model,
          system_instruction: OCR_SYSTEM_INSTRUCTION,
          input: [
            {
              type: 'image',
              data: base64Data,
              mime_type: mimeType,
            },
            {
              type: 'text',
              text: '請辨識圖片中的作文文字。',
            },
          ],
          store: false,
        },
        { maxRetries: idx === models.length - 1 ? 2 : 0, timeout: 90_000 },
      );
      usedModel = model;
      break;
    } catch (err) {
      lastErr = err;
      if (!isOverloaded(err)) throw err;
      console.warn(`⚠️  OCR ${model} 忙碌中，改用下一個模型……`);
    }
  }
  if (!interaction) {
    throw new Error('目前 AI 辨識服務忙碌中，請稍後再試。（' + (lastErr?.message || lastErr) + '）');
  }
  return { text: interaction.output_text?.trim() ?? '', model: usedModel };
}

// ---- 簡易 HTTP 伺服器 ----
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
const PUBLIC_DIR = path.join(__dirname, 'public');

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 100_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('內容太長'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'POST' && url.pathname === '/api/check') {
    try {
      const body = JSON.parse(await readBody(req));
      const text = String(body.text ?? '').replace(/\r\n?/g, '\n').trim();
      if (!text) return sendJson(res, 400, { error: '請先輸入作文內容。' });
      if (text.length > MAX_CHARS) {
        return sendJson(res, 400, { error: `作文太長了（${text.length} 字），請控制在 ${MAX_CHARS} 字以內。` });
      }
      if (!process.env.GEMINI_API_KEY) {
        return sendJson(res, 500, { error: '伺服器尚未設定 GEMINI_API_KEY。' });
      }
      const lang = body.lang || 'auto';
      const result = await checkEssay(text, lang);
      return sendJson(res, 200, result);
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, { error: '批改時發生錯誤：' + (err?.message || err) });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/ocr') {
    try {
      const body = JSON.parse(await readBody(req, 25_000_000));
      let { image, mimeType } = body;
      if (!image) return sendJson(res, 400, { error: '請提供作文圖片。' });
      const m = image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (m) {
        mimeType = m[1];
        image = m[2];
      }
      if (!process.env.GEMINI_API_KEY) {
        return sendJson(res, 500, { error: '伺服器尚未設定 GEMINI_API_KEY。' });
      }
      const result = await transcribeImage(image, mimeType || 'image/jpeg');
      return sendJson(res, 200, result);
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, { error: '影像辨識時發生錯誤：' + (err?.message || err) });
    }
  }

  if (req.method === 'GET') {
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!filePath.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'Forbidden' });
    fs.readFile(filePath, (err, data) => {
      if (err) return sendJson(res, 404, { error: 'Not found' });
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      res.end(data);
    });
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
}

export default handleRequest;

const server = http.createServer(handleRequest);

if (!process.env.VERCEL) {
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`ℹ️  通訊埠 ${PORT} 已有服務在執行（伺服器已在運行中）：http://localhost:${PORT}`);
      process.exit(0);
    } else {
      console.error('伺服器發生錯誤：', err);
      process.exit(1);
    }
  });

  server.listen(PORT, () => {
    console.log(`📝 國文作文批改小幫手已啟動：http://localhost:${PORT}  （模型：${MODEL}）`);
  });
}
