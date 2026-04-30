// 统计模块 (stats.js)
// 依赖: Chart.js (CDN), db.js

let pieChart = null;
let lineChart = null;

// 计算本周支出
async function calcWeekExpense() {
  const txs = await getWeekTransactions();
  return txs
    .filter(t => t.type === 'expense')
    .reduce((sum, t) => sum + t.amount, 0);
}

// 计算本月支出
async function calcMonthExpense(year, month) {
  const txs = await getMonthTransactions(year, month);
  return txs
    .filter(t => t.type === 'expense')
    .reduce((sum, t) => sum + t.amount, 0);
}

// 计算日均支出
async function calcDailyAvg(year, month) {
  const total = await calcMonthExpense(year, month);
  const days = new Date(year, month, 0).getDate();
  return total / Math.max(1, Math.min(new Date().getDate(), days));
}

// 分类统计（本月）
async function calcCategoryStats(year, month) {
  const txs = await getMonthTransactions(year, month);
  const expenses = txs.filter(t => t.type === 'expense');
  const map = {};
  for (const t of expenses) {
    map[t.category] = (map[t.category] || 0) + t.amount;
  }
  return Object.entries(map)
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);
}

// 每日趋势统计
async function calcDailyTrend(days = 30) {
  const today = new Date();
  const map = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    map[dateStr(d)] = 0;
  }
  const startDate = dateStr(new Date(today - (days - 1) * 86400000));
  const txs = await db.transactions
    .where('date').between(startDate, todayStr(), true, true)
    .toArray();
  for (const t of txs) {
    if (t.type === 'expense' && map[t.date] !== undefined) {
      map[t.date] += t.amount;
    }
  }
  return Object.entries(map).map(([date, amount]) => ({
    date: date.slice(5), // MM-DD
    amount: Math.round(amount * 100) / 100
  }));
}

// 渲染饼图
async function renderPieChart() {
  const now = new Date();
  const stats = await calcCategoryStats(now.getFullYear(), now.getMonth() + 1);
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
async function renderLineChart() {
  const trend = await calcDailyTrend(30);
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
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          ticks: { color: '#556', font: { size: 10 }, maxTicksLimit: 8 },
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
  const now = new Date();
  const weekTotal = await calcWeekExpense();
  const monthTotal = await calcMonthExpense(now.getFullYear(), now.getMonth() + 1);
  const dailyAvg = await calcDailyAvg(now.getFullYear(), now.getMonth() + 1);

  document.getElementById('stat-week').textContent = '¥' + weekTotal.toFixed(2);
  document.getElementById('stat-month').textContent = '¥' + monthTotal.toFixed(2);
  document.getElementById('stat-daily-avg').textContent = '¥' + dailyAvg.toFixed(2);

  await renderPieChart();
  await renderLineChart();
}
