let isXTabActive = false;
let currentTabId = null;
let countInterval = null;
let isSystemIdle = false; // システムがアイドル/スリープ状態かどうか
let isPopupOpen = false; // ポップアップが開いているかどうか

// 現在時刻（JST）のUnixタイムスタンプ（ミリ秒）を取得
function getNowJST() {
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000;
  return now.getTime() + jstOffset;
}

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
  // ポップアップが開いている場合はカウントしない
  if (isPopupOpen) {
    return;
  }

  const today = getTodayKey();
  const currentHour = getCurrentHourJST();
  const result = await chrome.storage.local.get(['usage', 'deletedAt']);
  const usage = result.usage || {};
  const deletedAt = result.deletedAt || {};

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

  // 削除時刻より後に記録されたデータは削除扱いを解除
  const updates = { usage };
  const nowJst = getNowJST();
  if (deletedAt[today] && deletedAt[today][currentHour] !== undefined) {
    // 削除時刻より後にデータが記録された → 削除マークを解除
    if (nowJst > deletedAt[today][currentHour]) {
      delete deletedAt[today][currentHour];
      const remaining = Object.keys(deletedAt[today]);
      if (remaining.length === 0) delete deletedAt[today];
      updates.deletedAt = deletedAt;
    }
  }

  await chrome.storage.local.set(updates);

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
  // 旧データ形式（数値）を新形式（配列）に移行
  if (details.reason === 'update' || details.reason === 'install') {
    const result = await chrome.storage.local.get(['usage']);
    const usage = result.usage || {};

    // データ形式をチェック：旧形式（数値）が含まれている場合のみ削除
    let hasOldFormat = false;
    for (const date in usage) {
      if (typeof usage[date] === 'number') {
        hasOldFormat = true;
        break;
      }
    }

    if (hasOldFormat) {
      await chrome.storage.local.set({ usage: {} });
      console.log('旧データ形式を検出 - データをリセット');
    }
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

// ポップアップの開閉を検知
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'popup') {
    isPopupOpen = true;
    console.log('ポップアップが開かれました - カウント停止');

    port.onDisconnect.addListener(() => {
      isPopupOpen = false;
      console.log('ポップアップが閉じられました - カウント再開');
    });
  }
});

// ---- サーバー同期 ----

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5分

async function getSyncSettings() {
  const result = await chrome.storage.local.get(['syncToken', 'apiBaseUrl']);
  return {
    token: result.syncToken || '',
    baseUrl: (result.apiBaseUrl || '').replace(/\/$/, '')
  };
}

async function syncWithServer() {
  const { syncEnabled } = await chrome.storage.local.get(['syncEnabled']);
  if (!syncEnabled) return;

  const { token, baseUrl } = await getSyncSettings();
  if (!token || !baseUrl) return;

  const result = await chrome.storage.local.get(['usage', 'deletedAt']);
  const localUsage = result.usage || {};
  const localDeletedAt = result.deletedAt || {};

  try {
    const response = await fetch(`${baseUrl}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, usage: localUsage, deletedAt: localDeletedAt })
    });

    if (!response.ok) throw new Error(`Server returned ${response.status}`);

    const data = await response.json();
    const serverUsage = data.usage || {};
    const serverDeletedAt = data.deletedAt || {};

    // すべての端末の削除情報をマージ（hourごとに最も古い削除時刻を採用）
    const mergedDeletedAt = { ...localDeletedAt };
    for (const date in serverDeletedAt) {
      if (!mergedDeletedAt[date]) {
        mergedDeletedAt[date] = { ...serverDeletedAt[date] };
      } else {
        for (const hour in serverDeletedAt[date]) {
          if (mergedDeletedAt[date][hour] === undefined) {
            mergedDeletedAt[date][hour] = serverDeletedAt[date][hour];
          } else {
            // より古い（小さい）削除時刻を採用
            mergedDeletedAt[date][hour] = Math.min(
              mergedDeletedAt[date][hour],
              serverDeletedAt[date][hour]
            );
          }
        }
      }
    }

    // usage をマージ（各端末の最大値を採用）
    const mergedUsage = {};
    const allDates = new Set([...Object.keys(localUsage), ...Object.keys(serverUsage)]);
    for (const date of allDates) {
      mergedUsage[date] = new Array(24).fill(0);
      for (let h = 0; h < 24; h++) {
        mergedUsage[date][h] = Math.max(
          (localUsage[date] || [])[h] || 0,
          (serverUsage[date] || [])[h] || 0
        );
      }
    }

    // 削除情報を適用：削除時刻より後に記録されたデータは保持するため、
    // 削除済み時間帯は Math.max の結果をそのまま使う（強制ゼロにしない）
    // これにより、端末Aで削除した時間帯でも端末Bで使った新しいデータは残る

    await chrome.storage.local.set({
      usage: mergedUsage,
      deletedAt: mergedDeletedAt,
      lastSyncTime: Date.now(),
      lastSyncError: null
    });
  } catch (error) {
    await chrome.storage.local.set({ lastSyncError: error.message });
  }
}

setInterval(syncWithServer, SYNC_INTERVAL_MS);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SYNC_NOW') {
    (async () => {
      await syncWithServer();
      const result = await chrome.storage.local.get(['lastSyncTime', 'lastSyncError']);
      sendResponse({ lastSyncTime: result.lastSyncTime || null, lastSyncError: result.lastSyncError || null });
    })();
    return true;
  }

  if (message.type === 'GET_SYNC_STATUS') {
    (async () => {
      const result = await chrome.storage.local.get(['lastSyncTime', 'lastSyncError', 'syncToken', 'apiBaseUrl', 'syncEnabled']);
      sendResponse({
        lastSyncTime: result.lastSyncTime || null,
        lastSyncError: result.lastSyncError || null,
        configured: !!(result.syncToken && result.apiBaseUrl),
        syncEnabled: !!result.syncEnabled
      });
    })();
    return true;
  }
});

// 初期チェック
checkActiveTab();
// 起動時に同期を試みる
syncWithServer();
