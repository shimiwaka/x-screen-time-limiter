// 時間をフォーマット (分:秒)
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// 日付をフォーマット
function formatDate(dateString) {
  const date = new Date(dateString);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${month}月${day}日`;
}

// 今日の日付を取得 (YYYY-MM-DD形式、日本時間基準)
function getTodayKey() {
  const now = new Date();
  // 日本時間（UTC+9）に変換
  const jstOffset = 9 * 60 * 60 * 1000;
  const jstDate = new Date(now.getTime() + jstOffset);
  return jstDate.toISOString().split('T')[0];
}

// 使用状況を更新
async function updateUsageDisplay() {
  const today = getTodayKey();
  const result = await chrome.storage.local.get(['dailyLimit', 'usage']);

  const dailyLimit = result.dailyLimit || 60; // デフォルト60分
  const usage = result.usage || {};

  let todayUsage = 0;
  if (usage[today]) {
    if (Array.isArray(usage[today])) {
      todayUsage = usage[today].reduce((sum, val) => sum + val, 0);
    } else {
      todayUsage = usage[today]; // レガシー
    }
  }

  const dailyLimitSeconds = dailyLimit * 60;
  const remainingSeconds = Math.max(0, dailyLimitSeconds - todayUsage);

  document.getElementById('remainingTime').textContent = formatTime(remainingSeconds);
  document.getElementById('usedTime').textContent = formatTime(todayUsage);

  // 制限時間を入力欄に表示（フォーカスされていない場合のみ）
  const dailyLimitInput = document.getElementById('dailyLimit');
  if (document.activeElement !== dailyLimitInput) {
    dailyLimitInput.value = dailyLimit;
  }
}

// 使用履歴を表示（展開可能）
async function updateHistoryDisplay() {
  const result = await chrome.storage.local.get(['usage']);
  const usage = result.usage || {};
  const historyContainer = document.getElementById('historyContainer');

  // 日付でソート (新しい順)
  const sortedDates = Object.keys(usage).sort().reverse();

  if (sortedDates.length === 0) {
    historyContainer.innerHTML = '<div class="no-history">履歴がありません</div>';
    return;
  }

  historyContainer.innerHTML = '';

  // 最新7件（1週間分）を表示
  sortedDates.slice(0, 7).forEach(date => {
    const dayData = usage[date];
    let totalSeconds = 0;

    if (Array.isArray(dayData)) {
      totalSeconds = dayData.reduce((sum, val) => sum + val, 0);
    } else {
      totalSeconds = dayData; // レガシー
    }

    const minutes = Math.floor(totalSeconds / 60);

    // メインアイテム
    const item = document.createElement('div');
    item.className = 'history-item';
    item.dataset.date = date;
    item.innerHTML = `
      <span class="history-date">${formatDate(date)}</span>
      <span class="expand-icon">▶</span>
      <span class="history-time">${minutes}分</span>
    `;

    // 時間別詳細（デフォルトで非表示）
    const detailsDiv = document.createElement('div');
    detailsDiv.className = 'hourly-details';
    detailsDiv.style.display = 'none';

    if (Array.isArray(dayData)) {
      detailsDiv.innerHTML = `
        <div class="hourly-header">
          <span>時間帯別の使用時間</span>
          <button class="delete-hours-btn" data-date="${date}">選択した時間を削除</button>
        </div>
        <div class="hourly-list">
          ${dayData.map((seconds, hour) => {
            if (seconds === 0) return '';
            const mins = Math.floor(seconds / 60);
            const secs = seconds % 60;
            return `
              <div class="hourly-item">
                <input type="checkbox" class="hour-checkbox" data-hour="${hour}" />
                <span class="hour-range">${hour}:00 - ${hour}:59</span>
                <span class="hour-time">${mins}分${secs}秒</span>
              </div>
            `;
          }).join('')}
        </div>
      `;
    } else {
      detailsDiv.innerHTML = '<div class="legacy-notice">旧形式のため時間別表示不可</div>';
    }

    historyContainer.appendChild(item);
    historyContainer.appendChild(detailsDiv);

    // 展開/折りたたみ
    item.addEventListener('click', () => {
      const isExpanded = detailsDiv.style.display === 'block';
      detailsDiv.style.display = isExpanded ? 'none' : 'block';
      item.querySelector('.expand-icon').textContent = isExpanded ? '▶' : '▼';
    });
  });

  // 削除ボタンのイベントハンドラ
  document.querySelectorAll('.delete-hours-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const date = btn.dataset.date;
      await deleteSelectedHours(date);
    });
  });
}

// 選択された時間を削除
async function deleteSelectedHours(date) {
  // 該当する日付の詳細エリア内のチェックされたチェックボックスを取得
  const detailsDiv = document.querySelector(`[data-date="${date}"]`).nextElementSibling;
  const checkboxes = detailsDiv.querySelectorAll('.hour-checkbox:checked');

  if (checkboxes.length === 0) {
    alert('削除する時間を選択してください');
    return;
  }

  if (!confirm(`${checkboxes.length}時間分のデータを削除しますか？`)) {
    return;
  }

  const result = await chrome.storage.local.get(['usage']);
  const usage = result.usage || {};

  if (!usage[date] || !Array.isArray(usage[date])) {
    return;
  }

  // 選択された時間を0にする
  checkboxes.forEach(cb => {
    const hour = parseInt(cb.dataset.hour);
    usage[date][hour] = 0;
  });

  // 全ての時間が0なら日付ごと削除
  const hasAnyData = usage[date].some(val => val > 0);
  if (!hasAnyData) {
    delete usage[date];
  }

  await chrome.storage.local.set({ usage });

  updateUsageDisplay();
  updateHistoryDisplay();
}

// 設定を保存
async function saveDailyLimit() {
  const dailyLimit = parseInt(document.getElementById('dailyLimit').value);
  const messageDiv = document.getElementById('saveMessage');

  if (isNaN(dailyLimit) || dailyLimit < 1 || dailyLimit > 1440) {
    messageDiv.textContent = '1〜1440分の範囲で入力してください';
    messageDiv.className = 'message error';
    setTimeout(() => {
      messageDiv.textContent = '';
      messageDiv.className = 'message';
    }, 3000);
    return;
  }

  await chrome.storage.local.set({ dailyLimit });

  messageDiv.textContent = '保存しました';
  messageDiv.className = 'message success';
  setTimeout(() => {
    messageDiv.textContent = '';
    messageDiv.className = 'message';
  }, 2000);

  // 表示を更新
  updateUsageDisplay();
}

// イベントリスナーを設定
document.addEventListener('DOMContentLoaded', () => {
  // ポップアップが開いていることをbackground.jsに通知
  const port = chrome.runtime.connect({ name: 'popup' });

  updateUsageDisplay();
  updateHistoryDisplay();

  document.getElementById('saveButton').addEventListener('click', saveDailyLimit);

  // Enterキーでも保存できるように
  document.getElementById('dailyLimit').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      saveDailyLimit();
    }
  });

  // 全ての履歴を見るリンク
  document.getElementById('viewAllHistory').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('history.html') });
  });
});
