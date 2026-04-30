// 统计模块 (stats.js)
// 依赖: Chart.js (CDN), db.js

let pieChart = null;
let lineChart = null;

// 获取所有有数据的年份
async function getAvailableYears() {
  const all = await db.transactions.orderBy('date').toArray();
  const years = new Set();
  for (const t of all) {
    if (t.date) years.add(t.date.slice(0, 4));
  }
  const y = new Date().getFullYear();
  years.add(String(y));
  return [...years].sort().reverse();
}

// 获取某时间段的支出
async function getExpenses(year, month) {
  let txs;
  if (month && month > 0) {
    txs = await getMonthTransactions(year, month);
  } else {
    // 全年
    txs = await db.transactions
      .where('date').between(`${year}-01-01`, `${year}-12-31`, true, true)
      .toArray();
  }
  return txs.filter(t => t.type === 'expense');
}

// 计算总支出
async function calcTotalExpense(year, month) {
  const expenses = await getExpenses(year, month);
  return expenses.reduce((sum, t) => sum + t.amount, 0);
}

// 计算日均支出
async function calcDailyAvg(expenses, month, year) {
  if (month && month > 0) {
    const days = new Date(year, month, 0).getDate();
    const todayDay = (new Date().getFullYear() === year && new Date().getMonth() + 1 === month)
      ? new Date().getDate() : days;
    return expenses.reduce((sum, t) => sum + t.amount, 0) / Math.max(1, todayDay);
  } else {
    // 全年
    const days = (new Date().getFullYear() === year)
      ? dayOfYear(new Date()) : 365;
    return expenses.reduce((sum, t) => sum + t.amount, 0) / Math.max(1, days);
  }
}

function dayOfYear(d) {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - start) / 86400000);
}

// 分类统计
function calcCategoryStats(expenses) {
  const map = {};
  for (const t of expenses) {
    map[t.category] = (map[t.category] || 0) + t.amount;
  }
  const total = Object.values(map).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(map)
    .map(([name, amount]) => ({ name, amount, pct: Math.round(amount / total * 100) }))
    .sort((a, b) => b.amount - a.amount);
}

// 每日趋势统计
async function calcDailyTrend(year, month) {
  if (month && month > 0) {
    const daysInMonth = new Date(year, month, 0).getDate();
    const map = {};
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      map[key] = 0;
    }
    const txs = await db.transactions
      .where('date').between(
        `${year}-${String(month).padStart(2, '0')}-01`,
        `${year}-${String(month).padStart(2, '0')}-${daysInMonth}`,
        true, true
      ).toArray();
    for (const t of txs) {
      if (t.type === 'expense' && map[t.date] !== undefined) {
        map[t.date] += t.amount;
      }
    }
    return Object.entries(map).map(([date, amount]) => ({
      date: date.slice(8), // DD
      amount: Math.round(amount * 100) / 100
    }));
  } else {
    // 全年 → 按月趋势
    const map = {};
    for (let m = 1; m <= 12; m++) {
      map[`${m}月`] = 0;
    }
    const txs = await db.transactions
      .where('date').between(`${year}-01-01`, `${year}-12-31`, true, true)
      .toArray();
    for (const t of txs) {
      if (t.type === 'expense' && t.date) {
        const m = parseInt(t.date.slice(5, 7));
        map[`${m}月`] += t.amount;
      }
    }
    return Object.entries(map).map(([date, amount]) => ({
      date,
      amount: Math.round(amount * 100) / 100
    }));
  }
}

// 渲染分类明细列表
function renderCategoryBreakdown(stats, total) {
  const container = document.getElementById('category-breakdown');
  if (stats.length === 0) {
    container.innerHTML = '<div style="color:var(--text-dim);font-size:13px;padding:8px 0;">暂无数据</div>';
    return;
  }
  const colors = ['#e94560', '#f39c12', '#2ecc71', '#3498db', '#9b59b6', '#1abc9c', '#e67e22', '#95a5a6'];
  container.innerHTML = stats.map((s, i) => {
    const icon = getIcon(s.name, 'expense');
    const color = colors[i % colors.length];
    return `
      <div class="cat-row">
        <div class="cat-row-left">
          <span class="cat-row-icon">${icon}</span>
          <span class="cat-row-name">${s.name}</span>
        </div>
        <div class="cat-row-right">
          <span class="cat-row-amount">¥${s.amount.toFixed(2)}</span>
          <span class="cat-row-pct">${s.pct}%</span>
          <div class="cat-row-bar-wrap">
            <div class="cat-row-bar" style="width:${s.pct}%;background:${color}"></div>
          </div>
        </div>
      </div>`;
  }).join('');
}

// 渲染饼图
function renderPieChart(stats) {
  const ctx = document.getElementById('chart-pie').getContext('2d');
  if (pieChart) pieChart.destroy();
  if (stats.length === 0) {
    pieChart = null;
    return;
  }
  const colors = ['#e94560', '#f39c12', '#2ecc71', '#3498db', '#9b59b6', '#1abc9c', '#e67e22', '#95a5a6', '#e74c3c'];
  pieChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: stats.map(s => s.name),
      datasets: [{
        data: stats.map(s => s.amount),
        backgroundColor: colors.slice(0, stats.length),
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#8899aa', padding: 16, font: { size: 12 } }
        }
      }
    }
  });
}

// 渲染折线图
function renderLineChart(trend) {
  const ctx = document.getElementById('chart-line').getContext('2d');
  if (lineChart) lineChart.destroy();
  lineChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: trend.map(d => d.date),
      datasets: [{
        label: '日支出',
        data: trend.map(d => d.amount),
        borderColor: '#e94560',
        backgroundColor: 'rgba(233,69,96,0.05)',
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          ticks: { color: '#556', font: { size: 10 }, maxTicksLimit: 12 },
          grid: { color: 'rgba(255,255,255,0.03)' }
        },
        y: {
          ticks: { color: '#556', font: { size: 10 }, callback: v => '¥' + v },
          grid: { color: 'rgba(255,255,255,0.03)' },
          beginAtZero: true
        }
      }
    }
  });
}

// 刷新统计页
async function refreshStats() {
  const selYear = document.getElementById('sel-year');
  const selMonth = document.getElementById('sel-month');
  const year = parseInt(selYear.value);
  const month = parseInt(selMonth.value);

  // 更新标签
  const totalLabel = document.getElementById('stat-total-label');
  const monthLabel = document.getElementById('stat-month-label');

  if (month === 0) {
    totalLabel.textContent = `${year}年总支出`;
    monthLabel.textContent = '月均支出';
  } else {
    totalLabel.textContent = `${year}年总支出`;
    monthLabel.textContent = `${month}月支出`;
  }

  const expenses = await getExpenses(year, month);
  const yearTotal = await calcTotalExpense(year, 0); // 全年总额

  let selectedTotal;
  if (month === 0) {
    selectedTotal = yearTotal;
  } else {
    selectedTotal = expenses.reduce((sum, t) => sum + t.amount, 0);
  }

  const dailyAvg = await calcDailyAvg(expenses, month, year);
  const catStats = calcCategoryStats(expenses);

  document.getElementById('stat-total').textContent = '¥' + yearTotal.toFixed(2);
  document.getElementById('stat-month-val').textContent = '¥' + selectedTotal.toFixed(2);
  document.getElementById('stat-daily-avg').textContent = '¥' + dailyAvg.toFixed(2);

  renderCategoryBreakdown(catStats, selectedTotal);
  renderPieChart(catStats);

  const trend = await calcDailyTrend(year, month);
  renderLineChart(trend);
}

// 初始化年份选择器
async function initYearSelector() {
  const selYear = document.getElementById('sel-year');
  const years = await getAvailableYears();
  selYear.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');
  const now = new Date();
  // 默认选今年
  const thisYear = String(now.getFullYear());
  if (years.includes(thisYear)) selYear.value = thisYear;
  // 默认选本月
  document.getElementById('sel-month').value = String(now.getMonth() + 1);

  // 事件
  selYear.addEventListener('change', refreshStats);
  document.getElementById('sel-month').addEventListener('change', refreshStats);
}
