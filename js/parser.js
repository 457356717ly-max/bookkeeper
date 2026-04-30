// 自然语言解析引擎 (parser.js)
// 规则引擎：80% 覆盖率 | 兜底：DeepSeek API

const PARSE_RULES = {
  // 收入关键词
  incomeKw: ['工资', '奖金', '红包', '退款', '报销', '兼职', '理财', '利息', '收租', '稿费', '补贴', '提成', '分红'],
  // 分类关键词 ← → 分类名
  categories: [
    { name: '餐饮', kw: ['饭', '餐', '吃', '食', '面', '米', '菜', '鸡', '鱼', '肉', '虾', '蛋', '奶', '包', '饼', '粉', '串', '锅', '煲', '汤', '饺', '馄饨', '麻辣烫', '烧烤', '火锅', '粥', '早餐', '午餐', '晚饭', '宵夜', '外卖', '肯德基', '麦当劳', '奶茶', '咖啡', '饮料', '水果', '零食', '面包', '蛋糕', '西瓜', '香蕉', '苹果'] },
    { name: '交通', kw: ['打车', '滴滴', '出租', '公交', '地铁', '高铁', '火车', '机票', '加油', '停车', '违章', '共享单车', '骑行', '哈罗', '青桔', '摩拜', '顺风车', '大巴', '过路费', 'etc', '油'] },
    { name: '购物', kw: ['超市', '买菜', '淘宝', '京东', '拼多多', '衣服', '裤子', '鞋子', '鞋', '日用品', '化妆品', '数码', '手机', '电脑', '快递', '网购', '商场', '便利店', '名创', '优衣库', '无印', '宜家', '屈臣氏', '袜子', '帽子', '包', '护肤', '洗面奶', '沐浴露', '牙膏', '洗发', '纸巾'] },
    { name: '娱乐', kw: ['电影', 'ktv', '游戏', '旅游', '门票', '剧本杀', '麻将', '演出', '演唱会', '健身', '游泳', '按摩', 'spa', '足疗', '滑雪', '蹦迪', '酒吧', '密室', '桌游', '卡丁车', '迪士尼', '环球', '景区', '景点', '乐园'] },
    { name: '住房', kw: ['房租', '水电', '物业', '网费', '话费', '煤气', '天然气', '维修', '电费', '水费', '燃气', '宽带', '暖气', '保洁', '钟点工', '搬家'] },
    { name: '医疗', kw: ['医院', '药', '挂号', '体检', '牙科', '打针', '门诊', '住院', '手术', '检查', '疫苗', '口罩', '酒精', '创可贴'] },
    { name: '教育', kw: ['学费', '书', '课', '培训', '考试', '文具', '网课', '课程', '考研', '考公', '雅思', '托福'] },
    { name: '其他', kw: ['转账', '红包', '捐款', '罚款', '快递费', '快递', '邮寄', '顺丰', '中通', '圆通', '韵达', '申通', '宠物', '猫粮', '狗粮', '花', '礼物'] }
  ]
};

// 日期识别
function parseDate(text) {
  const today = new Date();
  // 今天
  if (/今天|今日/.test(text)) return { date: dateStr(today), text: text.replace(/今天|今日/g, '').trim() };
  // 现在
  if (/现在|刚/.test(text)) return { date: dateStr(today), text };
  // 昨天
  if (/昨天|昨日/.test(text)) return { date: dateStr(new Date(today - 86400000)), text: text.replace(/昨天|昨日/g, '').trim() };
  // 前天
  if (/前天/.test(text)) return { date: dateStr(new Date(today - 172800000)), text: text.replace(/前天/g, '').trim() };
  // N天前
  const daysAgo = text.match(/(\d+)天前/);
  if (daysAgo) {
    const d = new Date(today - parseInt(daysAgo[1]) * 86400000);
    return { date: dateStr(d), text: text.replace(daysAgo[0], '').trim() };
  }
  // MM-DD 或 MM月DD日 或 M月D日
  const mmdd1 = text.match(/(\d{1,2})月(\d{1,2})[日号]/);
  if (mmdd1) {
    const m = parseInt(mmdd1[1]), d = parseInt(mmdd1[2]);
    const y = (m > today.getMonth() + 1) ? today.getFullYear() - 1 : today.getFullYear();
    return { date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, text: text.replace(mmdd1[0], '').trim() };
  }
  const mmdd2 = text.match(/(\d{1,2})-(\d{1,2})/);
  if (mmdd2) {
    const m = parseInt(mmdd2[1]), d = parseInt(mmdd2[2]);
    const y = (m > today.getMonth() + 1) ? today.getFullYear() - 1 : today.getFullYear();
    return { date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, text: text.replace(mmdd2[0], '').trim() };
  }
  return { date: todayStr(), text };
}

// 检测是否为收入
function isIncome(text) {
  if (/^\+/.test(text)) return true;
  for (const kw of PARSE_RULES.incomeKw) {
    if (text.includes(kw)) return true;
  }
  return false;
}

// 提取金额
function extractAmount(text) {
  // 支持: 35, 35.5, 35.50, 35元, 35块, ¥35, $35
  const match = text.match(/[-+]?\d+(\.\d{1,2})?/);
  if (!match) return null;
  const amount = Math.abs(parseFloat(match[0]));
  if (amount === 0 || amount > 99999999) return null;
  return { amount, raw: match[0], index: match.index };
}

// 匹配分类
function matchCategory(text) {
  let bestCat = null;
  let bestLen = 0;
  for (const cat of PARSE_RULES.categories) {
    for (const kw of cat.kw) {
      if (text.includes(kw) && kw.length > bestLen) {
        bestCat = cat.name;
        bestLen = kw.length;
      }
    }
  }
  return bestCat;
}

// 主解析函数
function parse(input) {
  if (!input || !input.trim()) return null;

  let text = input.trim();

  // 1. 检测类型
  const type = isIncome(text) ? 'income' : 'expense';
  // 去掉 + 前缀
  if (type === 'income') text = text.replace(/^\+/, '').trim();

  // 2. 解析日期
  const dateResult = parseDate(text);
  text = dateResult.text;

  // 3. 提取金额
  const amountResult = extractAmount(text);
  if (!amountResult) return null; // 没找到金额，交 AI 兜底

  // 4. 分类匹配
  let category = matchCategory(text);
  if (!category) {
    category = type === 'income' ? '其他收入' : '其他';
  }

  // 5. 提取备注（去掉金额和常见后缀剩下的文本）
  let note = text.replace(/¥|＄|\$|元|块|块钱/g, '').replace(amountResult.raw, '').trim();
  // 清理多余空格
  note = note.replace(/\s+/g, ' ').trim();
  // 去掉头部和尾部的标点
  note = note.replace(/^[,，。.、\s]+/, '').replace(/[,，。.、\s]+$/, '');

  return {
    type,
    amount: amountResult.amount,
    category,
    note: note || '',
    date: dateResult.date,
    confidence: note.length > 0 ? 0.9 : 0.7
  };
}

// AI 兜底（DeepSeek）
async function parseWithAI(text) {
  const DEEPSEEK_KEY = window.DEEPSEEK_API_KEY;
  if (!DEEPSEEK_KEY) return null;

  try {
    const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{
          role: 'system',
          content: `你是一个记账解析助手。将用户的中文记账文本解析为 JSON。
类型必须是 "expense" 或 "income"。
分类从以下选：餐饮、交通、购物、娱乐、住房、医疗、教育、其他（支出）；工资、奖金、红包、退款、报销、兼职、理财、其他收入（收入）。
日期格式 YYYY-MM-DD，没提到就是今天。
如果没有明确金额，amount 为 null。
只返回 JSON，不要其他文字。
示例输入："昨天和同事AA聚餐我付了256" → {"type":"expense","amount":256,"category":"餐饮","note":"AA聚餐","date":"<昨天>"}`
        }, { role: 'user', content: text }],
        temperature: 0,
        max_tokens: 200
      })
    });
    const data = await resp.json();
    const content = data.choices[0].message.content;
    // 尝试提取 JSON
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const result = JSON.parse(match[0]);
    if (!result.type || !result.amount) return null;
    // 标准化日期
    if (!result.date) {
      result.date = todayStr();
    } else if (result.date === '<昨天>') {
      const d = new Date(Date.now() - 86400000);
      result.date = dateStr(d);
    }
    return { ...result, confidence: 0.6 };
  } catch (e) {
    console.error('AI parse error:', e);
    return null;
  }
}

// 统一解析入口
async function smartParse(text) {
  // 先试规则引擎
  const result = parse(text);
  if (result && result.confidence >= 0.7) return result;
  // 规则引擎没匹配到 → AI 兜底
  const aiResult = await parseWithAI(text);
  if (aiResult) return aiResult;
  // AI 也失败 → 返回规则结果或 null
  return result;
}
