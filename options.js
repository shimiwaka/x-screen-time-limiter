// ランダムトークンを生成（32文字の英数字）
function generateToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, b => chars[b % chars.length]).join('');
}

// 設定を読み込んで表示
async function loadSettings() {
  const result = await chrome.storage.local.get(['apiBaseUrl', 'syncToken', 'syncEnabled']);
  if (result.apiBaseUrl) {
    document.getElementById('apiBaseUrl').value = result.apiBaseUrl;
  }
  if (result.syncToken) {
    document.getElementById('syncToken').value = result.syncToken;
  }
  document.getElementById('syncEnabled').checked = !!result.syncEnabled;
}

// 同期ステータスを表示
async function updateSyncStatus() {
  const statusEl = document.getElementById('syncStatusDetail');
  try {
    const status = await chrome.runtime.sendMessage({ type: 'GET_SYNC_STATUS' });

    if (!status.configured) {
      statusEl.textContent = '未設定: APIベースURLとトークンを設定してください。';
      statusEl.className = 'status-box warning';
      return;
    }

    if (status.lastSyncError) {
      statusEl.textContent = `同期エラー: ${status.lastSyncError}`;
      statusEl.className = 'status-box error';
      return;
    }

    if (status.lastSyncTime) {
      const date = new Date(status.lastSyncTime);
      const dateStr = date.toLocaleString('ja-JP');
      statusEl.textContent = `最終同期: ${dateStr}`;
      statusEl.className = 'status-box ok';
    } else {
      statusEl.textContent = '設定済み。まだ同期していません。';
      statusEl.className = 'status-box warning';
    }
  } catch (e) {
    statusEl.textContent = '状態取得失敗';
    statusEl.className = 'status-box error';
  }
}

// 設定を保存
async function saveSettings() {
  const apiBaseUrl = document.getElementById('apiBaseUrl').value.trim().replace(/\/$/, '');
  const syncToken = document.getElementById('syncToken').value.trim();
  const syncEnabled = document.getElementById('syncEnabled').checked;
  const messageEl = document.getElementById('saveMessage');

  if (!apiBaseUrl && !syncToken) {
    // 両方空の場合はクリア
    await chrome.storage.local.remove(['apiBaseUrl', 'syncToken', 'syncEnabled']);
    messageEl.textContent = '同期設定を削除しました';
    messageEl.className = 'message success';
  } else if (!apiBaseUrl) {
    messageEl.textContent = 'APIベースURLを入力してください';
    messageEl.className = 'message error';
    setTimeout(() => { messageEl.textContent = ''; messageEl.className = 'message'; }, 3000);
    return;
  } else if (!syncToken) {
    messageEl.textContent = 'トークンを入力してください（「生成」ボタンで自動生成できます）';
    messageEl.className = 'message error';
    setTimeout(() => { messageEl.textContent = ''; messageEl.className = 'message'; }, 3000);
    return;
  } else {
    await chrome.storage.local.set({ apiBaseUrl, syncToken, syncEnabled });
    messageEl.textContent = '設定を保存しました';
    messageEl.className = 'message success';
  }

  setTimeout(() => { messageEl.textContent = ''; messageEl.className = 'message'; }, 3000);
  await updateSyncStatus();
}

// イベントリスナー
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await updateSyncStatus();

  document.getElementById('generateToken').addEventListener('click', () => {
    document.getElementById('syncToken').value = generateToken();
  });

  document.getElementById('saveSettings').addEventListener('click', saveSettings);

  document.getElementById('syncNowBtn').addEventListener('click', async () => {
    const btn = document.getElementById('syncNowBtn');
    const statusEl = document.getElementById('syncStatusDetail');
    btn.disabled = true;
    statusEl.textContent = '同期中...';
    statusEl.className = 'status-box';

    try {
      await chrome.runtime.sendMessage({ type: 'SYNC_NOW' });
      await updateSyncStatus();
    } catch (e) {
      statusEl.textContent = '同期失敗: ' + e.message;
      statusEl.className = 'status-box error';
    } finally {
      btn.disabled = false;
    }
  });
});
