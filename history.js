// 時間をフォーマット (分)
function formatMinutes(seconds) {
  const mins = Math.floor(seconds / 60);
  return `${mins}分`;
}

// 時間をフォーマット (時間と分)
function formatHoursMinutes(seconds) {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}時間${mins}分`;
  }
  return `${mins}分`;
}

// 日付をフォーマット
function formatDate(dateString) {
  const date = new Date(dateString);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${year}年${month}月${day}日`;
}

// 曜日を取得
function getWeekday(dateString) {
  const date = new Date(dateString);
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  return weekdays[date.getDay()];
}

// 今日の日付を取得 (YYYY-MM-DD形式、日本時間基準)
function getTodayKey() {
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000;
  const jstDate = new Date(now.getTime() + jstOffset);
  return jstDate.toISOString().split('T')[0];
}

// 統計情報を計算して表示
async function displayStats() {
  const result = await chrome.storage.local.get(['usage', 'dailyLimit']);
  const usage = result.usage || {};
  const dailyLimit = result.dailyLimit || 60;

  const dates = Object.keys(usage);
  const totalDays = dates.length;

  if (totalDays === 0) {
    document.getElementById('totalDays').textContent = '0日';
    document.getElementById('avgTime').textContent = '0分';
    document.getElementById('totalTime').textContent = '0分';
    return;
  }

  const totalSeconds = dates.reduce((sum, date) => {
    const dayData = usage[date];
    if (Array.isArray(dayData)) {
      return sum + dayData.reduce((s, v) => s + v, 0);
    } else {
      return sum + dayData; // レガシー
    }
  }, 0);
  const avgSeconds = Math.floor(totalSeconds / totalDays);

  document.getElementById('totalDays').textContent = `${totalDays}日`;
  document.getElementById('avgTime').textContent = formatMinutes(avgSeconds);
  document.getElementById('totalTime').textContent = formatHoursMinutes(totalSeconds);

  return { usage, dailyLimit };
}

// 履歴リストを表示
async function displayHistory() {
  const data = await displayStats();

  if (!data) {
    document.getElementById('historyList').innerHTML = '<div class="no-history">履歴がありません</div>';
    return;
  }

  const { usage, dailyLimit } = data;
  const historyList = document.getElementById('historyList');

  // 日付でソート (新しい順)
  const sortedDates = Object.keys(usage).sort().reverse();

  if (sortedDates.length === 0) {
    historyList.innerHTML = '<div class="no-history">履歴がありません</div>';
    return;
  }

  historyList.innerHTML = '';

  // 最大値を取得（バーグラフのスケール用）
  const maxSeconds = Math.max(...Object.values(usage), dailyLimit * 60);

  sortedDates.forEach(date => {
    let seconds = 0;
    const dayData = usage[date];
    if (Array.isArray(dayData)) {
      seconds = dayData.reduce((sum, val) => sum + val, 0);
    } else {
      seconds = dayData; // レガシー
    }

    const minutes = Math.floor(seconds / 60);
    const dailyLimitSeconds = dailyLimit * 60;
    const isOverLimit = seconds > dailyLimitSeconds;
    const barWidth = (seconds / maxSeconds) * 100;

    const item = document.createElement('div');
    item.className = `history-item ${isOverLimit ? 'over-limit' : ''}`;
    item.innerHTML = `
      <div>
        <span class="history-date">${formatDate(date)}</span>
        <span class="history-weekday">(${getWeekday(date)})</span>
      </div>
      <div class="history-bar-container">
        <div class="history-bar" style="width: ${barWidth}%"></div>
      </div>
      <span class="history-time">${minutes}分</span>
    `;
    historyList.appendChild(item);
  });
}

// 初期化
document.addEventListener('DOMContentLoaded', () => {
  displayHistory();

  // ストレージの変更を監視
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.usage) {
      displayHistory();
    }
  });
});
