const $ = (sel) => document.querySelector(sel);

const TYPE_LABEL = { punctuation: '標點符號', typo: '錯別字', usage: '用詞錯誤' };

const SAMPLE = `我的夢想

每個人都有自己的夢想,有人想當醫生,有人想當老師而我的夢想是成為一位攝影師。

小時候爸爸常常帶我去爬山,他總是拿著相機拍下沿途的風景。那時我覺的,能把美麗的瞬間留下來是一件很神奇的事情。從那天開始我就對攝影產生了濃厚的興趣。

上了國中以後,我用存了很久的零用錢買了第一台相機。每到假日,我就迫不急待的跑到公園拍照。雖然一開始拍的照片常常模糊不清,但是我並沒有放棄,反而更加努力的練習。我在圖書館借了很多關於攝影的書,慢慢地學會了構圖跟光線的運用。

我知道要成為一名專業的攝影師並不容易,需要付出很多的努力和時間,但我相信只要我堅持下去,總有一天一定會實現我的夢想。我也希望未來能用我的鏡頭,記錄下這個世界上每一個感動人心的畫面,讓更多人看見生活中的美好!!`;

const state = {
  text: '',
  issues: [], // {id,type,original,suggestion,explanation,start,end,status:'open'|'accepted'|'ignored'}
  activeId: null,
  filters: new Set(['punctuation', 'typo', 'usage']),
};

// ---------- 輸入區 ----------
const essay = $('#essay');
const updateCount = () => {
  const n = essay.value.replace(/\s/g, '').length;
  $('#char-count').textContent = `${n} 字`;
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
      const res = await fetch('/api/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl, mimeType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '影像辨識失敗');

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

$('#btn-sample').addEventListener('click', () => {
  essay.value = SAMPLE;
  essay.dispatchEvent(new Event('input'));
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
    const res = await fetch('/api/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '批改失敗');
    const sec = ((performance.now() - t0) / 1000).toFixed(1);

    state.text = data.text;
    state.issues = data.issues.map((it) => ({ ...it, status: 'open' }));
    state.activeId = null;
    renderUnlocated(data.unlocated || []);
    $('#comment').textContent = data.comment || '';

    const badge = $('#model-badge');
    if (badge) {
      badge.textContent = `${data.model || 'AI 批改'} · 耗時 ${sec} 秒`;
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
  const pCount = state.issues.filter((i) => i.type === 'punctuation').length;
  const tCount = state.issues.filter((i) => i.type === 'typo').length;
  const uCount = state.issues.filter((i) => i.type === 'usage').length;
  const wordCount = state.text.replace(/\s/g, '').length;
  $('#print-stats').textContent = `文章字數：${wordCount} 字 ｜ 標點 ${pCount} 處、錯字 ${tCount} 處、用詞 ${uCount} 處`;
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

// 1. Word 作文稿 (.doc)
$('#btn-dl-word-essay').addEventListener('click', () => {
  downloadDialog.close();
  const ts = getTimestamp();
  const paragraphs = correctedText()
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p class="essay-p">${escapeHtml(p)}</p>`)
    .join('\n');
  const html = generateWordHtml('國文作文（修正後）', `
    <h1>國文作文（修正後）</h1>
    ${paragraphs}
  `);
  const filename = `作文_修正後_${ts}.doc`;
  downloadFile(filename, html, 'application/msword;charset=utf-8');
  toast(`已下載 Word 作文稿：${filename}`);
});

// 2. Word 完整批改報告 (.doc)
$('#btn-dl-word-report').addEventListener('click', () => {
  downloadDialog.close();
  const ts = getTimestamp();
  const dateStr = getFormattedDate();
  const wordCount = state.text.replace(/\s/g, '').length;
  const pCount = state.issues.filter((i) => i.type === 'punctuation').length;
  const tCount = state.issues.filter((i) => i.type === 'typo').length;
  const uCount = state.issues.filter((i) => i.type === 'usage').length;

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
      const typeLabel = TYPE_LABEL[it.type] || it.type;
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
    <h1>📝 國文作文批改報告</h1>
    <table class="meta-table">
      <tr>
        <td><b>批改時間：</b>${escapeHtml(dateStr)}</td>
        <td style="text-align:right;"><b>文章字數：</b>${wordCount} 字</td>
      </tr>
      <tr>
        <td colspan="2"><b>問題標示：</b>共 ${state.issues.length} 處（標點符號 ${pCount} 處、錯別字 ${tCount} 處、用詞錯誤 ${uCount} 處）</td>
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
          <th style="width:42%;">說明</th>
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

  const html = generateWordHtml('國文作文批改報告', content);
  const filename = `作文批改報告_${ts}.doc`;
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
  const wordCount = state.text.replace(/\s/g, '').length;
  const pCount = state.issues.filter((i) => i.type === 'punctuation').length;
  const tCount = state.issues.filter((i) => i.type === 'typo').length;
  const uCount = state.issues.filter((i) => i.type === 'usage').length;

  let report = '';
  report += '============================================================\r\n';
  report += '               📝 國文作文批改報告\r\n';
  report += '============================================================\r\n';
  report += `批改時間：${dateStr}\r\n`;
  report += `原文長度：${wordCount} 字\r\n`;
  report += `問題標示：共 ${state.issues.length} 處（標點符號 ${pCount} 處、錯別字 ${tCount} 處、用詞錯誤 ${uCount} 處）\r\n`;
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
      const typeStr = TYPE_LABEL[it.type] || it.type;
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

  const filename = `作文批改報告_${ts}.txt`;
  downloadFile(filename, report);
  toast(`已下載：${filename}`);
});

// 3. Markdown 格式報告 (.md)
$('#btn-dl-md').addEventListener('click', () => {
  downloadDialog.close();
  const ts = getTimestamp();
  const dateStr = getFormattedDate();
  const wordCount = state.text.replace(/\s/g, '').length;

  let md = '';
  md += `# 📝 國文作文批改報告\n\n`;
  md += `- **批改時間**：${dateStr}\n`;
  md += `- **文章字數**：${wordCount} 字\n`;
  md += `- **問題統計**：共 ${state.issues.length} 處（標點 ${state.issues.filter((i) => i.type === 'punctuation').length} 處、錯字 ${state.issues.filter((i) => i.type === 'typo').length} 處、用詞 ${state.issues.filter((i) => i.type === 'usage').length} 處）\n\n`;

  md += `## 一、修正後作文\n\n`;
  md += `\`\`\`text\n${correctedText()}\n\`\`\`\n\n`;

  md += `## 二、修正建議清單\n\n`;
  md += `| 編號 | 類別 | 原文 | 建議修正 | 狀態 | 說明 |\n`;
  md += `|---|---|---|---|---|---|\n`;
  state.issues.forEach((it, idx) => {
    const typeStr = TYPE_LABEL[it.type] || it.type;
    const statusStr = it.status === 'accepted' ? '✔ 已採用' : it.status === 'ignored' ? '已忽略' : '未決定';
    md += `| ${idx + 1} | ${typeStr} | \`${it.original}\` | **\`${it.suggestion || '(刪除)'}\`** | ${statusStr} | ${it.explanation.replace(/\|/g, '、')} |\n`;
  });
  md += `\n\n`;

  md += `## 三、👩‍🏫 老師評語\n\n`;
  md += `> ${$('#comment').textContent || '無'}\n\n`;

  md += `## 四、學生原文\n\n`;
  md += `\`\`\`text\n${state.text}\n\`\`\`\n`;

  const filename = `作文批改報告_${ts}.md`;
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
  for (const type of Object.keys(TYPE_LABEL)) {
    document.querySelector(`[data-count="${type}"]`).textContent =
      state.issues.filter((i) => i.type === type).length;
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
      span.title = `${TYPE_LABEL[it.type]}：「${it.original}」→「${it.suggestion}」`;
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
  head.append(el('span', `badge ${it.type}`, TYPE_LABEL[it.type] || it.type));
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
