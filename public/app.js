import { locateIssues } from './lib/locate.js';
import { findHalfWidthPunctuation } from './lib/punctuation.js';
import { detectLanguage, findEnglishPunctuationIssues } from './lib/englishRules.js';
import { DEFAULT_API_KEY } from './config.js';

const $ = (sel) => document.querySelector(sel);

const TYPE_LABEL_ZH = { punctuation: '標點符號', typo: '錯別字', usage: '用詞錯誤' };
const TYPE_LABEL_EN = { punctuation: '標點與空格', typo: '拼字大小寫', usage: '文法與用詞' };
const getTypeLabel = (type, lang = state.currentLang) => (lang === 'en' ? TYPE_LABEL_EN[type] : TYPE_LABEL_ZH[type]) || type;

const ZH_SAMPLE = `我的夢想

每個人都有自己的夢想,有人想當醫生,有人想當老師而我的夢想是成為一位攝影師。

小時候爸爸常常帶我去爬山,他總是拿著相機拍下沿途的風景。那時我覺的,能把美麗的瞬間留下來是一件很神奇的事情。從那天開始我就對攝影產生了濃厚的興趣。

上了國中以後,我用存了很久的零用錢買了第一台相機。每到假日,我就迫不急待的跑到公園拍照。雖然一開始拍的照片常常模糊不清,但是我並沒有放棄,反而更加努力的練習。我在圖書館借了很多關於攝影的書,慢慢地學會了構圖跟光線的運用。

我知道要成為一名專業的攝影師並不容易,需要付出很多的努力和時間,但我相信只要我堅持下去,總有一天一定會實現我的夢想。我也希望未來能用我的鏡頭,記錄下這個世界上每一個感動人心的畫面,讓更多人看見生活中的美好!!`;

const EN_SAMPLE = `My Favorite Season

There are four season in a year, and my favorite season is summer.

In the summer, the weather is very hot and sunny. I likes to go to the beach with my family. We can swim in the ocean, play volleyball, and eating delicious ice cream. Last year, we went to Kenting, we had a very wonderful time there. The sunset was so beatiful that I will never forget it.

Summer also bring us the summer vacation. During the vacation, I don't have to go to school every day. I can spends more time reading interesting books and playing basketball with my friends. Although summer is very hot, but I still love it the most becuase it is full of joy and freedom.`;

const state = {
  text: '',
  issues: [], // {id,type,original,suggestion,explanation,start,end,status:'open'|'accepted'|'ignored'}
  activeId: null,
  filters: new Set(['punctuation', 'typo', 'usage']),
  langMode: localStorage.getItem('essay-lang-mode') || 'auto', // 'auto' | 'zh' | 'en'
  currentLang: 'zh', // 'zh' | 'en' (目前檢測或選取的語言)
};

// ---------- API Key 管理（純靜態空間如 Netlify Drop 使用） ----------
const API_KEY_STORAGE_KEY = 'gemini_api_key';
const getSavedApiKey = () => {
  const custom = localStorage.getItem(API_KEY_STORAGE_KEY);
  if (custom !== null && custom.trim() !== '') return custom.trim();
  return (typeof DEFAULT_API_KEY === 'string' ? DEFAULT_API_KEY.trim() : '');
};
const setSavedApiKey = (k) => {
  if (k) localStorage.setItem(API_KEY_STORAGE_KEY, k);
  else localStorage.removeItem(API_KEY_STORAGE_KEY);
  updateApiKeyStatusUI();
};

function updateApiKeyStatusUI() {
  const btn = $('#btn-open-api-key');
  const txt = $('#api-key-status-text');
  const hasKey = !!getSavedApiKey();
  if (btn && txt) {
    if (hasKey) {
      btn.classList.add('configured');
      txt.textContent = 'API Key 已就緒';
      btn.title = '已就緒 Google Gemini API Key（點擊可自訂或更換）';
    } else {
      btn.classList.remove('configured');
      txt.textContent = '設定 API Key';
      btn.title = '設定 Google Gemini API Key（純靜態託管如 Netlify Drop 必備）';
    }
  }
}

const apiKeyDialog = $('#api-key-dialog');
const inputApiKey = $('#input-api-key');
let apiKeyResolver = null;

function promptApiKey(tip = '') {
  $('#loading').hidden = true;
  if ($('#ocr-status')) $('#ocr-status').hidden = true;
  $('#btn-check').disabled = false;
  return new Promise((resolve) => {
    apiKeyResolver = resolve;
    inputApiKey.value = getSavedApiKey();
    if (tip) {
      const desc = apiKeyDialog?.querySelector('.dialog-desc');
      if (desc) desc.textContent = tip;
    }
    if (typeof apiKeyDialog?.showModal === 'function') {
      apiKeyDialog.showModal();
    } else {
      const promptVal = window.prompt(tip || '請輸入您的 Google Gemini API Key（儲存於您的瀏覽器中）：', getSavedApiKey());
      if (promptVal !== null) {
        setSavedApiKey(promptVal.trim());
        resolve(getSavedApiKey());
      } else {
        resolve('');
      }
    }
  });
}

$('#btn-open-api-key')?.addEventListener('click', () => {
  inputApiKey.value = getSavedApiKey();
  apiKeyDialog?.showModal();
});
$('#btn-close-api-dialog')?.addEventListener('click', () => {
  apiKeyDialog?.close();
  if (apiKeyResolver) { apiKeyResolver(''); apiKeyResolver = null; }
});
$('#btn-cancel-api-key')?.addEventListener('click', () => {
  apiKeyDialog?.close();
  if (apiKeyResolver) { apiKeyResolver(''); apiKeyResolver = null; }
});
$('#btn-clear-api-key')?.addEventListener('click', () => {
  setSavedApiKey('');
  inputApiKey.value = '';
  apiKeyDialog?.close();
  if (apiKeyResolver) { apiKeyResolver(''); apiKeyResolver = null; }
  toast('已清除 API Key');
});
$('#api-key-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const val = inputApiKey.value.trim();
  if (val) {
    setSavedApiKey(val);
    apiKeyDialog?.close();
    toast('✅ API Key 儲存成功！');
    if (apiKeyResolver) { apiKeyResolver(val); apiKeyResolver = null; }
  } else {
    alert('請輸入有效的 API Key');
  }
});
updateApiKeyStatusUI();

// ---------- 前端直接呼叫 Gemini API（純靜態空間 fallback） ----------
// ---------- 前端直接呼叫 Gemini API（純靜態空間 fallback） ----------
const GEMINI_SYSTEM_INSTRUCTION = `你是一位經驗豐富、細心且溫和的臺灣國中、高中國文老師，正在批改學生的作文。
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
- 嚴格遵守教育部標準：臺灣正體中文標點（引號「」、破折號——、刪節號……佔兩格）。
- 嚴格遵循輸出的 JSON 格式，不可夾帶額外的 Markdown 或說明。
- comment 請以溫和鼓勵的國文老師口吻，給予 60~120 字的總體評價與寫作精進建議。`;

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

async function callGeminiApiDirect(apiKey, model, payload) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    const errorMsg = data.error?.message || `API 回傳錯誤 (${res.status})`;
    throw new Error(errorMsg);
  }
  return data;
}

async function clientSideCheckEssay(text, requestedLang = 'auto') {
  let key = getSavedApiKey();
  if (!key) {
    key = await promptApiKey('📌 偵測到您使用 Netlify Drop 純靜態託管（無後端伺服器），請輸入一次您的 Google Gemini API Key 即可啟用批改：');
    if (!key) throw new Error('請先設定 Google Gemini API Key 以啟用批改功能。');
  }

  const lang = (!requestedLang || requestedLang === 'auto')
    ? detectLanguage(text)
    : (requestedLang === 'en' ? 'en' : 'zh');

  const ruleIssues = lang === 'en' ? findEnglishPunctuationIssues(text) : findHalfWidthPunctuation(text);
  const isEn = lang === 'en';
  const promptText = isEn ? `請批改以下英文作文：\n\n${text}` : `請批改下列學生的作文：\n\n${text}`;
  const systemInstruction = isEn ? EN_SYSTEM_INSTRUCTION : GEMINI_SYSTEM_INSTRUCTION;

  const payload = {
    contents: [{ parts: [{ text: promptText }] }],
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          issues: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                type: { type: 'STRING', enum: ['punctuation', 'typo', 'usage'] },
                original: { type: 'STRING' },
                suggestion: { type: 'STRING' },
                context_before: { type: 'STRING' },
                explanation: { type: 'STRING' },
              },
              required: ['type', 'original', 'suggestion', 'explanation'],
            },
          },
          comment: { type: 'STRING' },
        },
        required: ['issues', 'comment'],
      },
    },
  };

  const models = ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.1-flash-lite'];
  let lastErr = null;
  let parsed = null;
  let usedModel = '';

  for (const model of models) {
    try {
      const data = await callGeminiApiDirect(key, model, payload);
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) throw new Error('AI 未回傳任何文字');
      parsed = JSON.parse(rawText);
      usedModel = model;
      break;
    } catch (err) {
      console.warn(`模型 ${model} 呼叫失敗：`, err);
      lastErr = err;
      if (err.message.includes('API_KEY_INVALID') || err.message.includes('API key not valid')) {
        throw new Error('您的 Gemini API Key 無效，請點擊右上角「⚙️ 設定 API Key」重新輸入。');
      }
    }
  }

  if (!parsed) {
    throw new Error('AI 批改服務暫時無法連線：' + (lastErr?.message || lastErr));
  }

  const { located, unlocated } = locateIssues(text, parsed.issues ?? [], ruleIssues);
  const allLocated = [...ruleIssues, ...located].sort((a, b) => a.start - b.start);
  const issues = allLocated.map((it, idx) => ({ id: idx + 1, ...it }));

  return {
    text,
    issues,
    unlocated,
    comment: parsed.comment ?? '',
    model: usedModel + ' (純靜態瀏覽器端)',
    lang,
  };
}

async function clientSideOcr(dataUrl, mimeType) {
  let key = getSavedApiKey();
  if (!key) {
    key = await promptApiKey('📌 偵測到您使用 Netlify Drop 純靜態託管（無後端伺服器），請輸入一次您的 Google Gemini API Key 即可啟用照片辨識：');
    if (!key) throw new Error('請先設定 Google Gemini API Key 以啟用圖片辨識功能。');
  }

  let base64Data = dataUrl;
  const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (m) {
    mimeType = m[1];
    base64Data = m[2];
  }

  const payload = {
    contents: [
      {
        parts: [
          {
            text: `你是一位細心的作文辨識助手，專門轉錄學生手寫或印刷的國文或英文作文照片。
請仔細辨識圖片中的作文內容。若為英文，請忠實保留英文大小寫、單字空格與標點；若為中文，請轉為臺灣正體中文輸出。
重要規則：
1. 忠實轉錄：字體、大小寫、單字空格、換行都要盡可能還原手稿，即使有錯別字或文法錯誤也絕對不要修改（保留以供批改）。
2. 只輸出轉錄出的純文字，不要加入任何問候語、前言、後記、Markdown 標記或解說。
3. 若有無法辨認的字，請以「□」代替。`,
          },
          {
            inlineData: {
              mimeType: mimeType || 'image/jpeg',
              data: base64Data,
            },
          },
        ],
      },
    ],
  };

  const models = ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.1-flash-lite'];
  let lastErr = null;
  let text = '';
  let usedModel = '';

  for (const model of models) {
    try {
      const data = await callGeminiApiDirect(key, model, payload);
      text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
      usedModel = model;
      break;
    } catch (err) {
      console.warn(`OCR 模型 ${model} 呼叫失敗：`, err);
      lastErr = err;
      if (err.message.includes('API_KEY_INVALID') || err.message.includes('API key not valid')) {
        throw new Error('您的 Gemini API Key 無效，請點擊右上角「⚙️ 設定 API Key」重新輸入。');
      }
    }
  }

  if (!text && lastErr) {
    throw new Error('AI 影像辨識失敗：' + (lastErr?.message || lastErr));
  }

  return { text, model: usedModel };
}

// ---------- 輸入區 ----------
const essay = $('#essay');
const updateCount = () => {
  const chars = essay.value.replace(/\s/g, '').length;
  const words = (essay.value.match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?/g) || []).length;
  const isEn = detectLanguage(essay.value) === 'en';
  if (isEn && words > 0) {
    $('#char-count').textContent = `${words} words (${chars} 字元)`;
  } else {
    $('#char-count').textContent = `${chars} 字` + (words > 5 ? ` (${words} words)` : '');
  }
};
essay.addEventListener('input', updateCount);
essay.value = localStorage.getItem('essay-draft') ?? '';
updateCount();
essay.addEventListener('input', () => localStorage.setItem('essay-draft', essay.value));

// ---------- 影像辨識（OCR） ----------
const imageInput = $('#image-input');
const ocrStatus = $('#ocr-status');
const ocrStatusText = $('#ocr-status-text');

async function optimizeImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 2048; // 保留字體筆畫細節，同時壓縮傳輸體積
      let w = img.width;
      let h = img.height;
      if (w > MAX || h > MAX) {
        if (w > h) {
          h = Math.round((h * MAX) / w);
          w = MAX;
        } else {
          w = Math.round((w * MAX) / h);
          h = MAX;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
      resolve({ dataUrl, mimeType: 'image/jpeg' });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('圖片讀取失敗，請確認檔案格式是否正確。'));
    };
    img.src = url;
  });
}

async function handleImageFiles(fileList) {
  const images = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'));
  if (images.length === 0) return;

  showError('');
  ocrStatus.hidden = false;
  $('#btn-check').disabled = true;

  try {
    let combinedNewText = '';
    for (let i = 0; i < images.length; i++) {
      const file = images[i];
      const pageInfo = images.length > 1 ? `（第 ${i + 1}/${images.length} 頁）` : '';
      ocrStatusText.textContent = `AI 正在辨識作文影像中的文字${pageInfo}，請稍候……`;

      const { dataUrl, mimeType } = await optimizeImage(file);
      let data = null;
      let backendAvailable = false;
      try {
        const res = await fetch('/api/ocr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: dataUrl, mimeType }),
        });
        const contentType = res.headers.get('content-type') || '';
        if (res.ok && contentType.includes('application/json')) {
          data = await res.json();
          backendAvailable = true;
        }
      } catch (netErr) {
        console.log('後端 OCR 伺服器未啟用或離線，切換至純前端模式', netErr);
      }

      if (!backendAvailable) {
        data = await clientSideOcr(dataUrl, mimeType);
      }

      if (data.text) {
        combinedNewText += (combinedNewText ? '\n\n' : '') + data.text;
      }
    }

    if (combinedNewText) {
      if (essay.value.trim()) {
        essay.value = essay.value.trim() + '\n\n' + combinedNewText;
      } else {
        essay.value = combinedNewText;
      }
      essay.dispatchEvent(new Event('input'));
      toast(`✅ 辨識完成！已自動填入作文內容`);
    } else {
      toast('⚠️ 圖片中未辨識出明顯的文字內容');
    }
  } catch (err) {
    showError('影像辨識失敗：' + (err.message || String(err)));
  } finally {
    ocrStatus.hidden = true;
    $('#btn-check').disabled = false;
    imageInput.value = '';
  }
}

imageInput.addEventListener('change', (e) => {
  handleImageFiles(e.target.files);
});

// 支援拖曳圖片至輸入框
essay.addEventListener('dragover', (e) => {
  e.preventDefault();
  essay.classList.add('drag-over');
});
essay.addEventListener('dragleave', () => {
  essay.classList.remove('drag-over');
});
essay.addEventListener('drop', (e) => {
  e.preventDefault();
  essay.classList.remove('drag-over');
  if (e.dataTransfer?.files?.length) {
    handleImageFiles(e.dataTransfer.files);
  }
});

// 支援 Ctrl+V 貼上剪貼簿中的圖片
essay.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  const imageFiles = [];
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) imageFiles.push(file);
    }
  }
  if (imageFiles.length > 0) {
    e.preventDefault();
    handleImageFiles(imageFiles);
  }
});

// 語系選擇按鈕事件
function updateLangSelectorUI() {
  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.lang === state.langMode);
  });
}
document.querySelectorAll('.lang-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.langMode = btn.dataset.lang;
    localStorage.setItem('essay-lang-mode', state.langMode);
    updateLangSelectorUI();
  });
});
updateLangSelectorUI();

$('#btn-sample').addEventListener('click', () => {
  let sampleToLoad = ZH_SAMPLE;
  if (state.langMode === 'en') {
    sampleToLoad = EN_SAMPLE;
  } else if (state.langMode === 'zh') {
    sampleToLoad = ZH_SAMPLE;
  } else {
    // 自動模式：若目前為中文作文，則切換載入英文；否則載入國文
    const isZh = detectLanguage(essay.value) === 'zh' && essay.value.length > 20;
    sampleToLoad = isZh ? EN_SAMPLE : ZH_SAMPLE;
  }
  essay.value = sampleToLoad;
  essay.dispatchEvent(new Event('input'));
  toast(detectLanguage(sampleToLoad) === 'en' ? '已載入英文範例作文' : '已載入國語文範例作文');
});
$('#btn-clear').addEventListener('click', () => {
  essay.value = '';
  essay.dispatchEvent(new Event('input'));
  essay.focus();
});
$('#btn-check').addEventListener('click', check);
$('#btn-back').addEventListener('click', () => {
  // 返回時把已採用的修正帶回輸入框，方便繼續修改
  essay.value = correctedText();
  essay.dispatchEvent(new Event('input'));
  showView('input');
});

function showView(name) {
  $('#input-view').hidden = name !== 'input';
  $('#result-view').hidden = name !== 'result';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showError(msg) {
  const el = $('#error');
  el.textContent = msg;
  el.hidden = !msg;
}

async function check() {
  showError('');
  const text = essay.value.replace(/\r\n?/g, '\n').trim();
  if (!text) return showError('請先輸入作文內容。');

  $('#loading').hidden = false;
  $('#btn-check').disabled = true;
  try {
    const t0 = performance.now();
    let data = null;
    let backendAvailable = false;
    try {
      const res = await fetch('/api/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, lang: state.langMode }),
      });
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        data = await res.json();
        backendAvailable = true;
      }
    } catch (netErr) {
      console.log('後端批改伺服器未啟用或離線，切換至純前端模式', netErr);
    }

    if (!backendAvailable) {
      data = await clientSideCheckEssay(text, state.langMode);
    }
    const sec = ((performance.now() - t0) / 1000).toFixed(1);

    state.text = data.text;
    state.currentLang = data.lang || (state.langMode === 'auto' ? detectLanguage(data.text) : state.langMode);
    state.issues = data.issues.map((it) => ({ ...it, status: 'open' }));
    state.activeId = null;
    renderUnlocated(data.unlocated || []);
    $('#comment').textContent = data.comment || '';

    // 動態更新分類標籤名稱
    const isEn = state.currentLang === 'en';
    const puncLabel = $('#label-filter-punc');
    const typoLabel = $('#label-filter-typo');
    const usageLabel = $('#label-filter-usage');
    const printTitle = $('#print-title-text');
    if (puncLabel) puncLabel.textContent = isEn ? '標點與空格' : '標點符號';
    if (typoLabel) typoLabel.textContent = isEn ? '拼字大小寫' : '錯別字';
    if (usageLabel) usageLabel.textContent = isEn ? '文法與用詞' : '用詞錯誤';
    if (printTitle) printTitle.textContent = isEn ? '英文作文批改報告 (English Essay Assessment Report)' : '國語文作文批改報告';

    const badge = $('#model-badge');
    if (badge) {
      const langBadge = isEn ? '🇬🇧 英文批改' : '🇹🇼 國文批改';
      badge.textContent = `${langBadge} · ${data.model || 'AI'} · 耗時 ${sec} 秒`;
      badge.hidden = false;
    }

    render();
    showView('result');
  } catch (err) {
    showError(err.message || String(err));
  } finally {
    $('#loading').hidden = true;
    $('#btn-check').disabled = false;
  }
}

// ---------- 結果區 ----------
$('#filters').addEventListener('change', (e) => {
  if (e.target.checked) state.filters.add(e.target.value);
  else state.filters.delete(e.target.value);
  render();
});

$('#btn-accept-all').addEventListener('click', () => {
  state.issues.forEach((it) => {
    if (it.status === 'open' && state.filters.has(it.type)) it.status = 'accepted';
  });
  render();
  toast('已採用所有顯示中的建議');
});

$('#btn-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(correctedText());
    toast('已複製修正後的文章（僅包含已採用的修正）');
  } catch {
    toast('複製失敗，請手動選取文字');
  }
});

// ---------- 另存檔案與列印 ----------
function downloadFile(filename, content, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function getTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function getFormattedDate() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

// 線上列印
$('#btn-print').addEventListener('click', () => {
  $('#print-date').textContent = getFormattedDate();
  const isEn = state.currentLang === 'en';
  const pCount = state.issues.filter((i) => i.type === 'punctuation').length;
  const tCount = state.issues.filter((i) => i.type === 'typo').length;
  const uCount = state.issues.filter((i) => i.type === 'usage').length;
  const chars = state.text.replace(/\s/g, '').length;
  const words = (state.text.match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?/g) || []).length;
  const lenStr = isEn ? `${words} words (${chars} 字元)` : `${chars} 字`;
  const pLabel = isEn ? '標點與空格' : '標點';
  const tLabel = isEn ? '拼字大小寫' : '錯字';
  const uLabel = isEn ? '文法用詞' : '用詞';
  $('#print-stats').textContent = `文章長度：${lenStr} ｜ ${pLabel} ${pCount} 處、${tLabel} ${tCount} 處、${uLabel} ${uCount} 處`;
  window.print();
});

// 另存檔案對話框控制
const downloadDialog = $('#download-dialog');
$('#btn-download').addEventListener('click', () => {
  downloadDialog.showModal();
});
$('#btn-close-dialog').addEventListener('click', () => {
  downloadDialog.close();
});
downloadDialog.addEventListener('click', (e) => {
  if (e.target === downloadDialog) downloadDialog.close();
});

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function generateWordHtml(title, bodyContent) {
  return `<!DOCTYPE html>
<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
<meta charset='utf-8'>
<title>${escapeHtml(title)}</title>
<!--[if gte mso 9]>
<xml>
<w:WordDocument>
<w:View>Print</w:View>
<w:Zoom>100</w:Zoom>
<w:DoNotOptimizeForBrowser/>
</w:WordDocument>
</xml>
<![endif]-->
<style>
@page Section1 {
  size: 595.3pt 841.9pt;
  margin: 72pt 72pt 72pt 72pt;
  mso-header-margin: 36pt;
  mso-footer-margin: 36pt;
}
div.Section1 { page: Section1; }
body {
  font-family: "標楷體", "DFKai-SB", "Microsoft JhengHei", "新細明體", serif;
  font-size: 14pt;
  line-height: 200%;
  color: #2b2a28;
}
h1 {
  font-family: "標楷體", "DFKai-SB", serif;
  font-size: 20pt;
  text-align: center;
  margin: 0 0 16pt 0;
  color: #b5452f;
}
h2 {
  font-family: "標楷體", "DFKai-SB", serif;
  font-size: 15pt;
  border-bottom: 1.5pt solid #b5452f;
  padding-bottom: 4pt;
  margin: 20pt 0 10pt 0;
  color: #b5452f;
}
.meta-table {
  width: 100%;
  border: none;
  font-size: 11pt;
  line-height: 150%;
  margin-bottom: 16pt;
  color: #555;
}
.meta-table td { border: none; padding: 2pt 4pt; }
p.essay-p {
  margin: 0 0 12pt 0;
  text-indent: 28pt;
  line-height: 220%;
}
table.report-table {
  border-collapse: collapse;
  width: 100%;
  margin: 14pt 0;
  font-size: 10.5pt;
  line-height: 145%;
  table-layout: fixed;
}
table.report-table th, table.report-table td {
  border: 1pt solid #bbb;
  padding: 5pt 6pt;
  vertical-align: top;
  word-break: break-word;
}
table.report-table th {
  background-color: #f6f3ee;
  color: #333;
  font-weight: bold;
}
.comment-box {
  border: 1.5pt solid #b5452f;
  background-color: #fdfaf6;
  padding: 12pt 16pt;
  margin: 14pt 0;
  font-size: 12pt;
  line-height: 180%;
}
.badge-punct { color: #2f6fb5; font-weight: bold; }
.badge-typo { color: #c8323c; font-weight: bold; }
.badge-usage { color: #c27a0e; font-weight: bold; }
.status-accepted { color: #2e8b57; font-weight: bold; }
</style>
</head>
<body>
<div class="Section1">
${bodyContent}
</div>
</body>
</html>`;
}

// 1. Word 完整批改報告 (.doc)
$('#btn-dl-word-report').addEventListener('click', () => {
  downloadDialog.close();
  const ts = getTimestamp();
  const dateStr = getFormattedDate();
  const isEn = state.currentLang === 'en';
  const reportTitle = isEn ? '英文作文批改報告' : '國文作文批改報告';
  const chars = state.text.replace(/\s/g, '').length;
  const words = (state.text.match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?/g) || []).length;
  const lenStr = isEn ? `${words} words (${chars} 字元)` : `${chars} 字`;
  const pCount = state.issues.filter((i) => i.type === 'punctuation').length;
  const tCount = state.issues.filter((i) => i.type === 'typo').length;
  const uCount = state.issues.filter((i) => i.type === 'usage').length;
  const pLabel = isEn ? '標點與空格' : '標點符號';
  const tLabel = isEn ? '拼字大小寫' : '錯別字';
  const uLabel = isEn ? '文法用詞' : '用詞錯誤';

  const correctedParagraphs = correctedText()
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p class="essay-p">${escapeHtml(p)}</p>`)
    .join('\n');

  const originalParagraphs = state.text
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p class="essay-p">${escapeHtml(p)}</p>`)
    .join('\n');

  let tableRows = '';
  if (state.issues.length === 0) {
    tableRows = `<tr><td colspan="6" style="text-align:center;color:#2e8b57;">太棒了！無明顯問題，表現優異。</td></tr>`;
  } else {
    state.issues.forEach((it, idx) => {
      const typeLabel = getTypeLabel(it.type, state.currentLang);
      const badgeClass = it.type === 'punctuation' ? 'badge-punct' : it.type === 'typo' ? 'badge-typo' : 'badge-usage';
      const statusStr = it.status === 'accepted' ? '<span class="status-accepted">✔ 已採用</span>' : it.status === 'ignored' ? '已忽略' : '未決定';
      tableRows += `<tr>
        <td style="text-align:center;">${idx + 1}</td>
        <td class="${badgeClass}" style="text-align:center;white-space:nowrap;">${escapeHtml(typeLabel)}</td>
        <td style="color:#c8323c;text-decoration:line-through;word-break:break-all;">${escapeHtml(it.original)}</td>
        <td style="color:#2e8b57;font-weight:bold;word-break:break-all;">${escapeHtml(it.suggestion || '(刪除)')}</td>
        <td style="text-align:center;white-space:nowrap;">${statusStr}</td>
        <td style="line-height:150%;">${escapeHtml(it.explanation)}</td>
      </tr>`;
    });
  }

  const content = `
    <h1>📝 ${escapeHtml(reportTitle)}</h1>
    <table class="meta-table">
      <tr>
        <td><b>批改時間：</b>${escapeHtml(dateStr)}</td>
        <td style="text-align:right;"><b>文章長度：</b>${lenStr}</td>
      </tr>
      <tr>
        <td colspan="2"><b>問題標示：</b>共 ${state.issues.length} 處（${pLabel} ${pCount} 處、${tLabel} ${tCount} 處、${uLabel} ${uCount} 處）</td>
      </tr>
    </table>

    <h2>一、修正後作文全文</h2>
    ${correctedParagraphs}

    <h2>二、批改與建議對照表</h2>
    <table class="report-table">
      <thead>
        <tr>
          <th style="width:7%;text-align:center;">編號</th>
          <th style="width:13%;text-align:center;white-space:nowrap;">類別</th>
          <th style="width:14%;">原文片段</th>
          <th style="width:14%;">建議修正</th>
          <th style="width:10%;text-align:center;white-space:nowrap;">狀態</th>
          <th style="width:42%;">${isEn ? '說明與文法建議' : '說明'}</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>

    <h2>三、👩‍🏫 老師評語</h2>
    <div class="comment-box">
      ${escapeHtml($('#comment').textContent || '無特別評語。')}
    </div>

    <h2>四、學生原始作文</h2>
    ${originalParagraphs}
  `;

  const html = generateWordHtml(reportTitle, content);
  const filename = `${reportTitle}_${ts}.doc`;
  downloadFile(filename, html, 'application/msword;charset=utf-8');
  toast(`已下載 Word 批改報告：${filename}`);
});

// 3. 純文字作文檔
$('#btn-dl-text').addEventListener('click', () => {
  downloadDialog.close();
  const text = correctedText();
  const filename = `作文_修正後_${getTimestamp()}.txt`;
  downloadFile(filename, text);
  toast(`已下載：${filename}`);
});

// 2. 完整批改報告 (.txt)
$('#btn-dl-report').addEventListener('click', () => {
  downloadDialog.close();
  const ts = getTimestamp();
  const dateStr = getFormattedDate();
  const isEn = state.currentLang === 'en';
  const reportTitle = isEn ? '英文作文批改報告' : '國文作文批改報告';
  const chars = state.text.replace(/\s/g, '').length;
  const words = (state.text.match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?/g) || []).length;
  const lenStr = isEn ? `${words} words (${chars} 字元)` : `${chars} 字`;
  const pCount = state.issues.filter((i) => i.type === 'punctuation').length;
  const tCount = state.issues.filter((i) => i.type === 'typo').length;
  const uCount = state.issues.filter((i) => i.type === 'usage').length;
  const pLabel = isEn ? '標點與空格' : '標點符號';
  const tLabel = isEn ? '拼字大小寫' : '錯別字';
  const uLabel = isEn ? '文法用詞' : '用詞錯誤';

  let report = '';
  report += '============================================================\r\n';
  report += `               📝 ${reportTitle}\r\n`;
  report += '============================================================\r\n';
  report += `批改時間：${dateStr}\r\n`;
  report += `文章長度：${lenStr}\r\n`;
  report += `問題標示：共 ${state.issues.length} 處（${pLabel} ${pCount} 處、${tLabel} ${tCount} 處、${uLabel} ${uCount} 處）\r\n`;
  report += '============================================================\r\n\r\n';

  report += '【一、修正後作文全文】\r\n';
  report += '------------------------------------------------------------\r\n';
  report += correctedText() + '\r\n';
  report += '------------------------------------------------------------\r\n\r\n';

  report += '【二、批改與修正建議對照清單】\r\n';
  report += '------------------------------------------------------------\r\n';
  if (state.issues.length === 0) {
    report += '無明顯問題，表現優異！\r\n';
  } else {
    state.issues.forEach((it, idx) => {
      const typeStr = getTypeLabel(it.type, state.currentLang);
      const statusStr = it.status === 'accepted' ? '[已採用]' : it.status === 'ignored' ? '[已忽略]' : '[未決定]';
      report += `${idx + 1}. [${typeStr}] ${statusStr} 「${it.original}」 → 「${it.suggestion || '(刪除)'}」\r\n`;
      if (it.explanation) {
        report += `   說明：${it.explanation}\r\n`;
      }
      report += '\r\n';
    });
  }
  report += '------------------------------------------------------------\r\n\r\n';

  report += '【三、學生原始作文】\r\n';
  report += '------------------------------------------------------------\r\n';
  report += state.text + '\r\n';
  report += '------------------------------------------------------------\r\n\r\n';

  report += '【四、👩‍🏫 老師評語】\r\n';
  report += '------------------------------------------------------------\r\n';
  report += ($('#comment').textContent || '無特別評語。') + '\r\n';
  report += '============================================================\r\n';

  const filename = `${reportTitle}_${ts}.txt`;
  downloadFile(filename, report);
  toast(`已下載：${filename}`);
});

// 3. Markdown 格式報告 (.md)
$('#btn-dl-md').addEventListener('click', () => {
  downloadDialog.close();
  const ts = getTimestamp();
  const dateStr = getFormattedDate();
  const isEn = state.currentLang === 'en';
  const reportTitle = isEn ? '英文作文批改報告' : '國文作文批改報告';
  const chars = state.text.replace(/\s/g, '').length;
  const words = (state.text.match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?/g) || []).length;
  const lenStr = isEn ? `${words} words (${chars} 字元)` : `${chars} 字`;
  const pCount = state.issues.filter((i) => i.type === 'punctuation').length;
  const tCount = state.issues.filter((i) => i.type === 'typo').length;
  const uCount = state.issues.filter((i) => i.type === 'usage').length;
  const pLabel = isEn ? '標點與空格' : '標點';
  const tLabel = isEn ? '拼字大小寫' : '錯字';
  const uLabel = isEn ? '文法用詞' : '用詞';

  let md = '';
  md += `# 📝 ${reportTitle}\n\n`;
  md += `- **批改時間**：${dateStr}\n`;
  md += `- **文章長度**：${lenStr}\n`;
  md += `- **問題統計**：共 ${state.issues.length} 處（${pLabel} ${pCount} 處、${tLabel} ${tCount} 處、${uLabel} ${uCount} 處）\n\n`;

  md += `## 一、修正後作文\n\n`;
  md += `\`\`\`text\n${correctedText()}\n\`\`\`\n\n`;

  md += `## 二、修正建議清單\n\n`;
  md += `| 編號 | 類別 | 原文 | 建議修正 | 狀態 | 說明 |\n`;
  md += `|---|---|---|---|---|---|\n`;
  state.issues.forEach((it, idx) => {
    const typeStr = getTypeLabel(it.type, state.currentLang);
    const statusStr = it.status === 'accepted' ? '✔ 已採用' : it.status === 'ignored' ? '已忽略' : '未決定';
    md += `| ${idx + 1} | ${typeStr} | \`${it.original}\` | **\`${it.suggestion || '(刪除)'}\`** | ${statusStr} | ${it.explanation.replace(/\|/g, '、')} |\n`;
  });
  md += `\n\n`;

  md += `## 三、👩‍🏫 老師評語\n\n`;
  md += `> ${$('#comment').textContent || '無'}\n\n`;

  md += `## 四、學生原文\n\n`;
  md += `\`\`\`text\n${state.text}\n\`\`\`\n`;

  const filename = `${reportTitle}_${ts}.md`;
  downloadFile(filename, md, 'text/markdown;charset=utf-8');
  toast(`已下載：${filename}`);
});

function correctedText() {
  let out = '';
  let pos = 0;
  for (const it of state.issues) {
    out += state.text.slice(pos, it.start);
    out += it.status === 'accepted' ? it.suggestion : it.original;
    pos = it.end;
  }
  return out + state.text.slice(pos);
}

function render() {
  renderAnnotated();
  renderList();
  for (const type of ['punctuation', 'typo', 'usage']) {
    const el = document.querySelector(`[data-count="${type}"]`);
    if (el) {
      el.textContent = state.issues.filter((i) => i.type === type).length;
    }
  }
  const visible = state.issues.filter((i) => state.filters.has(i.type));
  $('#issue-total').textContent = `（共 ${visible.length} 處）`;
}

function renderAnnotated() {
  const root = $('#annotated');
  root.replaceChildren();
  let pos = 0;
  for (const it of state.issues) {
    root.append(state.text.slice(pos, it.start));
    const span = document.createElement('span');
    const filtered = !state.filters.has(it.type);
    span.className = `mark ${it.type} ${it.status}` + (filtered ? ' filtered' : '') + (it.id === state.activeId ? ' active' : '');
    span.dataset.id = it.id;
    span.textContent = it.status === 'accepted' ? it.suggestion : it.original;
    if (!filtered && it.status !== 'ignored') {
      span.tabIndex = 0;
      span.setAttribute('role', 'button');
      span.title = `${getTypeLabel(it.type, state.currentLang)}：「${it.original}」→「${it.suggestion}」`;
      const sup = document.createElement('sup');
      sup.textContent = it.id;
      span.append(sup);
    }
    root.append(span);
    pos = it.end;
  }
  root.append(state.text.slice(pos));
}

function renderList() {
  const list = $('#issue-list');
  list.replaceChildren();
  const visible = state.issues.filter((i) => state.filters.has(i.type));
  if (state.issues.length === 0) {
    list.innerHTML = '<li class="empty-state">🎉 太棒了！沒有發現明顯的錯誤。</li>';
    return;
  }
  for (const it of visible) list.append(issueCard(it, true));
}

function issueCard(it, actionable) {
  const li = document.createElement('li');
  li.className = `issue ${it.type} ${it.status || ''}` + (it.id && it.id === state.activeId ? ' active' : '');
  if (it.id) {
    li.id = `issue-${it.id}`;
    li.dataset.id = it.id;
  }

  const head = document.createElement('div');
  head.className = 'issue-head';
  if (it.id) head.append(el('span', 'issue-no', `#${it.id}`));
  head.append(el('span', `badge ${it.type}`, getTypeLabel(it.type, state.currentLang)));
  if (it.status === 'accepted') head.append(el('span', 'status', '✔ 已採用'));
  if (it.status === 'ignored') head.append(el('span', 'status muted', '已忽略'));

  const fix = el('div', 'fix');
  fix.append(el('span', 'from', it.original), el('span', 'arrow', '→'));
  fix.append(it.suggestion ? el('span', 'to', it.suggestion) : el('span', 'empty', '（刪除）'));

  li.append(head, fix, el('p', 'explain', it.explanation));

  if (actionable) {
    const actions = el('div', 'issue-actions');
    if (it.status === 'open') {
      actions.append(button('採用', 'accept', 'primary'), button('忽略', 'ignore', 'ghost'));
    } else {
      actions.append(button('復原', 'reset', 'ghost'));
    }
    li.append(actions);
  }
  return li;
}

function renderUnlocated(items) {
  $('#unlocated-wrap').hidden = items.length === 0;
  $('#unlocated-list').replaceChildren(...items.map((it) => issueCard(it, false)));
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function button(label, action, variant) {
  const b = el('button', `btn small ${variant}`, label);
  b.type = 'button';
  b.dataset.action = action;
  return b;
}

// 卡片按鈕（事件委派）
$('#issue-list').addEventListener('click', (e) => {
  const card = e.target.closest('.issue');
  if (!card) return;
  const it = state.issues.find((i) => i.id === Number(card.dataset.id));
  const action = e.target.closest('button')?.dataset.action;
  if (action === 'accept') it.status = 'accepted';
  else if (action === 'ignore') it.status = 'ignored';
  else if (action === 'reset') it.status = 'open';
  setActive(it.id, { scrollTo: action ? null : 'text' });
});

// 點選文中標示 → 對應建議卡片
const onMarkActivate = (e) => {
  const mark = e.target.closest('.mark[role="button"]');
  if (!mark) return;
  if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  setActive(Number(mark.dataset.id), { scrollTo: 'card' });
};
$('#annotated').addEventListener('click', onMarkActivate);
$('#annotated').addEventListener('keydown', onMarkActivate);

function setActive(id, { scrollTo } = {}) {
  state.activeId = id;
  render();
  if (scrollTo === 'card') {
    document.getElementById(`issue-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } else if (scrollTo === 'text') {
    document.querySelector(`.mark[data-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2200);
}
