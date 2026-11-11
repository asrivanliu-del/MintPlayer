# MintPlayer

MintPlayer 是以 Electron、React 和 TypeScript 開發的桌面音樂與影片播放器，支援本機播放清單、歌詞及 Karaoke 練唱功能。

## 功能

- 媒體播放器
  - 支援 MP3、FLAC 音樂 (Music) 及 MP4 影片(Video)
  - 顯示同步或靜態歌詞，並可點擊歌詞跳至對應時間
  - Configuration 的 Show covers and videos 選項控制播放器、播放清單及 Media Downloader 的封面／影片畫面；關閉時隱藏封面與影片畫面，但影片音訊仍可播放。
  - 調整音量 (Volume)
  - 左右聲道平衡（Pan）
  - 音高（Transpose）
   - 進入全螢幕播放、拖曳調整或收合播放清單側欄。
- Karaoke模式
  - 切換原曲與伴奏；可選擇自動產生伴奏。
- 播放清單
  - 建立、切換、排序和管理播放清單；支援多選曲目。
- 媒體庫
  - 
- 
- 工具
  - 編輯 MP3 標籤、封面與歌詞，並搜尋線上歌曲資訊和歌詞。
  - 
  - 在 Media Downloader 搜尋 YouTube 與 Bilibili（各顯示最多六項結果），或直接輸入網址；可透過 yt-dlp 檢視可用格式、預覽並下載最高解析度縮圖。音訊與影片各推薦前三項，影片可選擇是否包含 AI 放大格式，並可下載為 MP4。
  - Media Downloader 的 Torrent 模式支援 magnet link、HTTPS `.torrent` 網址及本機 `.torrent` 檔；檔案會下載至媒體庫的 `Torrent Downloads`，完成後預設停止做種，可選擇繼續。aria2 會檢查 torrent 分片完整性，但不會驗證來源可信度或掃描惡意檔案；下載前請確認來源，並在可用時核對發佈者提供的 SHA-256 或 GPG 簽章。BitTorrent 節點可能看到你的 IP 位址。
  - 在 Karaoke Creator 貼上歌詞並選擇 MP3、FLAC、WAV 或 MP4；工具會先產生來源對應的 A/O stems，再以該來源的 Vocals WAV 對齊歌詞並輸出逐字變色的 ASS 字幕至媒體庫 `karaoke\<歌手>\<專輯>\<歌名>.ass`。可選擇開啟 LRC 對齊；開啟後可選外部 `.lrc`，或自動查找同名 Music LRC／MP3 內嵌同步歌詞，沒有本機時間歌詞時會搜尋線上結果供選擇。LRC 預設關閉，未使用時保留原本歌詞對齊流程。按 Player 的 K 鍵可播放影片並顯示字幕；沒有影片時會以 Music 伴奏播放、封面作底，亦可切換至人聲 stem。播放時每個字會隨該字的演唱時間由左至右逐步填色。
  - Vocal Splitter 可將 MP3、FLAC、WAV 或 MP4 分成人聲與伴奏。K 歌時可在 K 按鈕旁選擇影片伴奏／原聲，或純音訊的伴奏／人聲；有伴奏音軌時預設播放伴奏，影片畫面或封面和字幕會持續播放。

- 按 Space 切換播放／暫停；重新開啟時恢復上次曲目與播放位置，並保持暫停。
- 記住音量、Pan、Transpose 等偏好設定。

## TODO

 高
- Media Downloader 支援下載推薦音訊格式至 Downloads；MP3 轉檔及 MP4 合併／轉封裝需要 FFmpeg。
- Spleeter拆分
- 建立ktv字幕
- 素材庫
- 搜尋 按不同
- 播放記錄 (登入)
- 排行榜
- 播放music/video/vocal/accompaniments/ktv
- 顯示目前歌曲人聲的音高。  
-   持續改善 Get Info 搜尋結果排序，讓正確歌曲與版本更優先。
- Get Info選擇欄位更新
 - 擴充快捷鍵與踏板操作：播放／暫停、上一首／下一首、升降調及 A–B 循環，方便演唱或練習時免用滑鼠。
  - 新增播放速度調整。
  - 新增曲目書籤，可儲存前奏、主歌、副歌等時間點並快速跳轉。
  - AirPlay support
  - Chromecast support

中
 - 提供重複曲目提示及批次整理，協助找出重複歌曲、缺少標籤或缺少歌詞的檔案。
  - 新增全曲庫搜尋與篩選，可依歌名、歌手、專輯、格式、歌詞或封面篩選。
- 新增 A–B 循環播放：設定段落起點與終點，反覆練習歌詞或樂段。
- 新增歌詞時間微調：整份 LRC 歌詞前移／後移，並支援逐句重新對時或點擊打拍校準。
- 支援 MP4 外掛字幕（`.srt`、`.ass`、`.vtt`），並可調整字幕大小、位置與延遲。

低
- 增加多種唱歌練習功能與模式。
- 獨立調整播放速度與音高：可降速但維持原調，或改變 Key 而維持原速度。
- 新增 EQ 等化器與預設，例如流行、人聲、低音，並支援自訂調整。
- 支援以 M3U 等格式匯入及匯出播放清單，方便備份與分享。
 

## 開發環境

- Node.js 與 npm
- Windows

## 開始使用

```powershell
npm install
npm run dev
```

`npm run dev` compiles the Electron main process before starting the development watchers, then explicitly enables the local Vite renderer for the unpackaged development app. The app allows only one running instance and restores its previous window position and size when that display is still connected; otherwise it opens centered on the primary display. Packaged builds always load their bundled renderer and do not trust a service listening on the development port.

Media Downloader 需要另外安裝 yt-dlp，並確保 `yt-dlp` 命令可從 PATH 執行。下載的影片、音訊和縮圖會儲存至 Config 設定的媒體庫位置下的 `Downloads` 資料夾（例如 `C:\Media\Downloads`）。Torrent 模式另將內容存至 `Torrent Downloads`；aria2 RPC 僅綁定本機並使用隨機密鑰，Windows 使用 `prealloc` 磁碟配置。BitTorrent 的 DHT／swarm 可能讓其他節點看到你的 IP 位址；torrent 分片雜湊可檢查資料完整性，但不能取代來源信任、SHA-256／GPG 發佈者校驗或惡意檔案掃描。請只下載可信來源提供的內容。aria2 引擎隨應用程式封裝，分發封裝版本時須遵守 aria2 的 GPL-2.0-or-later 授權條款。轉為 MP3 或下載 MP4（需要音訊合併／轉封裝）時也需要安裝 FFmpeg，並確保 `ffmpeg` 命令可從 PATH 執行。

Karaoke Creator 需要 Python 及 faster-whisper；自動建立 A/O stems 還需要 Spleeter 或 Demucs，以及 FFmpeg。開發環境可執行 `.venv\Scripts\python.exe -m pip install -r requirements-lyrics.txt`；已封裝的 app 則在 Python 環境執行 `python -m pip install faster-whisper "av<19"`，並安裝可從 PATH 執行的 `spleeter` 或 `demucs` 命令及 FFmpeg。PyAV 需維持在 19 以下以配合 faster-whisper 的音訊解碼 API。首次對齊會下載 faster-whisper 的 small 模型。來源需位於媒體庫 `Music\<歌手>\<專輯>\` 或 `Video\<歌手>\<專輯>\` 目錄下；Creator 會先產生來源對應的 A/O stems，再僅以該來源的 Vocals WAV 做一次語音辨識及歌詞對齊，最後把 ASS 字幕按相同歌手／專輯結構存入 `karaoke` 資料夾。LRC 對齊需由使用者開啟；可選外部 `.lrc`，否則會查找同名 Music `.lrc` 和 `.mp3` 內嵌同步歌詞，再以媒體名稱及歌手／專輯資料搜尋線上同步歌詞供選擇。純音訊 K 歌使用 Music A/O stems，並以原曲封面顯示字幕。

Vocal Splitter 需要安裝 Spleeter 或 Demucs，並確保 `spleeter` 或 `demucs` 命令可從 PATH 執行；處理 MP4 還需要 FFmpeg。來源例如 `C:\Media\Music\孫燕姿\單曲\飛瀑而下.mp3` 和 `C:\Media\Video\孫燕姿\單曲\飛瀑而下.mp4`，會分別輸出到 `Music_Accompaniments`／`Music_Vocals` 和 `Video_Accompaniments`／`Video_Vocals` 四個資料夾，避免同名 CD 與 MV stems 覆蓋。K 有影片時以 Video 播放並可使用 Video 伴奏；沒有影片時則使用 Music 伴奏／人聲。A、O 可各自選 Music 或 Video，預設 Music；播放時會以同組 Music 的 MP3 顯示封面及歌詞。自動分軌只將所有歌手合成一條人聲軌及一條伴奏軌，不會分開男女聲或個別歌手。

## 建置

```powershell
npm run build
```

Windows portable app 會由 electron-builder 建置至 `dist` 資料夾。

## 測試

```powershell
npm test
```

測試統一放在根目錄 `tests/`：

- `tests/unit/`：播放清單、歌詞時間、已儲存播放清單資料驗證，以及 Electron bridge 能力與 IPC 回應格式檢查等純函式。
- `tests/components/`：播放／伴奏按鈕、升降調控制、歌詞模式切換、歌詞顯示與點擊跳播；`AppPlaylistSelection.integration.test.tsx` 會掛載 App，驗證播放清單單擊預覽、雙擊播放、歌詞載入、畫面／歌詞模式保留，以及播放失敗時的可見訊息（Electron API 與媒體 API 使用測試替身）。

開發期間可使用 `npm run test:watch` 持續執行測試。這些單元與元件測試驗證語意化顯示及使用者操作；完整 Electron 視窗的像素排版仍需另外執行端對端或視覺測試。

瀏覽器回歸測試使用 Playwright，會在 840×780、1000×700、390×844 及 1440×900 視窗下檢查播放控制列不會超出可視範圍：

```powershell
npx playwright install chromium
npm run test:browser
```

自動瀏覽器測試尚未覆蓋本機檔案載入、實際音訊／影片播放或 Electron IPC；IPC bridge 的能力與回應格式由單元測試檢查，修改實際檔案或媒體流程時仍需額外做 Electron／瀏覽器 smoke test。

## 資料儲存

播放清單與其他播放器資料會存於 Electron 的使用者資料目錄。Windows 預設為：

```text
C:\Users\<使用者名稱>\AppData\Roaming\mintplayer
```
