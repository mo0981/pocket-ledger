/* 中英双语。
   ------------------------------------------------------------------
   设计取舍：词典用「中文原文」当键，英文当值。
   · 中文模式完全不查表，直接原样输出，改动前的中文文案一个字节都不变；
   · 英文模式漏词条时回落到中文，不会出现 key 名或空白；
   · 界面上绝大多数文案都由渲染函数拼成 HTML，与其在几十处调用点包一层，
     不如在 DOM 上做一次翻译：MutationObserver 盯住新增/变化的文本节点，
     命中词典就替换。这样 toast、弹层、AI 返回的错误串也一并覆盖。
   · 带数字的句子（「12 笔」「已用 34%」）用 PATS 里的正则兜住，
     避免为每一种数字组合单开词条。
   需要在 JS 里提前得到字符串的地方（confirm、document.title）直接用 t()。
   ------------------------------------------------------------------ */

const KEY = 'pl-lang';
export const LANGS = ['auto', 'zh', 'en'];

/* 系统语言 → 界面语言：中文（含繁体各区）走中文，其余一律英文 */
export function detectLang() {
  const list = (navigator.languages && navigator.languages.length)
    ? navigator.languages
    : [navigator.language || ''];
  for (const l of list) {
    const s = String(l || '').toLowerCase();
    if (s.startsWith('zh')) return 'zh';
    if (s) return 'en';
  }
  return 'zh';
}

let pref = 'auto';
let cur = 'zh';

export function langPref() { return pref; }
export function lang() { return cur; }
export function isEN() { return cur === 'en'; }

export function initLang(saved) {
  let p = saved || 'auto';
  if (!LANGS.includes(p)) p = 'auto';
  pref = p;
  cur = p === 'auto' ? detectLang() : p;
  try { localStorage.setItem(KEY, p); } catch (e) { /* 隐私模式 */ }
  document.documentElement.lang = cur === 'zh' ? 'zh-CN' : 'en';
  document.documentElement.dataset.lang = cur;
  return cur;
}

export function setLang(p) {
  const before = cur;
  initLang(p);
  if (cur !== before) refresh();
  return cur;
}

/* 快速拿语言偏好：boot 时先用它垫上，避免闪一下中文再变英文 */
export function cachedLangPref() {
  try {
    const v = localStorage.getItem(KEY);
    return LANGS.includes(v) ? v : 'auto';
  } catch (e) { return 'auto'; }
}

/* ---------------- 词典 ---------------- */

const EN = {
  /* 底栏 / 页面标题 */
  '记账': 'Record',
  '流水': 'Ledger',
  '统计': 'Stats',
  '设置': 'Settings',
  '本月支出': 'Spent this month',
  '收入': 'In',
  '支出': 'Out',
  '结余': 'Left',
  '转账': 'Transfer',
  '笔': 'entries',
  '最近流水': 'Recent',
  '全部': 'All',
  '全部记录': 'All records',
  '本月': 'this month',
  '（本月）': ' (this month)',
  '说一句，或拍张账单截图': 'Say it, or snap a receipt',
  '发送': 'Send',
  '解析中': 'Reading',
  '搜索分类或备注': 'Search category or note',
  '上传账单图片': 'Upload a receipt',
  '语音输入': 'Voice input',
  '手动记一笔': 'Add an entry',
  '关闭': 'Close',
  '可选': 'optional',
  '分类': 'Category',
  '账户': 'Account',
  '转出账户': 'From',
  '转入账户': 'To',
  '日期': 'Date',
  '备注': 'Note',
  '删除': 'Delete',
  '保存': 'Save',
  '取消': 'Cancel',
  '修改中': 'Saving',
  '保存中': 'Saving',

  /* 统计页 */
  '支出构成': 'Where it went',
  '预算执行': 'Budget',
  'AI 洞察': 'AI insights',
  '生成': 'Generate',
  '生成中': 'Thinking',
  '固定扣款': 'Recurring',
  '近 12 个月': 'Last 12 months',
  '按住左右滑': 'drag sideways',
  '点扇区或图例，展开这个分类的明细': 'Tap a slice or legend to open the details',
  '按住图表左右滑动，看更早的月份': 'Hold and drag to see earlier months',
  '这个月还没有支出': 'Nothing spent this month',
  '还没有数据': 'No data yet',
  '暂无支出': 'No spending',
  '当前月份': 'current month',
  '看这个月 →': 'View this month →',
  '点右上角「生成」，让 AI 读一遍这个月的账，说几句人话。一次大约几分钱。':
    'Hit Generate in the corner and let AI read this month for you. Costs a fraction of a cent.',
  '点右上角可重新生成': 'tap the corner to regenerate',
  '还没发现规律扣款。同名项目连续记满 3 个月（房租、会员、话费）就会自动出现在这里。':
    'No recurring charges spotted yet. Log the same item 3 months in a row (rent, memberships, phone) and it shows up here.',
  '每月固定支出约': 'Fixed monthly spend around',
  '一年': 'a year',
  '在流水里查看这个分类 ›': 'See this category in Ledger ›',
  '收起明细': 'Collapse',
  '点扇区或图例，展开这个分类的明细。': 'Tap a slice or legend to open the details.',

  /* 预算 */
  '设个本月预算': 'Set a monthly budget',
  '快超支时首页会直接提醒': 'Home warns you before you overspend',
  '去设置 →': 'Go to Settings →',
  '本月预算': 'Monthly budget',
  '总预算': 'Overall',
  '超支': 'over',
  '还剩': 'left',
  '已用': 'used',
  '日均可用': 'per day left',
  '超': 'over',
  '还没设预算': 'No budget yet',
  '去设置里填一个，这里就能看执行情况': 'Fill one in Settings and progress shows up here',
  '不限': 'no limit',
  '留空 = 不限制': 'blank = no limit',
  '分类预算': 'Category budgets',
  '每月总预算': 'Monthly total',
  '预算': 'Budget',
  '预算只做提醒，不影响记账。': 'Budgets are just a nudge, they never block an entry.',

  /* 流水页 */
  '搜索分类或备注': 'Search category or note',
  '没找到': 'Nothing found',
  '换个关键词试试': 'Try another keyword',
  '没有记录': 'No entries',
  '点上面的「全部」看所有流水': 'Tap All above to see everything',
  '还没有流水': 'No entries yet',
  '从记账页开始记第一笔': 'Start your first entry on the Record tab',

  /* 设置页 */
  '外观': 'Appearance',
  '主题': 'Theme',
  '语言': 'Language',
  '显示语言': 'Display language',
  '跟随系统': 'Follow system',
  '中文': '中文',
  '英文': 'English',
  '换肤只换皮，账目数据不动。选定后下次打开还是这款。':
    'Skins are cosmetic only — your data stays put. Your pick is remembered next launch.',
  '装成 App 后，桌面图标会跟着一起换。': ' In the app, the launcher icon follows the skin too.',
  '主币种': 'Currency',
  '首页和统计页的合计只算这个币种。其他币种的流水照常记录、照常显示自己的符号，但不会和主币种相加 —— 不同币种直接加在一起没有意义。小账本不做汇率换算，所以如果你的日常开销主要花美元，把这里换成美元即可。':
    'Only this currency feeds the totals on Home and Stats. Other currencies are still recorded and shown with their own symbol, but never added in — adding currencies up is meaningless. There is no FX conversion here, so if you mostly spend USD, switch this to USD.',
  '批量改币种': 'Relabel currency',
  '范围': 'Range',
  '改成': 'Change to',
  '同时切过去': 'Switch main too',
  '批量修改': 'Apply',
  '没有可改的记录': 'Nothing to change',
  '无需修改': 'Nothing to change',
  'AI 解析': 'AI parsing',
  '服务商': 'Provider',
  '接口地址': 'Endpoint',
  '模型': 'Model',
  '测试连接': 'Test',
  '测试中': 'Testing',
  '连接正常': 'Connected',
  '连接失败': 'Failed',
  '已配置': 'Configured',
  '未配置': 'Not set',
  '图片记账': 'Receipt photos',
  '识图服务': 'Vision provider',
  '识图模型': 'Vision model',
  '测试识图': 'Test vision',
  '识图正常': 'Vision OK',
  '识图失败': 'Vision failed',
  '数据': 'Data',
  '导出备份': 'Export',
  '导入备份': 'Import',
  '分享备份文件': 'Share backup',
  '数据只存在本机。清理浏览器数据会丢失，建议每周导出一次。':
    'Everything lives on this device. Clearing browser data wipes it — export weekly.',
  '用系统分享面板把刚才的备份文件直接发到 OneDrive、微信收藏等任意应用。网页浏览器不支持分享时会自动改为下载。':
    'Send the backup straight to OneDrive, WeChat or anything else via the system share sheet. Browsers without share support fall back to a download.',
  '每天自动备份（打开 App 时静默上传）': 'Auto-backup daily (silently uploads on launch)',
  '立即备份': 'Back up now',
  '备份中…': 'Backing up…',
  '恢复到本机': 'Restore here',
  '解除连接': 'Disconnect',
  '未连接': 'Not connected',
  '已连接': 'Connected',
  '仅限 App': 'App only',
  '连接 OneDrive': 'Connect OneDrive',
  'OneDrive 云备份': 'OneDrive backup',
  '百度网盘备份': 'Baidu Netdisk backup',
  '百度接口不允许浏览器直连，此功能仅在 App 里可用。':
    'Baidu blocks direct browser access — this works in the app only.',
  '打开授权页': 'Open auth page',
  '用授权码连接': 'Connect with code',
  '授权码': 'Auth code',
  '应用名称': 'App name',
  '点按可删除': 'tap to delete',
  '分类习惯': 'Learned habits',
  'AI 会照着学': 'AI learns from these',
  '你每次改动 AI 给的分类，这里就会多一条「商户 → 分类」。下次识别同样的商户直接套用。':
    'Every time you correct an AI category, a merchant → category rule lands here and gets reused next time.',
  '还没有学习记录，改一次 AI 给的分类就会记下一条':
    'Nothing learned yet — correct an AI category once and a rule appears',
  '新增支出分类': 'New expense category',
  '新增收入分类': 'New income category',

  /* 皮肤名 */
  '标准绿': 'Classic',
  '墨韵': 'Ink',
  '幽光': 'Aurora',
  '纸糖': 'Paper Candy',
  '仪表': 'Terminal',
  '青瓷': 'Celadon',
  '原来的样子': 'the classic look',
  '纸白墨黑': 'paper white, ink black',
  '深色玻璃': 'dark glass',
  '贴纸手账': 'sticker journal',
  '终端数据': 'terminal data',
  '宣纸釉色': 'rice paper glaze',

  /* 币种 */
  '人民币': 'Chinese yuan',
  '美元': 'US dollar',
  '欧元': 'Euro',
  '日元': 'Japanese yen',
  '港币': 'Hong Kong dollar',
  '英镑': 'Pound sterling',
  '韩元': 'Korean won',
  '新加坡元': 'Singapore dollar',
  '澳元': 'Australian dollar',
  '加元': 'Canadian dollar',

  /* 记账面板 */
  '今天': 'Today',
  '昨天': 'Yesterday',
  '本周': 'This week',
  '上周': 'Last week',
  '上月': 'Last month',
  '今年': 'This year',
  '全部流水': 'All entries',

  /* toast / 提示 */
  '金额要大于 0': 'Amount must be above 0',
  '选一个分类': 'Pick a category',
  '转出和转入不能是同一个账户': 'From and To can not be the same account',
  '已更新': 'Updated',
  '已存为 AI 记录': 'Saved from AI',
  '记好了': 'Saved',
  '已保存': 'Saved',
  '已删除': 'Deleted',
  '已移除这一笔': 'Removed',
  '已导出备份': 'Backup exported',
  '已分享': 'Shared',
  '已添加': 'Added',
  '已忘掉这条习惯': 'Rule forgotten',
  '说一句，或点相机上传账单截图': 'Type a line, or tap the camera to upload a receipt',
  '没识别出金额，换个说法试试': 'No amount found — try rephrasing',
  '这张图里没找到账单，换一张更清晰的截图': 'No receipt in this image — try a sharper screenshot',
  '还没配置 API Key，去「设置」里填一下': 'No API key yet — add one in Settings',
  '还没配置识图模型，去「设置 → 图片记账」填一下': 'No vision model yet — set one under Settings → Receipt photos',
  '先去设置里填 API Key': 'Add an API key in Settings first',
  '这个月还没有记录': 'Nothing logged this month yet',
  '生成了': 'Generated',
  '听你说…': 'Listening…',
  '麦克风权限被拒绝': 'Microphone permission denied',
  '语音识别没成功，改用打字吧': 'Speech failed — type it instead',
  '语音启动失败': 'Could not start speech',
  '没有可保存的条目，它们都已经存在了': 'Nothing to save — those entries already exist',
  '文件解析失败，确认是小账本导出的 JSON': 'Could not read that file — is it a Pocket Ledger backup?',
  '这个文件里没有流水数据': 'No entries in this file',
  '云端还没有备份，先点「立即备份」': 'No cloud backup yet — hit Back up now first',
  '恢复失败': 'Restore failed',
  '已解除连接': 'Disconnected',
  '已开启每日自动备份': 'Daily auto-backup on',
  '已关闭自动备份': 'Auto-backup off',
  '在百度授权页登录后，把带回来的 code 粘贴进来': 'Sign in on the Baidu page, then paste the code back here',
  '先粘贴授权码': 'Paste the auth code first',
  '先粘贴 Azure 的应用程序(客户端) ID': 'Paste the Azure application (client) ID first',
  '输入分类名': 'Enter a category name',
  '这个分类已经有了': 'That category already exists',
  '分享失败：': 'Share failed: ',
  '当前环境不支持分享文件，已改为下载': 'Share not supported here — downloaded instead',
  '小账本备份': 'Pocket Ledger backup',
  '修改失败：': 'Update failed: ',
  '换个币种再看': 'Try another currency',
  '这笔账还没记': 'Nothing logged yet',
  '没有支出': 'No spending',
  '在流水里查看这个分类 ›': 'See this category in Ledger ›',
  '主币种已切到': 'Main currency switched to ',
  '合计改按': 'totals now in ',
  '计': '',
  '正在读第': 'Reading',
  '张…': '…',
  '张图 · ': ' photos · ',
  '识别到 ': 'Found ',
  '按小票日期分 ': ', across ',
  ' 天': ' days',
  '已存在': 'exists',
  '其中 ': '',
  ' 笔同日期同金额的流水已经存在，默认不重复保存':
    ' entries with the same date and amount already exist — skipped by default',
  '改为跳过': 'skip them',
  '仍然全部保留': 'keep them all',
  '保存 ': 'Save ',
  ' 笔': ' entries',
  '移除这一笔': 'Remove this entry',
  '账单原图': 'Receipt photo',
  '识别中': 'Reading',
  '识图中': 'Reading',
  '识图 ': 'Reading ',
  '已识别，但有 ': ' found, but ',
  ' 张失败：': ' failed: ',
  '第 ': '#',
  ' 张没找到账单': ' had no receipt',
  ' 张：': ': ',
  '一次最多 ': 'Up to ',
  ' 张，先处理前 ': ' images at a time — handling the first ',
  ' 张': '',

  /* AI 错误 */
  '未知错误': 'Unknown error',
  '请求超时，检查网络': 'Request timed out — check your network',
  '模型返回为空': 'Model returned nothing',
  '还没配置 AI 服务': 'AI is not configured yet',
  '还没配置 AI 服务，请到「设置」里填写接口地址、模型和 API Key':
    'AI is not configured — fill in endpoint, model and API key under Settings',
  'AI 返回的不是合法 JSON，换个说法再试，或手动记录':
    'AI did not return valid JSON — rephrase, or add it manually',
  '还没配置识图模型，请到「设置 → 图片记账」里填写':
    'No vision model — set one under Settings → Receipt photos',
  '图片没解析出结构化数据，换一张更清晰的截图试试':
    'No structured data in that image — try a sharper screenshot',
  '不是图片文件': 'Not an image file',
  '图片读取失败': 'Could not read the image',
  '洞察生成失败，稍后再试': 'Insights failed — try again later',
  '接口地址、模型、Key 都要填': 'Endpoint, model and key are all required',
  '识图模型的地址、模型、Key 都要填。用 DeepSeek 的话模型填 deepseek-flash':
    'Vision endpoint, model and key are all required. On DeepSeek, use deepseek-flash',
  'API Key 无效或已过期': 'API key is invalid or expired',
  '账户余额不足': 'Account balance is too low',
  '图片太大，压缩后再试': 'Image too large — compress it and retry',
  '参数不被接受，检查模型名是否拼错': 'Parameters rejected — check the model name',
  '请求太频繁或额度用尽，稍后再试': 'Rate limited or out of quota — retry later',
  '服务端错误，稍后重试': 'Server error — retry later',
  '解析失败': 'Parsing failed',
  '先填 Client ID': 'Fill in the Client ID first',
  '未连接 OneDrive': 'OneDrive is not connected',
  '登录已过期，请重新连接 OneDrive': 'Session expired — reconnect OneDrive',
  '百度登录已过期，请重新连接': 'Baidu session expired — reconnect',
  '未连接百度网盘': 'Baidu Netdisk is not connected',
  '先填齐 AppKey / SecretKey / 应用名称': 'Fill in AppKey / SecretKey / app name first',
  '百度网盘备份只能在 App 里使用（网页版有跨域限制）':
    'Baidu backup only works in the app (browsers hit a CORS wall)',

  /* 默认分类：库里存的永远是中文，显示时才换英文，所以老数据不受影响 */
  '餐饮': 'Dining',
  '交通': 'Transport',
  '购物': 'Shopping',
  '居住': 'Home',
  '通讯': 'Phone',
  '娱乐': 'Fun',
  '医疗': 'Health',
  '学习': 'Learning',
  '人情': 'Gifts',
  '红包': 'Red packet',
  '其他': 'Other',
  '工资': 'Salary',
  '奖金': 'Bonus',
  '兼职': 'Side gig',
  '投资': 'Investing',

  /* 默认账户 */
  '微信': 'WeChat',
  '支付宝': 'Alipay',
  '银行卡': 'Bank card',
  '现金': 'Cash',

  /* 服务商 */
  '硅基流动': 'SiliconFlow',
  '通义千问': 'Qwen',
  '自定义': 'Custom',
  '自定义（OpenAI 兼容）': 'Custom (OpenAI compatible)',
  'Gemini（需能访问 Google）': 'Gemini (needs Google access)',
  '跟随上方（推荐）': 'Follow above (recommended)',
  '跟随上方': 'Follow above',

  /* 界面零碎 */
  '带小圆点的月份有流水': 'Months with entries are dotted',
  '这块还没记账': 'Nothing logged here yet',
  '还没有记录': 'No entries yet',
  '说一句话或点右下角 ＋ 开始': 'Say a line, or tap + in the corner to start',
  '默认跟随系统：手机是中文就显示中文，其它语言一律英文。手动选过之后就一直按你选的来，不再跟系统走。':
    'Follows the system by default: a Chinese phone shows Chinese, anything else shows English. Pick one and it stays put, whatever the system does.',
  '语言跟随系统': 'Language follows the system',
  '界面语言：中文': 'Language: 中文',
  '上一年': 'Previous year',
  '下一年': 'Next year',
  '上个月': 'Previous month',
  '下个月': 'Next month',
  '币种': 'Currency',
  '支出构成环形图，点扇区可查看明细': 'Spending donut chart, tap a slice for details',
  '近 12 个月支出趋势，可左右滑动查看': 'Spending over the last 12 months, swipe to scroll',
  '小账本 v2.19 · 本地优先 · 可选 OneDrive / 百度网盘云备份':
    'Pocket Ledger v2.19 · local-first · optional OneDrive / Baidu Netdisk backup',
  '只改币种标签，金额数字原样保留 —— 小账本不做汇率换算，所以这不是「折算成另一国货币」，而是把之前记错标签的账纠正过来。已经是对应币种的记录会自动跳过，反复点也不会改乱。改完之后相关月份的 AI 洞察会作废，需要重新生成。':
    'Only the label changes — amounts stay exactly as recorded. There is no FX conversion here, so this is not "converting to another currency", it just fixes entries that were tagged wrong. Rows already in the target currency are skipped, so clicking twice is safe. AI insights for the affected months are cleared and need regenerating.',

  /* 表单占位符 */
  'Azure 应用注册后生成的应用程序(客户端) ID': 'Application (client) ID from your Azure app registration',
  '创建应用时填的产品名称，云端路径 /我的应用数据/{应用名}/': 'The product name you used when creating the app',
  '应用详情页的 SecretKey': 'SecretKey from the app detail page',
  '开放平台应用详情页的 AppKey': 'AppKey from the open platform app page',
  '授权后百度会带回一串 code，粘贴到这里': 'Paste the code Baidu hands back after authorising',
  '留空则用上方 Key': 'blank = use the key above',
  '留空则用上方地址': 'blank = use the endpoint above',
  '留空自动跟随，如 deepseek-flash': 'blank = follow, e.g. deepseek-flash',
  '不限': 'no limit',

  /* 分段的长文案：这些段落中间夹着 <code>/<b>，只能按文本节点逐段翻 */
  '首页和统计页的合计只算这个币种。其他币种的流水照常记录、照常显示自己的符号，但不会和主币种相加 —— 不同币种直接加在一起没有意义。小账本不做汇率换算，所以如果你的日常开销主要花美元，把这里换成美元即可。':
    'Totals on Home and Stats count this currency only. Entries in other currencies are still recorded and shown with their own symbol, but never added in — summing currencies is meaningless. There is no FX conversion, so if you mostly spend USD, switch this to USD.',
  '预算按月固定，不随月份变化；只对': 'Budgets are fixed per month and apply to the ',
  '生效，切换主币种后可以另设一套。首页会显示剩余额度和日均可用，统计页能看每个分类的超支情况。预算只做提醒，不影响记账。':
    ' only. Switch currency and you can keep a separate set. Home shows what is left and the daily allowance; Stats shows per-category overspend. Budgets are a nudge — they never block an entry.',
  'Key 只存在这台设备的浏览器里，不会上传。请勿把本应用链接分享给他人使用同一个 Key。': 'The key stays in this browser and is never uploaded. Do not share this app link with anyone while you have a key in it.',
  'Gemini 走的是 Google 官方 OpenAI 兼容层，同一个 Key 文字和识图都能用，但境内不能直连，需要把代理地址填进上面的「接口地址」。':
    'Gemini goes through Google\'s official OpenAI-compatible layer; one key covers both text and vision, but it cannot be reached directly from mainland China — put your proxy address in Endpoint above.',
  'DeepSeek 的': 'DeepSeek\'s ',
  '已原生支持图片输入，用 DeepSeek 时这一块留空就行，识图和记账共用一个 Key。只有把文字记账放在不支持视觉的模型上时，才需要在这里单独指定':
    ' takes images natively, so with DeepSeek just leave this section blank and one key covers both. You only need a separate vision model when your text model cannot see images — then name something like ',
  '之类的识图模型。': '.',
  '需要先在': 'First verify your identity on ',
  '实名认证（个人身份证，秒审）并创建应用， 拿到 AppKey 和 SecretKey；应用详情页 → 安全设置 → 配置授权回调地址：':
    ' (personal ID, approved instantly) and create an app to get the AppKey and SecretKey. Then open the app detail page → Security settings → Authorised redirect URI:',
  '（配置后约 1 小时生效）。 应用名称必须和创建应用时填的产品名完全一致，否则百度会拒绝路径。 备份存在网盘的「我的应用数据/{应用名}/backup.json」，同名自动覆盖。 注意：SecretKey 保存在本机、只用于自己换 token，别把它给别人。':
    ' (takes about an hour to take effect). The app name must match the product name you registered, or Baidu rejects the path. Backups go to /apps/{name}/backup.json and overwrite on each run. Note: the SecretKey stays on this device and is only used to exchange tokens — never give it away.',
  '备份存在你 OneDrive 的隐藏应用文件夹（Apps/小账本）里，App 只能访问这个文件夹，读不了网盘其它文件。 首次使用需花两分钟注册一个 Azure 应用：登录':
    'Backups live in a hidden app folder in your OneDrive (Apps/Pocket Ledger). The app can only touch that folder, never the rest of your drive. First time takes two minutes: sign in at',
  '→ 应用注册 → 新注册，名称随意； 支持的账户类型选「任何组织目录中的账户和个人 Microsoft 账户」； 平台选「单页应用程序(SPA)」，重定向 URI 填：':
    '→ App registrations → New registration, any name. Account types: accounts in any organizational directory and personal Microsoft accounts. Platform: Single-page application (SPA). Redirect URI:',
  '； 创建后把「应用程序(客户端) ID」粘贴到上面即可，不需要 Client Secret。':
    '. Then paste the Application (client) ID above — no client secret needed.'
};

/* 带数字/变量的句子：正则兜底，避免为每种组合单开词条 */
/* 带数字/变量的句子：正则兜底，避免为每种组合单开词条。
   替换值可以是函数，用来把「2026年11月」这种换算成英文月份。 */
const E = n => (Number(n) === 1 ? 'entry' : 'entries');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const PATS = [
  /* 日期 / 月份 */
  [/^(\d{4})年(\d{1,2})月$/, m => `${MON[+m[2] - 1]} ${m[1]}`],
  [/^(\d{4})年$/, m => m[1]],
  [/^(\d{1,2})月$/, m => MON[+m[1] - 1]],
  [/^(\d{1,2})月支出$/, m => `${MON[+m[1] - 1]} spend`],
  [/^(\d{1,2})月支出 · (.+)$/, m => `${MON[+m[1] - 1]} spend · ${m[2]}`],
  [/^(.+) · (共|无记录)$/, m => `${m[1]} · ${m[2] === '共' ? '' : 'nothing'}`],
  [/^(.+) · 共 (\d+) 笔$/, m => `${m[1]} · ${m[2]} ${E(m[2])}`],
  [/^(.+) · 无记录$/, m => `${m[1]} · no entries`],
  [/^(.+)（本月）$/, m => `${m[1]} (this month)`],
  [/^(\d+) 天前$/, m => `${m[1]} days ago`],
  [/^今日$/, 'Today'],
  [/^(\w+)，无支出$/, m => `${m[1]}, nothing spent`],
  [/^(\w+)，(.+)$/, m => `${m[1]}, ${m[2]}`],

  /* 数量 */
  [/^(\d+)\s*笔$/, m => `${m[1]} ${E(m[1])}`],
  [/^(\d+)\s*笔记录$/, m => `${m[1]} ${E(m[1])}`],
  [/^(\d+)\s*类$/, m => `${m[1]} categories`],
  [/^(\d+)\s*项$/, m => `${m[1]} items`],
  [/^共\s*(\d+)\s*笔$/, m => `${m[1]} ${E(m[1])}`],
  [/^共\s*(\d+)\s*笔 · 待改\s*(\d+)\s*笔$/, m => `${m[1]} ${E(m[1])} · ${m[2]} to change`],
  [/^把这\s*(\d+)\s*笔改成(.+)$/, m => `Change these ${m[1]} to ${m[2]}`],
  [/^(\d+)\s*笔全是(.+)$/, m => `all ${m[1]} ${E(m[1])} are already ${m[2]}`],

  /* 金额行 */
  [/^出品 (\d)/, '$1'],
  [/^支出 (.+)$/, m => `Out ${m[1]}`],
  [/^收入 (.+)$/, m => `In ${m[1]}`],
  [/^还剩 (.+)$/, m => `${m[1]} left`],
  [/^超支 (.+)$/, m => `${m[1]} over`],
  [/^已用\s*([\d.]+)%$/, m => `${m[1]}% used`],
  [/^已用\s*([\d.]+)% · 日均可用 (.+)$/, m => `${m[1]}% used · ${m[2]}/day left`],
  [/^日均可用 (.+)$/, m => `${m[1]}/day left`],
  [/^超\s*(\d+)%$/, m => `+${m[1]}% over`],
  [/^另有多余 (.+)$/, m => `Also ${m[1]}`],
  [/^另有 (.+) · (\d+) 笔$/, m => `Also ${m[1]} · ${m[2]} ${E(m[2])}`],
  [/^这个月另有 (.+) · (\d+) 笔（未计入上图）$/, m => `Also ${m[1]} · ${m[2]} ${E(m[2])} this month (not in the chart)`],
  [/^另有 (.+)$/, m => `Also ${m[1]}`],

  /* 状态提示 */
  [/^已换成「(.+)」$/, m => `Switched to ${m[1]}`],
  [/^已切到 (.+)$/, m => `Switched to ${m[1]}`],
  [/^(.+) · 当前月份$/, m => `${m[1]} · current month`],
  [/^已保存 (\d+) 笔$/, m => `Saved ${m[1]} ${E(m[1])}`],
  [/^已保存 (\d+) 笔，跳过 (\d+) 笔重复$/, m => `Saved ${m[1]} ${E(m[1])}, skipped ${m[2]} duplicates`],
  [/^已保存 (\d+) 笔，跳过 (\d+) 笔重复，切到 (.+)$/, m => `Saved ${m[1]} ${E(m[1])}, skipped ${m[2]} duplicates, jumped to ${m[3]}`],
  [/^上次备份 (\d+) 天前，建议现在导出一份。数据只存在本机，清理浏览器数据会丢失。$/,
    m => `Last backup ${m[1]} days ago — export one now. Data lives on this device only, clearing browser data wipes it.`],
  [/^上次备份 (\d+) 天前。数据只存在本机。$/, m => `Last backup ${m[1]} days ago. Data lives on this device only.`],
  [/^上次备份 今天。数据只存在本机。$/, 'Last backup today. Data lives on this device only.'],
  [/^上次云备份 (.+)。备份存在 OneDrive 隐藏应用文件夹（Apps\/小账本），App 只能访问这个文件夹。$/,
    m => `Last backup ${m[1]}. Stored in OneDrive's hidden app folder (Apps/Pocket Ledger); the app can not touch anything else.`],
  [/^还没云备份过。备份存在 OneDrive 隐藏应用文件夹（Apps\/小账本），App 只能访问这个文件夹。$/,
    'No cloud backup yet. Stored in OneDrive\'s hidden app folder (Apps/Pocket Ledger); the app can not touch anything else.'],
  [/^上次云备份 (.+)，云端路径 (.+)。$/, m => `Last backup ${m[1]}, cloud path ${m[2]}.`],
  [/^还没云备份过，云端路径 (.+)，同名自动覆盖。$/, m => `No cloud backup yet, cloud path ${m[2] || m[1]}, same name overwrites.`],
  [/^已连接 · (.+)$/, m => `Connected · ${m[1]}`],
  [/^已连接：(.*)$/, m => `Connected: ${m[1]}`],
  [/^已连接 OneDrive：(.*)$/, m => `Connected to OneDrive: ${m[1]}`],
  [/^已连接 OneDrive$/, 'Connected to OneDrive'],
  [/^已连接百度网盘：(.*)$/, m => `Connected to Baidu Netdisk: ${m[1]}`],
  [/^已连接百度网盘$/, 'Connected to Baidu Netdisk'],
  [/^OneDrive 连接失败：(.*)$/, m => `OneDrive connection failed: ${m[1]}`],
  [/^百度连接失败：(.*)$/, m => `Baidu connection failed: ${m[1]}`],
  [/^已备份到 (.+)$/, m => `Backed up to ${m[1]}`],
  [/^已备份 (.+)$/, m => `Backed up ${m[1]}`],
  [/^连接成功(.*)$/, m => `Connected${m[1]}`],
  [/^连接成功：(.*)$/, m => `Connected: ${m[1]}`],
  [/^识图可用：(.*)$/, m => `Vision works: ${m[1]}`],
  [/^主币种已切到(.+)，合计改按 (.+) 计$/, m => `Main currency switched to ${m[1]}, totals now in ${m[2]}`],
  [/^(.+) 笔已改为(.+)$/, m => `${m[1]} ${E(m[1])} relabelled to ${m[2]}`],
  [/^(.+) 笔已改为(.+)，主币种一起切了$/, m => `${m[1]} ${E(m[1])} relabelled to ${m[2]}, main currency switched too`],
  [/^导入 (\d+) 笔$/, m => `Imported ${m[1]} ${E(m[1])}`],
  [/^已导入 (\d+) 笔$/, m => `Imported ${m[1]} ${E(m[1])}`],
  [/^已忘掉这条习惯$/, 'Rule forgotten'],
  [/^识别到 (\d+) 笔$/, m => `Found ${m[1]} ${E(m[1])}`],
  [/^识别到 (\d+) 笔 · 按小票日期分 (\d+) 天$/, m => `Found ${m[1]} ${E(m[1])} · split across ${m[2]} dates`],
  [/^(\d+) 笔已识别，但有 (\d+) 张失败：(.*)$/, m => `${m[1]} ${E(m[1])} read, but ${m[2]} images failed: ${m[3]}`],
  [/^一次最多 (\d+) 张，先处理前 (\d+) 张$/, m => `Up to ${m[1]} images at a time — handling the first ${m[2]}`],
  [/^正在读第 (\d+)\/(\d+) 张…$/, m => `Reading image ${m[1]}/${m[2]}…`],
  [/^第 (\d+) 张没找到账单$/, m => `Image ${m[1]} had no receipt`],
  [/^第 (\d+) 张：(.*)$/, m => `Image ${m[1]}: ${m[2]}`],
  [/^识图 (\d+)\/(\d+)$/, m => `Reading ${m[1]}/${m[2]}`],
  [/^(\d+) 张图 · $/, m => `${m[1]} photo · `],
  [/^(\d+) 张图 · 支出合计 (.+)$/, m => `${m[1]} photos · total out ${m[2]}`],
  [/^支出合计 (.+)$/, m => `Total out ${m[1]}`],
  [/^其中 (\d+) 笔同日期同金额的流水已经存在，默认不重复保存$/, m => `${m[1]} ${E(m[1])} with the same date and amount already exist — skipped by default`],
  [/^保存 (\d+) 笔$/, m => `Save ${m[1]} ${E(m[1])}`],
  [/^(\d+) 笔\$/, m => `${m[1]} ${E(m[1])}`],
  [/^(.+) 笔$/, m => `${m[1]} ${E(m[1])}`],
  [/^删除分类「(.+)」？已记录的流水不受影响。$/, m => `Delete category "${m[1]}"? Existing entries are kept.`],
  [/^导入 (\d+) 笔记录？相同 ID 的记录会被覆盖，不会重复。$/, m => `Import ${m[1]} ${E(m[1])}? Records with the same ID are overwritten, never duplicated.`],
  [/^把(.+)里的 (\d+) 笔改成(.+)？[\s\S]*$/, m => `Change ${m[2]} ${E(m[2])} in ${m[1]} to ${m[3]}? Only the label changes — amounts stay as they are (no FX conversion).`],
  [/^跨 (\d+) 个月出现 (\d+) 次 · 点看明细$/, m => `Seen ${m[2]} times across ${m[1]} months · tap for details`],
  [/^每月固定支出约 (.+)，一年 (.+)$/, m => `Fixed monthly spend around ${m[1]}, ${m[2]} a year`],
  [/^(\d+)月(\d+)日生成 · 点右上角可重新生成$/, m => `Generated ${MON[+m[1] - 1]} ${m[2]} · tap the corner to refresh`],
  [/^占 (\d+)%$/, m => `${m[1]}%`],
  [/^(\d+) 笔 · (.+) · 占 (\d+)%(.*)$/, m => `${m[1]} ${E(m[1])} · ${m[2]} · ${m[3]}%${m[4]}`],
  [/^ · 另有 (\d+) 笔其它币种$/, m => ` · ${m[1]} more in other currencies`],
  [/^(\d+) 笔数$/, m => `${m[1]}`],
  [/^(.+) → (.+)$/, m => `${m[1]} → ${m[2]}`]
];

/* 段落里的换行和缩进不该影响匹配：压成单空格再查一次 */
const ws = s => String(s).replace(/\s+/g, ' ').trim();
const EN_WS = Object.fromEntries(Object.entries(EN).map(([k, v]) => [ws(k), v]));

export function translate(str) {
  if (!str) return str;
  const raw = String(str);
  const s = raw.trim();
  if (!s) return raw;
  const hit = EN[s] ?? EN_WS[ws(s)];
  if (hit != null) return raw.replace(s, hit);
  for (const [re, rep] of PATS) {
    if (!re.test(s)) continue;
    /* 函数型替换统一收到 [整段, 分组1, 分组2...] 一个数组，
       省得每个规则都写一遍 (match, p1, p2, offset, input) */
    const out = s.replace(re, (...args) =>
      (typeof rep === 'function' ? rep(args.slice(0, args.length - 2)) : rep));
    if (out !== s) return raw.replace(s, out);
  }
  return raw;
}

/* 需要提前拿到字符串时用：t('共 {n} 笔', { n: 3 }) */
export function t(zh, vars) {
  if (cur !== 'en') return zh;
  let s = translate(zh);
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
  return s;
}

/* ---------------- DOM 翻译 ---------------- */

const SKIP = 'script,style,textarea,code,[data-no-i18n]';

/* 切回中文时要能还原，所以翻译过的节点记下原文。
   WeakMap 防止节点被回收前一直占着内存，数组只用来遍历。 */
const origText = new WeakMap();
const origAttr = new WeakMap();
let touchedText = [];
let touchedAttr = [];

function setText(node, out) {
  if (!origText.has(node)) {
    origText.set(node, node.nodeValue);
    touchedText.push(node);
  }
  node.nodeValue = out;
}

function setAttr(el, attr, out) {
  let m = origAttr.get(el);
  if (!m) { m = {}; origAttr.set(el, m); }
  if (!(attr in m)) { m[attr] = el.getAttribute(attr); touchedAttr.push([el, attr]); }
  el.setAttribute(attr, out);
}

/* 还原成中文原文。节点已经不在文档里就跳过（列表重渲染过）。 */
function restore() {
  for (const n of touchedText) {
    if (n.isConnected && origText.has(n)) n.nodeValue = origText.get(n);
  }
  for (const [el, attr] of touchedAttr) {
    if (el && el.isConnected && origAttr.has(el)) {
      const v = origAttr.get(el)[attr];
      if (v != null) el.setAttribute(attr, v);
    }
  }
  touchedText = [];
  touchedAttr = [];
}

function trTextNode(node) {
  const el = node.parentElement;
  if (!el || el.closest(SKIP)) return;
  const out = translate(node.nodeValue);
  if (out !== node.nodeValue) setText(node, out);
}

function trAttrs(el) {
  if (!el || el.nodeType !== 1) return;
  /* 属性检查不能把元素自己算进去：占位符大多挂在 input/textarea 上，
     而这两个标签的正文要跳过（那是用户输入）。 */
  if (el.closest('script,style,[data-no-i18n]')) return;
  for (const a of ['placeholder', 'aria-label', 'title']) {
    if (el.hasAttribute(a)) {
      const v = el.getAttribute(a);
      const out = translate(v);
      if (out !== v) setAttr(el, a, out);
    }
  }
}

function walk(root) {
  if (!root) return;
  if (root.nodeType === 3) { trTextNode(root); return; }
  if (root.nodeType !== 1) return;
  trAttrs(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n = w.nextNode();
  while (n) {
    if (n.nodeType === 3) trTextNode(n);
    else trAttrs(n);
    n = w.nextNode();
  }
}

/* 把整棵子树翻一遍：初始化、切语言、渲染后手动调用都行 */
export function flush(root) {
  if (cur !== 'en') return;
  walk(root || document.body);
}

let obs = null;
let queued = null;
const pending = new Set();

export function start() {
  if (cur !== 'en') return;
  if (obs) return;
  obs = new MutationObserver(muts => {
    for (const m of muts) {
      if (m.type === 'characterData') pending.add(m.target);
      else if (m.type === 'attributes') pending.add(m.target);
      else {
        for (const n of m.addedNodes) pending.add(n);
      }
    }
    if (queued) return;
    queued = Promise.resolve().then(() => {
      queued = null;
      const items = Array.from(pending);
      pending.clear();
      for (const n of items) {
        try {
          if (n.nodeType === 3) trTextNode(n);
          else if (n.nodeType === 1 && n.isConnected) walk(n);
        } catch (e) { /* 单个节点失败不影响其它 */ }
      }
    });
  });
  obs.observe(document.body, {
    childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['placeholder', 'aria-label', 'title']
  });
}

export function stop() {
  if (obs) { obs.disconnect(); obs = null; }
}

/* 切语言时整体重刷：先停观察器，翻完（或还原）再挂上，免得自己触发自己 */
export function refresh() {
  stop();
  if (cur === 'en') flush(document.body);
  else restore();
  start();
}

export default { t, translate, flush, start, stop, refresh, lang, isEN, initLang, setLang, langPref, cachedLangPref, detectLang };
