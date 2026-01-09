let isXTabActive = false;
let currentTabId = null;
let countInterval = null;
let isSystemIdle = false; // システムがアイドル/スリープ状態かどうか

// 今日の日付を取得 (YYYY-MM-DD形式、日本時間基準)
function getTodayKey() {
  const now = new Date();
  // 日本時間（UTC+9）に変換
  const jstOffset = 9 * 60 * 60 * 1000; // 9時間をミリ秒に変換
  const jstDate = new Date(now.getTime() + jstOffset);
  return jstDate.toISOString().split('T')[0];
}

// 現在の時刻（JST）の時間を取得 (0-23)
function getCurrentHourJST() {
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000; // 9時間をミリ秒に変換
  const jstDate = new Date(now.getTime() + jstOffset);
  return jstDate.getUTCHours();
}

// URLがXのページかチェック
function isXUrl(url) {
  if (!url) return false;
  return url.startsWith('https://x.com/') || url.startsWith('https://twitter.com/');
}

// 使用時間を1秒増やす
async function incrementUsage() {
  const today = getTodayKey();
  const currentHour = getCurrentHourJST();
  const result = await chrome.storage.local.get(['usage']);
  const usage = result.usage || {};

  // 配列の初期化
  if (!usage[today]) {
    usage[today] = new Array(24).fill(0);
  }

  // 配列でない場合は初期化（安全性のため）
  if (!Array.isArray(usage[today])) {
    usage[today] = new Array(24).fill(0);
  }

  // 現在の時間帯をインクリメント
  usage[today][currentHour] = (usage[today][currentHour] || 0) + 1;

  await chrome.storage.local.set({ usage });

  // コンテンツスクリプトには日別合計を送信
  const todayTotal = usage[today].reduce((sum, val) => sum + val, 0);
  if (currentTabId) {
    try {
      await chrome.tabs.sendMessage(currentTabId, {
        type: 'UPDATE_TIMER',
        usage: todayTotal
      });
    } catch (error) {
      // タブが閉じられた場合などはエラーを無視
    }
  }
}

// カウントを開始
function startCounting(tabId) {
  if (countInterval) return; // 既に開始している場合は何もしない
  if (isSystemIdle) return; // システムがアイドル/スリープ状態の場合は開始しない

  currentTabId = tabId;
  isXTabActive = true;

  // 1秒ごとに使用時間を増やす
  countInterval = setInterval(incrementUsage, 1000);
}

// カウントを停止
function stopCounting() {
  if (countInterval) {
    clearInterval(countInterval);
    countInterval = null;
  }

  isXTabActive = false;
  currentTabId = null;
}

// アクティブタブをチェック
async function checkActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab) {
    stopCounting();
    return;
  }

  if (isXUrl(tab.url)) {
    startCounting(tab.id);
  } else {
    stopCounting();
  }
}

// タブのアクティブ状態が変わった時
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);

  if (isXUrl(tab.url)) {
    startCounting(tab.id);
  } else {
    stopCounting();
  }
});

// タブのURLが変わった時
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (activeTab && activeTab.id === tabId) {
      if (isXUrl(changeInfo.url)) {
        startCounting(tabId);
      } else {
        stopCounting();
      }
    }
  }
});

// ウィンドウのフォーカスが変わった時
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // ウィンドウがフォーカスを失った
    stopCounting();
  } else {
    // ウィンドウがフォーカスを得た
    await checkActiveTab();
  }
});

// タブが閉じられた時
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === currentTabId) {
    stopCounting();
  }
});

// 拡張機能がインストールされた時の初期設定
chrome.runtime.onInstalled.addListener(async (details) => {
  // アップデートの場合は既存データを削除
  if (details.reason === 'update') {
    await chrome.storage.local.set({ usage: {} });
    console.log('時間別記録に更新 - 既存データ削除');
  }

  const result = await chrome.storage.local.get(['dailyLimit']);

  // デフォルトの制限時間を設定 (60分)
  if (!result.dailyLimit) {
    await chrome.storage.local.set({ dailyLimit: 60 });
  }

  // 現在のタブをチェック
  await checkActiveTab();
});

// コンテンツスクリプトからのメッセージを処理
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_USAGE') {
    (async () => {
      const today = getTodayKey();
      const result = await chrome.storage.local.get(['dailyLimit', 'usage']);
      const dailyLimit = result.dailyLimit || 60;
      const usage = result.usage || {};

      let todayUsage = 0;
      if (usage[today]) {
        if (Array.isArray(usage[today])) {
          todayUsage = usage[today].reduce((sum, val) => sum + val, 0);
        } else {
          todayUsage = usage[today]; // レガシーフォールバック
        }
      }

      sendResponse({
        dailyLimit: dailyLimit * 60, // 秒に変換
        usage: todayUsage
      });
    })();

    return true; // 非同期レスポンスを示す
  }
});

// システムのアイドル状態を監視
// アイドル検出の間隔を60秒に設定
chrome.idle.setDetectionInterval(60);

chrome.idle.onStateChanged.addListener((newState) => {
  // newStateは "active", "idle", "locked" のいずれか
  if (newState === 'idle' || newState === 'locked') {
    // アイドル状態またはロック状態（スリープ含む）の場合
    isSystemIdle = true;
    stopCounting();
  } else if (newState === 'active') {
    // アクティブ状態に戻った場合
    isSystemIdle = false;
    // Xタブがアクティブな場合は、カウントを再開
    checkActiveTab();
  }
});

// 初期チェック
checkActiveTab();
