const CONFIG = {
  masterUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRKIyvrj-37wkIjtk-sMBxPVrTSuIe-Uj--BO01yr2PObRTuVoeX1RF9t3czvdbpHm2lrJzMnO5P_mX/pub?gid=0&single=true&output=csv',
  scheduleUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRKIyvrj-37wkIjtk-sMBxPVrTSuIe-Uj--BO01yr2PObRTuVoeX1RF9t3czvdbpHm2lrJzMnO5P_mX/pub?gid=1402356737&single=true&output=csv'
};

window.onerror = function(msg, url, line) {
  alert("JS Error: " + msg + " at line " + line);
};
window.addEventListener("unhandledrejection", function(e) {
  alert("Promise Error: " + (e.reason && e.reason.message ? e.reason.message : e.reason));
});

function initApp() {
  // 簡易的なパスワード認証 (localStorageによる再訪問時のスキップ機能つき)
  const isAuthPassed = localStorage.getItem('pta_auth_passed') === 'true';

  if (!isAuthPassed) {
    const pass = prompt("PTAスケジュールを開くためのパスワードを入力してください：");
    if (!pass || btoa(pass) !== "aGFiYXRha2llbGUh") {
      // 画面全体をエラーメッセージで上書きして非表示にする
      document.body.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; background-color: #F8FAFC;">
          <h2 style="color: #64748B;">パスワードが違います</h2>
          <p style="margin-top: 12px; color: #94A3B8;">ページを再読み込みしてやり直してください。</p>
        </div>
      `;
      return;
    }
    // パスワードが合っていればブラウザの領域に「認証済み」を記録して次回スキップ
    localStorage.setItem('pta_auth_passed', 'true');
  }

  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', loadData);
  } else {
    alert("初期化エラー: ボタンが見つかりません。");
  }
  
  // 日付フィルターのイベントリスナー設定
  document.getElementById('filter-start-date').addEventListener('change', (e) => {
    appState.filterStartDate = e.target.value ? new Date(e.target.value) : null;
    renderGantt();
  });
  document.getElementById('filter-end-date').addEventListener('change', (e) => {
    // 期間の「終了日の終わり」までを含めるために、必要に応じて時刻を調整（ここではシンプルに日付比較）
    appState.filterEndDate = e.target.value ? new Date(e.target.value) : null;
    renderGantt();
  });

  // 初期表示データの読み込み
  loadData();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

async function loadData() {
  const btn = document.getElementById('refresh-btn');
  let orgText = "最新データを読み込む";
  if(btn) {
    orgText = btn.textContent;
    btn.textContent = "読み込み中...";
    btn.disabled = true;
  }

  let masterText, scheduleText;
  try {
    const [mRes, sRes] = await Promise.all([fetch(CONFIG.masterUrl), fetch(CONFIG.scheduleUrl)]);
    if (!mRes.ok || !sRes.ok) throw new Error("CSVの取得に失敗しました。URLを確認してください。");
    masterText = await mRes.text();
    scheduleText = await sRes.text();
  } catch (e) {
    alert(e.message);
    if(btn) {
      btn.textContent = orgText;
      btn.disabled = false;
    }
    return;
  }
  
  if(btn) {
    btn.textContent = orgText;
    btn.disabled = false;
  }
  
  processData(masterText, scheduleText);
}

// 簡易CSVパーサー
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length === 0) return { headers: [], data: [] };
  
  // 日本語ヘッダーのBOM考慮 (BOMを削除)
  const headers = lines[0].replace(/^\uFEFF/, '').split(',').map(s => s.trim());
  const data = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(',');
    if (row.length === 1 && !row[0]) continue;
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = row[idx] ? row[idx].trim() : '';
    });
    data.push(obj);
  }
  return { headers, data };
}

let appState = {
  groupedSchedules: [],
  assignees: [], // 重複なし担当者リスト
  selectedAssignees: new Set(),
  roles: [], // 重複なし役割リスト
  selectedRoles: new Set(),
  filterStartDate: null,
  filterEndDate: null,
  minDate: null,
  maxDate: null,
  dayDiff: 0
};

function processData(masterCSV, scheduleCSV) {
  const master = parseCSV(masterCSV).data;
  const schedules = parseCSV(scheduleCSV).data;
  
  // マスタ（役割）のマッピングと役割一覧の抽出
  const roleMap = {};
  const rolesSet = new Set();
  master.forEach(m => {
    if (m['名前']) roleMap[m['名前']] = m['役割'];
    if (m['役割']) rolesSet.add(m['役割']);
  });
  
  const assigneesSet = new Set();
  
  let minDate = new Date(3000, 0, 1);
  let maxDate = new Date(1970, 0, 1);
  
  const groupedMap = new Map();
  
  schedules.forEach(s => {
    // 実際のシートの「担当者」列または「担当」列 両方に対応
    const assignee = s['担当'] || s['担当者'] || '';

    s.startDate = new Date(s['開始日']);
    s.endDate = new Date(s['終了日']);
    
    // 日付が不正な場合はスキップ
    if (isNaN(s.startDate) || isNaN(s.endDate)) return;
    
    if (s.startDate < minDate) minDate = s.startDate;
    if (s.endDate > maxDate) maxDate = s.endDate;
    
    if (assignee) assigneesSet.add(assignee);
    const role = roleMap[assignee] || '（役割未設定）';
    rolesSet.add(role);

    // 同一の「予定名」「開始日」「終了日」をキーにしてグループ化
    const key = `${s['予定']}_${s.startDate.getTime()}_${s.endDate.getTime()}`;
    if (!groupedMap.has(key)) {
      groupedMap.set(key, {
        title: s['予定'],
        startDate: s.startDate,
        endDate: s.endDate,
        assignees: new Set(),
        roles: new Set()
      });
    }
    const group = groupedMap.get(key);
    if (assignee) group.assignees.add(assignee);
    group.roles.add(role);
  });
  
  const groupedSchedules = Array.from(groupedMap.values()).map(g => ({
    ...g,
    assignees: Array.from(g.assignees),
    roles: Array.from(g.roles)
  }));
  
  if (minDate > maxDate) {
    // データがない場合
    minDate = new Date();
    maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + 7);
  } else {
    // 前後に少し余白を持たせる
    minDate.setDate(minDate.getDate() - 2);
    maxDate.setDate(maxDate.getDate() + 2);
  }
  
  const dayMs = 1000 * 60 * 60 * 24;
  const dayDiff = Math.floor((maxDate - minDate) / dayMs) + 1;
  const allRoles = Array.from(rolesSet).sort();
  
  appState = {
    ...appState, // 既存のfilterStartDateなどを引き継ぐ
    groupedSchedules: groupedSchedules,
    assignees: Array.from(assigneesSet).sort(),
    selectedAssignees: new Set(assigneesSet),
    roles: allRoles,
    selectedRoles: new Set(allRoles),
    minDate,
    maxDate,
    dayDiff
  };
  
  renderFilters();
  renderGantt();

  // スマホなど画面が小さい場合は、読み込み完了後にアコーディオンを少し閉じるなどの配慮
  if (window.innerWidth < 768) {
    const panel = document.querySelector('.accordion-panel');
    if (panel && panel.removeAttribute) {
      panel.removeAttribute('open');
    }
  }
}

function renderFilters() {
  // 役割フィルター
  const roleContainer = document.getElementById('role-filter-container');
  roleContainer.innerHTML = '';
  appState.roles.forEach(role => {
    const label = document.createElement('label');
    label.className = 'filter-chip';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = role;
    input.checked = appState.selectedRoles.has(role);
    input.addEventListener('change', (e) => {
      if (e.target.checked) appState.selectedRoles.add(role);
      else appState.selectedRoles.delete(role);
      renderGantt();
    });
    const span = document.createElement('span');
    span.textContent = role;
    label.appendChild(input);
    label.appendChild(span);
    roleContainer.appendChild(label);
  });

  // 担当者フィルター
  const assigneeContainer = document.getElementById('assignee-filter-container');
  assigneeContainer.innerHTML = '';
  appState.assignees.forEach(assignee => {
    const label = document.createElement('label');
    label.className = 'filter-chip';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = assignee;
    input.checked = appState.selectedAssignees.has(assignee);
    input.addEventListener('change', (e) => {
      if (e.target.checked) appState.selectedAssignees.add(assignee);
      else appState.selectedAssignees.delete(assignee);
      renderGantt();
    });
    const span = document.createElement('span');
    span.textContent = assignee;
    label.appendChild(input);
    label.appendChild(span);
    assigneeContainer.appendChild(label);
  });
}

function renderGantt() {
  const container = document.getElementById('gantt-container');
  container.innerHTML = '';
  
  const { groupedSchedules, selectedAssignees, minDate, maxDate, dayDiff } = appState;
  
  // フィルター処理と開始日でのソート（AND検索）
  const filtered = groupedSchedules
    .filter(g => {
      // 1. 担当者フィルター: その予定にアサインされているメンバーのうち1人でも選択されていれば表示
      const matchAssignee = g.assignees.some(a => appState.selectedAssignees.has(a));
      
      // 2. 役割フィルター: その予定に関わる役割が1つでも選択されていれば表示
      const matchRole = g.roles.some(r => appState.selectedRoles.has(r));
      
      // 3. 日付フィルター（指定された日付範囲とオーバーラップする予定）
      let matchDate = true;
      if (appState.filterStartDate) {
        matchDate = matchDate && (g.endDate >= appState.filterStartDate);
      }
      if (appState.filterEndDate) {
        matchDate = matchDate && (g.startDate <= appState.filterEndDate);
      }

      return matchAssignee && matchRole && matchDate;
    })
    .sort((a, b) => a.startDate - b.startDate);
  
  // 左端セル（130px）＋ 各日付セル（40pxスマホ, PCならもう少し広くても良いが固定で40px）
  const leftColWidth = window.innerWidth < 768 ? '110px' : '140px';
  const dayColWidth = '40px';
  
  container.style.gridTemplateColumns = `${leftColWidth} repeat(${dayDiff}, ${dayColWidth})`;
  
  // ヘッダー（左上）
  const tlCell = document.createElement('div');
  tlCell.className = 'gantt-cell gantt-header gantt-header-title';
  tlCell.textContent = '予定 / 担当';
  tlCell.style.gridRow = '1';
  tlCell.style.gridColumn = '1';
  container.appendChild(tlCell);
  
  const daysOfWeek = ['日', '月', '火', '水', '木', '金', '土'];
  const dayMs = 1000 * 60 * 60 * 24;
  
  // JSTでの今日の日付を取得
  const now = new Date();
  const jstStr = now.toLocaleString("en-US", {timeZone: "Asia/Tokyo", year:"numeric", month:"2-digit", day:"2-digit"});
  // jstStr is "MM/DD/YYYY"
  const [jstM, jstD, jstY] = jstStr.split('/');
  const todayJST = new Date(jstY, jstM - 1, jstD);
  
  // 日付ヘッダーの描画
  for (let i = 0; i < dayDiff; i++) {
    const colDate = new Date(minDate.getTime() + i * dayMs);
    const dayCell = document.createElement('div');
    dayCell.className = 'gantt-cell gantt-header';
    if (colDate.getDay() === 0 || colDate.getDay() === 6) {
       dayCell.classList.add('weekend');
    }
    
    let isToday = false;
    if (colDate.getTime() === todayJST.getTime()) {
      isToday = true;
      dayCell.classList.add('today-highlight');
    }
    
    // スマホを考慮して改行表示
    if (isToday) {
      dayCell.innerHTML = `<span>${colDate.getMonth()+1}/${colDate.getDate()}</span><span style="color:#B45309; font-weight:bold;">(今日)</span>`;
    } else {
      dayCell.innerHTML = `<span>${colDate.getMonth()+1}/${colDate.getDate()}</span><span>(${daysOfWeek[colDate.getDay()]})</span>`;
    }
    dayCell.style.gridRow = '1';
    dayCell.style.gridColumn = `${i + 2}`;
    container.appendChild(dayCell);
  }
  
  // 背景のグリッド線の描画（１まとまりにしてDOM数を減らす）
  const bgGrid = document.createElement('div');
  // データが0件の場合は2行目までをカバー
  const rowsCount = filtered.length > 0 ? filtered.length : 1;
  bgGrid.style.gridRow = `2 / span ${rowsCount}`;
  bgGrid.style.gridColumn = `2 / -1`;
  bgGrid.style.display = 'grid';
  bgGrid.style.gridTemplateColumns = `repeat(${dayDiff}, ${dayColWidth})`;
  bgGrid.style.zIndex = '0';
  for(let i=0; i<dayDiff; i++) {
     const colDate = new Date(minDate.getTime() + i * dayMs);
     const vertLine = document.createElement('div');
     vertLine.style.borderRight = '1px solid var(--gantt-grid-border)';
     if (colDate.getDay() === 0 || colDate.getDay() === 6) vertLine.style.backgroundColor = 'var(--bg-color)';
     
     if (colDate.getTime() === todayJST.getTime()) {
       vertLine.classList.add('gantt-grid-col-today');
     }
     
     bgGrid.appendChild(vertLine);
  }
  container.appendChild(bgGrid);

  if (filtered.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.style.gridRow = '2';
    emptyMsg.style.gridColumn = '1 / -1';
    emptyMsg.style.textAlign = 'center';
    emptyMsg.style.padding = '24px';
    emptyMsg.style.color = 'var(--text-muted)';
    emptyMsg.style.zIndex = '10';
    emptyMsg.style.display = 'flex';
    emptyMsg.style.alignItems = 'center';
    emptyMsg.style.justifyContent = 'center';
    emptyMsg.textContent = '表示する予定がありません。';
    container.appendChild(emptyMsg);
    return;
  }

  const barColors = ['var(--bar-color-1)', 'var(--bar-color-2)', 'var(--bar-color-3)', 'var(--bar-color-4)', 'var(--bar-color-5)'];
  let colorIndex = 0;
  
  // 各予定の描画
  filtered.forEach((g, index) => {
    const row = index + 2;
    
    // 左列のタイトル
    const titleCell = document.createElement('div');
    titleCell.className = 'gantt-cell gantt-row-title';
    titleCell.style.gridRow = `${row}`;
    titleCell.style.gridColumn = '1';
    
    titleCell.innerHTML = `
      <div style="color:var(--text-color); font-weight:600; font-size:0.85rem; line-height:1.3; margin-bottom:4px;">${g.title}</div>
      <div style="color:var(--text-muted); font-size:0.75rem; line-height:1.4;">${g.assignees.join(', ')}</div>
    `;
    container.appendChild(titleCell);
    
    // バーの描画
    const startOffset = Math.floor((g.startDate - minDate) / dayMs);
    const endOffset = Math.floor((g.endDate - minDate) / dayMs);
    const span = endOffset - startOffset + 1;
    
    const barWrap = document.createElement('div');
    barWrap.style.gridRow = `${row}`;
    barWrap.style.gridColumn = `${startOffset + 2} / span ${span}`;
    barWrap.style.position = 'relative';
    barWrap.style.zIndex = '5';
    
    // バー本体
    const bar = document.createElement('div');
    bar.className = 'gantt-bar';
    bar.style.backgroundColor = barColors[colorIndex % barColors.length];
    colorIndex++;
    bar.style.left = '4px'; // セル内のマージン
    bar.style.right = '4px';
    bar.textContent = g.title;

    
    barWrap.appendChild(bar);
    container.appendChild(barWrap);
  });

  // レンダリング直後に今日の日付へスクロールする
  setTimeout(() => {
    const todayIndex = Math.floor((todayJST - minDate) / dayMs);
    if (todayIndex >= 0 && todayIndex < dayDiff) {
      const wrapper = document.querySelector('.gantt-wrapper');
      if (wrapper) {
        // 左側の担当者列の幅ではなく、純粋に日付列の幅のみでスクロール位置を計算
        // （担当者列はposition: stickyで画面左端に追従するため）
        // 2日分（dayColWidth * 2）手前から見えるようにマージンを持たせる
        const scrollPos = Math.max(0, (todayIndex - 2) * 40);
        wrapper.scrollLeft = scrollPos;
      }
    }
  }, 10);
}
