// 主应用逻辑 (app.js)
// 依赖: db.js, parser.js, stats.js, icons.js

// 等待 Dexie 就绪（CDN 慢加载兜底）
function waitForDB(timeout = 10000) {
  return new Promise((resolve, reject) => {
    if (typeof Dexie !== 'undefined') { resolve(); return; }
    let elapsed = 0;
    const check = setInterval(() => {
      elapsed += 200;
      if (typeof Dexie !== 'undefined') { clearInterval(check); resolve(); return; }
      if (elapsed >= timeout) { clearInterval(check); reject(new Error('Dexie load timeout')); }
    }, 200);
  });
}

async function boot() {
  try {
    await waitForDB();
    await db.open();
    await ensureCategories();
    await initYearSelector(); // 预加载年份列表
  } catch (e) {
    console.error('Boot error:', e);
  }
  initApp();
}

// DOM 就绪后启动
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

function initApp() {
  // === Tab 切换 ===
  const navBtns = document.querySelectorAll('.nav-btn');
  const tabPages = document.querySelectorAll('.tab-page');
  const headerTitle = document.getElementById('header-title');

  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      navBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      tabPages.forEach(p => p.classList.remove('active'));
      document.getElementById('tab-' + tab).classList.add('active');

      const titles = { record: '记账', stats: '统计', settings: '设置' };
      headerTitle.textContent = titles[tab] || '记账';

      if (tab === 'stats') refreshStats();
      if (tab === 'settings') refreshSettings();
    });
  });

  // === 自然语言输入 ===
  const input = document.getElementById('record-input');
  const submitBtn = document.getElementById('record-submit');
  const preview = document.getElementById('parse-preview');

  async function handleInput() {
    const text = input.value.trim();
    if (!text) return;

    const result = await smartParse(text);
    if (!result) {
      showToast('没识别出金额，试试「午饭35」这样的格式');
      return;
    }
    showPreview(result);
    input.value = '';
  }

  submitBtn.addEventListener('click', handleInput);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleInput();
    }
  });

  // === 语音录入 ===
  const voiceBtn = document.getElementById('voice-btn');
  let recognition = null;

  function initSpeech() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      voiceBtn.style.display = 'none';
      return;
    }
    recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let final = '';
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) {
          final += r[0].transcript;
        } else {
          interim += r[0].transcript;
        }
      }
      // 展示识别文字（优先展示最终结果）
      const text = final || interim;
      if (text) {
        input.value = text;
        input.focus();
      }
      // 有最终结果 → 自动提交
      if (final) {
        stopListening();
        setTimeout(() => handleInput(), 300);
      }
    };

    recognition.onerror = (event) => {
      stopListening();
      if (event.error === 'not-allowed') {
        showToast('请允许麦克风权限');
      } else if (event.error !== 'no-speech') {
        showToast('语音识别出错，请重试');
      }
    };

    recognition.onend = () => {
      // 如果没有最终结果且仍在 listening 状态，说明是意外结束
      if (voiceBtn.classList.contains('listening')) {
        stopListening();
      }
    };
  }

  function startListening() {
    if (!recognition) {
      showToast('浏览器不支持语音录入');
      return;
    }
    try {
      voiceBtn.classList.add('listening');
      voiceBtn.textContent = '🔴';
      input.placeholder = '正在听…';
      input.value = '';
      recognition.start();
    } catch (e) {
      stopListening();
    }
  }

  function stopListening() {
    voiceBtn.classList.remove('listening');
    voiceBtn.textContent = '🎤';
    input.placeholder = '记一笔… 如「午饭35 打车20」';
    try { recognition.stop(); } catch(e) {}
  }

  voiceBtn.addEventListener('click', () => {
    if (voiceBtn.classList.contains('listening')) {
      stopListening();
    } else {
      startListening();
    }
  });

  initSpeech();

  // === 解析预览 ===
  let pendingTx = null;

  function showPreview(result) {
    pendingTx = result;
    const icon = getIcon(result.category, result.type);
    const sign = result.type === 'income' ? '+' : '-';
    const cls = result.type === 'income' ? 'income-color' : 'expense-color';

    document.getElementById('preview-category').textContent = icon + ' ' + result.category;
    document.getElementById('preview-amount').textContent = sign + '¥' + result.amount.toFixed(2);
    document.getElementById('preview-amount').className = cls;
    document.getElementById('preview-note').textContent = result.note || '';
    document.getElementById('preview-date').textContent = result.date;

    preview.classList.remove('hidden');
    preview.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  document.getElementById('preview-confirm').addEventListener('click', async () => {
    if (!pendingTx) return;
    await addTransaction(pendingTx);
    pendingTx = null;
    preview.classList.add('hidden');
    await refreshRecordList();
    showToast('已记账 ✓');
  });

  document.getElementById('preview-cancel').addEventListener('click', () => {
    pendingTx = null;
    preview.classList.add('hidden');
  });

  // === 快速记账 ===
  let quickCat = null;

  async function loadQuickCats() {
    const cats = await getCategories('expense');
    const container = document.getElementById('quick-cats');
    container.innerHTML = cats.map(c =>
      `<span class="quick-cat" data-cat="${c.name}">${c.icon} ${c.name}</span>`
    ).join('');

    container.querySelectorAll('.quick-cat').forEach(el => {
      el.addEventListener('click', () => {
        container.querySelectorAll('.quick-cat').forEach(e => e.classList.remove('selected'));
        el.classList.add('selected');
        quickCat = el.dataset.cat;
      });
    });
  }

  document.getElementById('quick-record-btn').addEventListener('click', async () => {
    const amountStr = document.getElementById('quick-amount').value.trim();
    if (!amountStr) { showToast('请输入金额'); return; }
    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) { showToast('金额不对'); return; }
    if (!quickCat) { showToast('请选一个分类'); return; }

    await addTransaction({
      type: 'expense',
      amount,
      category: quickCat,
      note: '',
      date: todayStr()
    });
    document.getElementById('quick-amount').value = '';
    quickCat = null;
    document.querySelectorAll('.quick-cat').forEach(e => e.classList.remove('selected'));
    await refreshRecordList();
    showToast('已记账 ✓');
  });

  // === 流水列表 ===
  async function refreshRecordList() {
    const todayTxs = await getTodayTransactions();
    const recentTxs = await getRecentTransactions();

    const renderTx = tx => {
      const icon = getIcon(tx.category, tx.type);
      const sign = tx.type === 'income' ? '+' : '-';
      const cls = tx.type === 'income' ? 'income' : 'expense';
      return `
        <div class="tx-item" data-id="${tx.id}">
          <div class="tx-left">
            <span class="tx-icon">${icon}</span>
            <div class="tx-info">
              <span class="tx-cat">${tx.category}</span>
              ${tx.note ? `<span class="tx-note">${tx.note}</span>` : ''}
            </div>
          </div>
          <div class="tx-right">
            <span class="tx-amount ${cls}">${sign}¥${tx.amount.toFixed(2)}</span>
            <div class="tx-date">${tx.date}</div>
          </div>
        </div>`;
    };

    document.getElementById('today-list').innerHTML = todayTxs.length
      ? todayTxs.slice(0, 20).map(renderTx).join('')
      : '<div style="color:var(--text-dim);font-size:13px;padding:12px 0;">今天还没有记账</div>';

    document.getElementById('recent-list').innerHTML = recentTxs.length
      ? recentTxs.slice(0, 20).map(renderTx).join('')
      : '<div style="color:var(--text-dim);font-size:13px;padding:12px 0;">暂无记录</div>';

    // 左滑删除
    setupSwipeDelete();
  }

  function setupSwipeDelete() {
    document.querySelectorAll('.tx-item').forEach(item => {
      let startX = 0;
      item.addEventListener('touchstart', e => { startX = e.touches[0].clientX; });
      item.addEventListener('touchend', async e => {
        const diff = startX - e.changedTouches[0].clientX;
        if (diff > 80) {
          const id = parseInt(item.dataset.id);
          if (confirm('删除这条记录？')) {
            await deleteTransaction(id);
            await refreshRecordList();
            showToast('已删除');
          }
        }
      });
    });
  }

  // === 设置页 ===
  async function refreshSettings() {
    const expenseCats = await getCategories('expense');
    const catList = document.getElementById('cat-list-expense');
    catList.innerHTML = expenseCats.map(c =>
      `<span class="cat-tag">${renderIcon(c.icon)} ${c.name} <span class="cat-del" data-name="${c.name}">×</span></span>`
    ).join('');

    catList.querySelectorAll('.cat-del').forEach(el => {
      el.addEventListener('click', async e => {
        e.stopPropagation();
        const name = el.dataset.name;
        await deleteCategory(name, 'expense');
        await refreshSettings();
        await loadQuickCats();
      });
    });
  }

  // === 图标选择器 ===
  const iconPicker = document.getElementById('icon-picker');
  const iconBtn = document.getElementById('new-cat-icon-btn');
  const iconGrid = document.getElementById('icon-picker-grid');
  let selectedIcon = '📌';

  // 预设图标库
  const PRESET_ICONS = [
    '🍜','🍕','🍔','🌮','🍱','🥗','☕','🍺','🍩','🍰','🍉','🍎',
    '🚗','🚌','🚇','✈️','🚲','🛵','🚕','⛽','🚄','🚢',
    '🛒','👗','👟','💄','📱','💻','🎁','👜','⌚','💍',
    '🎮','🎬','🎵','🎸','⚽','🏀','🎤','🎯','🎲','🎪',
    '🏠','💡','💧','🔧','📺','🛋️','🛁','🔑','🪴',
    '💊','🏥','💉','🩺','🩹','🦷','👓','🌡️',
    '📚','✏️','🎓','📝','💼','📐','🔬','🎨',
    '💰','💵','💳','💎','🏦','📊','💸',
    '🐱','🐶','🌸','⭐','❤️','🔥','🎉','📌'
  ];

  function renderIconGrid() {
    iconGrid.innerHTML = PRESET_ICONS.map(icon =>
      `<div class="icon-option" data-icon="${icon}">${icon}</div>`
    ).join('');
    iconGrid.querySelectorAll('.icon-option').forEach(el => {
      el.addEventListener('click', () => {
        selectedIcon = el.dataset.icon;
        iconBtn.innerHTML = selectedIcon;
        iconPicker.classList.add('hidden');
      });
    });
  }

  // 打开图标选择器
  iconBtn.addEventListener('click', () => {
    iconPicker.classList.remove('hidden');
    renderIconGrid();
  });

  // 关闭
  document.getElementById('icon-picker-close').addEventListener('click', () => {
    iconPicker.classList.add('hidden');
  });
  iconPicker.addEventListener('click', e => {
    if (e.target === iconPicker) iconPicker.classList.add('hidden');
  });

  // 上传图片
  document.getElementById('icon-upload-btn').addEventListener('click', () => {
    document.getElementById('icon-upload-file').click();
  });

  document.getElementById('icon-upload-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 500 * 1024) { showToast('图片不能超过500KB'); return; }
    try {
      const base64 = await fileToBase64(file);
      selectedIcon = base64;
      iconBtn.innerHTML = `<img src="${base64}" alt="icon">`;
      iconPicker.classList.add('hidden');
    } catch(err) {
      showToast('图片读取失败');
    }
    e.target.value = '';
  });

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // 渲染图标（emoji 或 base64 图片）
  function renderIcon(icon) {
    if (!icon) return '📌';
    if (icon.startsWith('data:image')) {
      return `<img src="${icon}" alt="" style="width:20px;height:20px;border-radius:4px;object-fit:cover;vertical-align:middle;">`;
    }
    return icon;
  }

  document.getElementById('add-cat-btn').addEventListener('click', async () => {
    const name = document.getElementById('new-cat-name').value.trim();
    if (!name) { showToast('请输入分类名'); return; }
    const result = await addCategory(name, selectedIcon, 'expense');
    if (result === null) { showToast('分类已存在'); return; }
    document.getElementById('new-cat-name').value = '';
    selectedIcon = '📌';
    iconBtn.innerHTML = '📌';
    await refreshSettings();
    await loadQuickCats();
    showToast('已添加');
  });

  // === 导出 CSV ===
  document.getElementById('export-csv').addEventListener('click', async () => {
    const txs = await getAllTransactions();
    if (txs.length === 0) { showToast('没有数据'); return; }
    const header = '日期,类型,分类,金额,备注\n';
    const rows = txs.map(t =>
      `${t.date},${t.type === 'income' ? '收入' : '支出'},${t.category},${t.amount},${t.note || ''}`
    ).join('\n');
    downloadFile('记账数据.csv', '\uFEFF' + header + rows, 'text/csv;charset=utf-8');
    showToast('CSV 已导出');
  });

  // === 导出/导入 JSON ===
  document.getElementById('export-json').addEventListener('click', async () => {
    const txs = await getAllTransactions();
    const cats = await getCategories();
    const data = { version: 1, exportedAt: new Date().toISOString(), transactions: txs, categories: cats };
    downloadFile('记账备份.json', JSON.stringify(data, null, 2), 'application/json');
    showToast('JSON 备份已导出');
  });

  document.getElementById('import-json').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });

  document.getElementById('import-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.transactions || !Array.isArray(data.transactions)) {
        showToast('备份文件格式不对');
        return;
      }
      if (!confirm(`将导入 ${data.transactions.length} 条记录，这会清空现有数据。确定？`)) return;
      await db.transactions.clear();
      await db.categories.clear();
      if (data.categories) await db.categories.bulkAdd(data.categories);
      await db.transactions.bulkAdd(data.transactions.map(t => {
        const { id, ...rest } = t;
        return { ...rest, createdAt: rest.createdAt ? new Date(rest.createdAt) : new Date() };
      }));
      await refreshRecordList();
      await refreshSettings();
      await loadQuickCats();
      showToast(`已恢复 ${data.transactions.length} 条记录`);
    } catch (err) {
      showToast('导入失败: ' + err.message);
    }
    e.target.value = '';
  });

  // === PWA 安装 ===
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    // 延迟 3 秒后显示安装提示
    setTimeout(() => {
      if (deferredPrompt && !window.matchMedia('(display-mode: standalone)').matches) {
        if (confirm('添加到手机桌面，使用更方便。是否安装？')) {
          deferredPrompt.prompt();
          deferredPrompt.userChoice.then(() => { deferredPrompt = null; });
        }
      }
    }, 3000);
  });

  // === Toast ===
  window.showToast = function(msg) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  };

  // === 工具 ===
  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // === 初始加载 ===
  loadQuickCats();
  refreshRecordList();

  // 让输入框自动聚焦
  setTimeout(() => document.getElementById('record-input').focus(), 500);
}
