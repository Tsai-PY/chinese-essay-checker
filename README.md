# 📝 國文作文批改小幫手

學生貼上作文後，自動標示：

| 顏色 | 類別 | 例子 |
|---|---|---|
| 🔵 藍 | 標點符號 | 半形逗號、一逗到底、缺問號、引號用錯 |
| 🔴 紅 | 錯別字 | 覺「的」→覺「得」、迫不「急」待→迫不「及」待 |
| 🟠 橙 | 用詞錯誤 | 成語誤用、語意重複、搭配不當、口語化 |

每一處都有「原文 → 建議」與簡短說明，可逐條**採用／忽略／復原**，也能一鍵全部採用並複製修正後的文章，最後附上老師評語。

### 支援手機拍照與作文影像辨識（OCR）
- **手機拍照**：用手機開啟網頁，點選「📷 拍照／上傳圖片辨識」會直接喚起後置鏡頭拍攝學生作文。
- **影像上傳**：支援手寫作文或列印稿，可一次選取多張照片（自動依頁數依序轉錄）。
- **拖曳與貼上**：電腦端可直接將作文圖片拖曳至輸入框，或使用 `Ctrl+V` 貼上螢幕截圖。
- **原貌保留**：AI 辨識時忠實保留學生的手寫錯別字與原有標點，不擅自修改，留給後續批改系統診斷。

## 線上一鍵發佈

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FTsai-PY%2Fchinese-essay-checker&env=GEMINI_API_KEY&envDescription=Google%20Gemini%20API%20Key)
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Tsai-PY/chinese-essay-checker)

> 點擊上方按鈕後，登入並填入您的 `GEMINI_API_KEY`，約 1 分鐘即可自動獲得永久免費的專屬線上網站網址！

## 本機使用方式

1. 到 <https://aistudio.google.com/apikey> 申請 Gemini API 金鑰。
2. 複製 `.env.example` 為 `.env`，填入 `GEMINI_API_KEY=你的金鑰`。
3. 雙擊 `start.bat`，或執行：
   ```
   npm install
   npm start
   ```
4. 瀏覽器開啟 <http://localhost:3000>。

## 架構

- `server.js`：Node.js 伺服器，呼叫 Gemini（預設 `gemini-3.8-flash`）並以 JSON Schema 取得結構化批改結果。
- `lib/locate.js`：以「錯誤片段 + 前文」在原文中精確定位每個錯誤（不依賴模型回報的字元位置）。
- `public/`：前端頁面（純 HTML/CSS/JS，無需建置）。
- `npm test`：定位邏輯的單元測試。
