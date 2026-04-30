// 数据库层 (db.js)
// 依赖: Dexie.js (CDN)

const db = new Dexie('BookkeeperDB');

db.version(1).stores({
  transactions: '++id, type, category, date, createdAt',
  categories: '++id, name, type'
});

// 初始化预设分类
db.on('populate', async () => {
  const expenseCats = getDefaultCategories('expense');
  const incomeCats = getDefaultCategories('income');
  await db.categories.bulkAdd([...expenseCats, ...incomeCats]);
});

// 确保分类存在（非首次打开）
async function ensureCategories() {
  const count = await db.categories.count();
  if (count === 0) {
    const expenseCats = getDefaultCategories('expense');
    const incomeCats = getDefaultCategories('income');
    await db.categories.bulkAdd([...expenseCats, ...incomeCats]);
  }
}

// --- 交易 CRUD ---

async function addTransaction(tx) {
  const id = await db.transactions.add({
    type: tx.type,
    amount: tx.amount,
    category: tx.category,
    note: tx.note || '',
    date: tx.date || todayStr(),
    createdAt: new Date()
  });
  debounceBackup();
  return id;
}

async function deleteTransaction(id) {
  await db.transactions.delete(id);
  debounceBackup();
}

async function updateTransaction(id, updates) {
  await db.transactions.update(id, updates);
  debounceBackup();
}

// 获取今日流水
async function getTodayTransactions() {
  const today = todayStr();
  return db.transactions
    .where('date').equals(today)
    .reverse()
    .sortBy('createdAt');
}

// 获取最近流水（排除今天，最近30条）
async function getRecentTransactions() {
  const today = todayStr();
  return db.transactions
    .where('date').below(today)
    .reverse()
    .sortBy('date');
}

// 获取某月交易
async function getMonthTransactions(year, month) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const end = month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  return db.transactions
    .where('date').between(start, end, false, true)
    .toArray();
}

// 获取本周交易
async function getWeekTransactions() {
  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? 6 : day - 1; // 周一开始
  const monday = new Date(now);
  monday.setDate(now.getDate() - mondayOffset);
  return db.transactions
    .where('date').between(dateStr(monday), todayStr(), true, true)
    .toArray();
}

// 获取所有交易（供导出）
async function getAllTransactions() {
  return db.transactions.orderBy('date').reverse().toArray();
}

// --- 分类 CRUD ---

async function getCategories(type) {
  if (!type) return db.categories.toArray();
  return db.categories.where('type').equals(type).toArray();
}

async function addCategory(name, icon, type) {
  const exists = await db.categories.where({ name, type }).first();
  if (exists) return null;
  const id = await db.categories.add({ name, icon: icon || '📌', type });
  debounceBackup();
  return id;
}

async function deleteCategory(name, type) {
  await db.categories.where({ name, type }).delete();
  debounceBackup();
}

// --- 工具 ---

function todayStr() {
  return dateStr(new Date());
}

function dateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// --- 数据备份/恢复 ---
const BACKUP_KEY = 'bookkeeper_backup';

let backupTimer = null;
function debounceBackup() {
  clearTimeout(backupTimer);
  backupTimer = setTimeout(autoBackup, 2000);
}

async function autoBackup() {
  try {
    const txs = await db.transactions.toArray();
    const cats = await db.categories.toArray();
    const data = { txs, cats, time: Date.now() };
    localStorage.setItem(BACKUP_KEY, JSON.stringify(data));
  } catch(e) {}
}

async function autoRestore() {
  try {
    const count = await db.transactions.count();
    if (count > 0) return false; // 有数据，不恢复

    const raw = localStorage.getItem(BACKUP_KEY);
    if (!raw) return false;

    const data = JSON.parse(raw);
    if (!data.txs || data.txs.length === 0) return false;

    if (!confirm(`检测到备份数据（${data.txs.length} 条记录，${new Date(data.time).toLocaleString('zh-CN')}），是否恢复？`)) return false;

    await db.transactions.bulkAdd(data.txs);
    if (data.cats) {
      await db.categories.clear();
      await db.categories.bulkAdd(data.cats);
    }
    return true;
  } catch(e) {
    return false;
  }
}

function getBackupInfo() {
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return {
      count: data.txs.length,
      time: new Date(data.time)
    };
  } catch(e) {
    return null;
  }
}

// 初始化
async function initDB() {
  await db.open();
  await ensureCategories();
  await autoRestore();
}
