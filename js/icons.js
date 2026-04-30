// 分类图标映射 (icons.js)
window.ICONS = {
  expense: {
    '餐饮': '🍜', '交通': '🚗', '购物': '🛒', '娱乐': '🎮',
    '住房': '🏠', '医疗': '💊', '教育': '📚', '其他': '📌'
  },
  income: {
    '工资': '💰', '奖金': '🎁', '红包': '🧧', '退款': '↩️',
    '报销': '📋', '兼职': '💼', '理财': '📈', '其他收入': '💵'
  }
};

// 获取分类图标
function getIcon(category, type) {
  if (type === 'income') return ICONS.income[category] || '💵';
  return ICONS.expense[category] || '📌';
}

// 获取所有预设分类
function getDefaultCategories(type) {
  const cats = type === 'income' ? ICONS.income : ICONS.expense;
  return Object.entries(cats).map(([name, icon]) => ({ name, icon, type }));
}
