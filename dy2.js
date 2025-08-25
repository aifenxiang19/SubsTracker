// Subscription Renewal Notification Site - Based on Cloudflare Workers (D1 Database Version)

/*
 * ==============================================================================
 * D1 DATABASE SETUP
 * ==============================================================================
 * Before using this script, you must:
 *
 * 1. Create a D1 Database in the Cloudflare dashboard.
 * 2. Bind the database to this Worker with the variable name 'DB'.
 * Add this to your wrangler.toml:
 * [[d1_databases]]
 * binding = "DB"
 * database_name = "your-database-name"
 * database_id = "your-database-id"
 *
 * 3. Run the following SQL command in your D1 database console to create the
 * necessary table.
 *
 * CREATE TABLE subscriptions (
 * id TEXT PRIMARY KEY,
 * name TEXT NOT NULL,
 * customType TEXT,
 * startDate TEXT,
 * expiryDate TEXT NOT NULL,
 * periodValue INTEGER,
 * periodUnit TEXT,
 * reminderDays INTEGER,
 * notes TEXT,
 * isActive INTEGER DEFAULT 1,
 * autoRenew INTEGER DEFAULT 1,
 * useLunar INTEGER DEFAULT 0,
 * createdAt TEXT,
 * updatedAt TEXT
 * );
 * ==============================================================================
 */


// Timezone utility function
function formatBeijingTime(date = new Date(), format = 'full') {
  if (format === 'date') {
    return date.toLocaleDateString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  } else if (format === 'datetime') {
    return date.toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  } else {
    // full format
    return date.toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai'
    });
  }
}

// Lunar calendar utility function
const lunarCalendar = {
  // Lunar data (1900-2100)
  lunarInfo: [
    0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
    0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
    0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
    0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
    0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
    0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0,
    0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
    0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
    0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
    0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x055c0, 0x0ab60, 0x096d5, 0x092e0,
    0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
    0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
    0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
    0x05aa0, 0x076a3, 0x096d0, 0x04bd7, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
    0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0
  ],
  gan: ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'],
  zhi: ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'],
  months: ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'],
  days: ['初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
         '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
         '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'],
  lunarYearDays: function(year) {
    let sum = 348;
    for (let i = 0x8000; i > 0x8; i >>= 1) {
      sum += (this.lunarInfo[year - 1900] & i) ? 1 : 0;
    }
    return sum + this.leapDays(year);
  },
  leapDays: function(year) {
    if (this.leapMonth(year)) {
      return (this.lunarInfo[year - 1900] & 0x10000) ? 30 : 29;
    }
    return 0;
  },
  leapMonth: function(year) {
    return this.lunarInfo[year - 1900] & 0xf;
  },
  monthDays: function(year, month) {
    return (this.lunarInfo[year - 1900] & (0x10000 >> month)) ? 30 : 29;
  },
  solar2lunar: function(year, month, day) {
    if (year < 1900 || year > 2100) return null;
    const baseDate = new Date(1900, 0, 31);
    const objDate = new Date(year, month - 1, day);
    let offset = Math.floor((objDate - baseDate) / 86400000);
    let temp = 0;
    let lunarYear = 1900;
    for (lunarYear = 1900; lunarYear < 2101 && offset > 0; lunarYear++) {
      temp = this.lunarYearDays(lunarYear);
      offset -= temp;
    }
    if (offset < 0) {
      offset += temp;
      lunarYear--;
    }
    let lunarMonth = 1;
    let leap = this.leapMonth(lunarYear);
    let isLeap = false;
    for (lunarMonth = 1; lunarMonth < 13 && offset > 0; lunarMonth++) {
      if (leap > 0 && lunarMonth === (leap + 1) && !isLeap) {
        --lunarMonth;
        isLeap = true;
        temp = this.leapDays(lunarYear);
      } else {
        temp = this.monthDays(lunarYear, lunarMonth);
      }
      if (isLeap && lunarMonth === (leap + 1)) isLeap = false;
      offset -= temp;
    }
    if (offset === 0 && leap > 0 && lunarMonth === leap + 1) {
      if (isLeap) {
        isLeap = false;
      } else {
        isLeap = true;
        --lunarMonth;
      }
    }
    if (offset < 0) {
      offset += temp;
      --lunarMonth;
    }
    const lunarDay = offset + 1;
    const ganIndex = (lunarYear - 4) % 10;
    const zhiIndex = (lunarYear - 4) % 12;
    const yearStr = this.gan[ganIndex] + this.zhi[zhiIndex] + '年';
    const monthStr = (isLeap ? '闰' : '') + this.months[lunarMonth - 1] + '月';
    const dayStr = this.days[lunarDay - 1];
    return {
      year: lunarYear,
      month: lunarMonth,
      day: lunarDay,
      isLeap: isLeap,
      yearStr: yearStr,
      monthStr: monthStr,
      dayStr: dayStr,
      fullStr: yearStr + monthStr + dayStr
    };
  }
};

// 1. New lunarBiz tool module, supports lunar period addition, lunar to solar conversion, days until lunar date
const lunarBiz = {
  // Add a period to a lunar date, return a new lunar date object
  addLunarPeriod(lunar, periodValue, periodUnit) {
    let { year, month, day, isLeap } = lunar;
    if (periodUnit === 'year') {
      year += periodValue;
      const leap = lunarCalendar.leapMonth(year);
      isLeap = isLeap && leap === month;
    } else if (periodUnit === 'month') {
      let totalMonths = (year - 1900) * 12 + (month - 1) + periodValue;
      year = Math.floor(totalMonths / 12) + 1900;
      month = (totalMonths % 12) + 1;
      const leap = lunarCalendar.leapMonth(year);
      isLeap = isLeap && leap === month;
    } else if (periodUnit === 'day') {
      const solar = lunarBiz.lunar2solar(lunar);
      const date = new Date(solar.year, solar.month - 1, solar.day + periodValue);
      return lunarCalendar.solar2lunar(date.getFullYear(), date.getMonth() + 1, date.getDate());
    }
    let maxDay = isLeap
      ? lunarCalendar.leapDays(year)
      : lunarCalendar.monthDays(year, month);
    let targetDay = Math.min(day, maxDay);
    while (targetDay > 0) {
      let solar = lunarBiz.lunar2solar({ year, month, day: targetDay, isLeap });
      if (solar) {
        return { year, month, day: targetDay, isLeap };
      }
      targetDay--;
    }
    return { year, month, day, isLeap };
  },
  // Convert lunar to solar (iteration method, for 1900-2100)
  lunar2solar(lunar) {
    for (let y = lunar.year - 1; y <= lunar.year + 1; y++) {
      for (let m = 1; m <= 12; m++) {
        for (let d = 1; d <= 31; d++) {
          const date = new Date(y, m - 1, d);
          if (date.getFullYear() !== y || date.getMonth() + 1 !== m || date.getDate() !== d) continue;
          const l = lunarCalendar.solar2lunar(y, m, d);
          if (
            l &&
            l.year === lunar.year &&
            l.month === lunar.month &&
            l.day === lunar.day &&
            l.isLeap === lunar.isLeap
          ) {
            return { year: y, month: m, day: d };
          }
        }
      }
    }
    return null;
  },
  // Days remaining until a lunar date
  daysToLunar(lunar) {
    const solar = lunarBiz.lunar2solar(lunar);
    const date = new Date(solar.year, solar.month - 1, solar.day);
    const now = new Date();
    return Math.ceil((date - now) / (1000 * 60 * 60 * 24));
  }
};

// Define HTML templates
const loginPage = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>订阅管理系统</title>
  <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css" rel="stylesheet">
  <style>
    .login-container {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
    }
    .login-box {
      backdrop-filter: blur(8px);
      background-color: rgba(255, 255, 255, 0.9);
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
    }
    .btn-primary {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      transition: all 0.3s;
    }
    .btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1);
    }
    .input-field {
      transition: all 0.3s;
      border: 1px solid #e2e8f0;
    }
    .input-field:focus {
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.25);
    }
  </style>
</head>
<body class="login-container flex items-center justify-center">
  <div class="login-box p-8 rounded-xl w-full max-w-md">
    <div class="text-center mb-8">
      <h1 class="text-2xl font-bold text-gray-800"><i class="fas fa-calendar-check mr-2"></i>订阅管理系统</h1>
      <p class="text-gray-600 mt-2">登录管理您的订阅提醒</p>
    </div>
    
    <form id="loginForm" class="space-y-6">
      <div>
        <label for="username" class="block text-sm font-medium text-gray-700 mb-1">
          <i class="fas fa-user mr-2"></i>用户名
        </label>
        <input type="text" id="username" name="username" required
          class="input-field w-full px-4 py-3 rounded-lg text-gray-700 focus:outline-none">
      </div>
      
      <div>
        <label for="password" class="block text-sm font-medium text-gray-700 mb-1">
          <i class="fas fa-lock mr-2"></i>密码
        </label>
        <input type="password" id="password" name="password" required
          class="input-field w-full px-4 py-3 rounded-lg text-gray-700 focus:outline-none">
      </div>
      
      <button type="submit" 
        class="btn-primary w-full py-3 rounded-lg text-white font-medium focus:outline-none">
        <i class="fas fa-sign-in-alt mr-2"></i>登录
      </button>
      
      <div id="errorMsg" class="text-red-500 text-center"></div>
    </form>
  </div>
  
  <script>
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;
      
      const button = e.target.querySelector('button');
      const originalContent = button.innerHTML;
      button.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>登录中...';
      button.disabled = true;
      
      try {
        const response = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        
        const result = await response.json();
        
        if (result.success) {
          window.location.href = '/admin';
        } else {
          document.getElementById('errorMsg').textContent = result.message || '用户名或密码错误';
          button.innerHTML = originalContent;
          button.disabled = false;
        }
      } catch (error) {
        document.getElementById('errorMsg').textContent = '发生错误，请稍后再试';
        button.innerHTML = originalContent;
        button.disabled = false;
      }
    });
  </script>
</body>
</html>
`;

const adminPage = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>订阅管理系统</title>
  <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css" rel="stylesheet">
  <style>
    .btn-primary { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); transition: all 0.3s; }
    .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1); }
    .btn-danger { background: linear-gradient(135deg, #f87171 0%, #dc2626 100%); transition: all 0.3s; }
    .btn-danger:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1); }
    .btn-success { background: linear-gradient(135deg, #34d399 0%, #059669 100%); transition: all 0.3s; }
    .btn-success:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1); }
    .btn-warning { background: linear-gradient(135deg, #fbbf24 0%, #d97706 100%); transition: all 0.3s; }
    .btn-warning:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1); }
    .btn-info { background: linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%); transition: all 0.3s; }
    .btn-info:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1); }
    .table-container { box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); }
    .modal-container { backdrop-filter: blur(8px); }
    .readonly-input { background-color: #f8fafc; border-color: #e2e8f0; cursor: not-allowed; }
    .error-message { font-size: 0.875rem; margin-top: 0.25rem; display: none; }
    .error-message.show { display: block; }

    /* 通用悬浮提示优化 */
    .hover-container {
      position: relative;
      width: 100%;
    }
    .hover-text {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: pointer;
      transition: all 0.3s ease;
      display: block;
    }
    .hover-text:hover { color: #3b82f6; }
    .hover-tooltip {
      position: fixed;
      z-index: 9999;
      background: #1f2937;
      color: white;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 0.875rem;
      max-width: 320px;
      word-wrap: break-word;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
      opacity: 0;
      visibility: hidden;
      transition: all 0.3s ease;
      transform: translateY(-10px);
      white-space: normal;
      pointer-events: none;
      line-height: 1.4;
    }
    .hover-tooltip.show {
      opacity: 1;
      visibility: visible;
      transform: translateY(0);
    }
    .hover-tooltip::before {
      content: '';
      position: absolute;
      top: -6px;
      left: 20px;
      border-left: 6px solid transparent;
      border-right: 6px solid transparent;
      border-bottom: 6px solid #1f2937;
    }
    .hover-tooltip.tooltip-above::before {
      top: auto;
      bottom: -6px;
      border-bottom: none;
      border-top: 6px solid #1f2937;
    }

    /* 备注显示优化 */
    .notes-container {
      position: relative;
      max-width: 200px;
      width: 100%;
    }
    .notes-text {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: pointer;
      transition: all 0.3s ease;
      display: block;
    }
    .notes-text:hover { color: #3b82f6; }
    .notes-tooltip {
      position: fixed;
      z-index: 9999;
      background: #1f2937;
      color: white;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 0.875rem;
      max-width: 320px;
      word-wrap: break-word;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
      opacity: 0;
      visibility: hidden;
      transition: all 0.3s ease;
      transform: translateY(-10px);
      white-space: normal;
      pointer-events: none;
      line-height: 1.4;
    }
    .notes-tooltip.show {
      opacity: 1;
      visibility: visible;
      transform: translateY(0);
    }
    .notes-tooltip::before {
      content: '';
      position: absolute;
      top: -6px;
      left: 20px;
      border-left: 6px solid transparent;
      border-right: 6px solid transparent;
      border-bottom: 6px solid #1f2937;
    }
    .notes-tooltip.tooltip-above::before {
      top: auto;
      bottom: -6px;
      border-bottom: none;
      border-top: 6px solid #1f2937;
    }

    /* 农历显示样式 */
    .lunar-display {
      font-size: 0.75rem;
      color: #6366f1;
      margin-top: 2px;
      opacity: 0;
      transition: opacity 0.3s ease;
    }
    .lunar-display.show {
      opacity: 1;
    }
    .lunar-toggle {
      display: inline-flex;
      align-items: center;
      margin-bottom: 8px;
      font-size: 0.875rem;
    }
    .lunar-toggle input[type="checkbox"] {
      margin-right: 6px;
    }

    /* 表格布局优化 */
    .table-container {
      width: 100%;
      overflow: visible;
    }

    .table-container table {
      table-layout: fixed;
      width: 100%;
    }

    /* 防止表格内容溢出 */
    .table-container td {
      overflow: hidden;
      word-wrap: break-word;
    }

    .truncate {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* 响应式优化 */
    .responsive-table { table-layout: fixed; width: 100%; }
    .td-content-wrapper { word-wrap: break-word; white-space: normal; text-align: left; width: 100%; }
    .td-content-wrapper > * { text-align: left; } /* Align content left within the wrapper */

    @media (max-width: 767px) {
      .table-container { overflow-x: initial; } /* Override previous setting */
      .responsive-table thead { display: none; }
      .responsive-table tbody, .responsive-table tr, .responsive-table td { display: block; width: 100%; }
      .responsive-table tr { margin-bottom: 1.5rem; border: 1px solid #ddd; border-radius: 0.5rem; box-shadow: 0 2px 4px rgba(0,0,0,0.05); overflow: hidden; }
      .responsive-table td { display: flex; justify-content: flex-start; align-items: center; padding: 0.75rem 1rem; border-bottom: 1px solid #eee; }
      .responsive-table td:last-of-type { border-bottom: none; }
      .responsive-table td:before { content: attr(data-label); font-weight: 600; text-align: left; padding-right: 1rem; color: #374151; white-space: nowrap; }
      .action-buttons-wrapper { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: flex-end; }
      
      .notes-container, .hover-container {
        max-width: 180px; /* Adjust for new layout */
        text-align: right;
      }
      .td-content-wrapper .notes-text {
        text-align: right;
      }
    }

    @media (min-width: 768px) {
      .table-container {
        overflow: visible;
      }
      /* .td-content-wrapper is aligned left by default */
    }

    /* Toast 样式 */
    .toast {
      position: fixed; top: 20px; right: 20px; padding: 12px 20px; border-radius: 8px;
      color: white; font-weight: 500; z-index: 1000; transform: translateX(400px);
      transition: all 0.3s ease-in-out; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }
    .toast.show { transform: translateX(0); }
    .toast.success { background-color: #10b981; }
    .toast.error { background-color: #ef4444; }
    .toast.info { background-color: #3b82f6; }
    .toast.warning { background-color: #f59e0b; }
  </style>
</head>
<body class="bg-gray-100 min-h-screen">
  <div id="toast-container"></div>

  <nav class="bg-white shadow-md">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex justify-between h-16">
        <div class="flex items-center">
          <i class="fas fa-calendar-check text-indigo-600 text-2xl mr-2"></i>
          <span class="font-bold text-xl text-gray-800">订阅管理系统</span>
        </div>
        <div class="flex items-center space-x-4">
          <a href="/admin" class="text-indigo-600 border-b-2 border-indigo-600 px-3 py-2 rounded-md text-sm font-medium">
            <i class="fas fa-list mr-1"></i>订阅列表
          </a>
          <a href="/admin/config" class="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium">
            <i class="fas fa-cog mr-1"></i>系统配置
          </a>
          <a href="/api/logout" class="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium">
            <i class="fas fa-sign-out-alt mr-1"></i>退出登录
          </a>
        </div>
      </div>
    </div>
  </nav>
  
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-2xl font-bold text-gray-800">订阅列表</h2>
      <div class="flex items-center space-x-4">
        <label class="lunar-toggle">
          <input type="checkbox" id="listShowLunar" class="form-checkbox h-4 w-4 text-indigo-600">
          <span class="text-gray-700">显示农历</span>
        </label>
        <button id="addSubscriptionBtn" class="btn-primary text-white px-4 py-2 rounded-md text-sm font-medium flex items-center">
          <i class="fas fa-plus mr-2"></i>添加新订阅
        </button>
      </div>
    </div>
    
    <div id="statusSummary" class="mb-4 text-sm text-gray-700"></div>

    <div class="table-container bg-white rounded-lg overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full divide-y divide-gray-200 responsive-table">
          <thead class="bg-gray-50">
            <tr>
              <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style="width: 5%;">序号</th>
              <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style="width: 20%;">
                名称
              </th>
              <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style="width: 15%;">
                类型
              </th>
              <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style="width: 20%;">
                到期时间 <i class="fas fa-sort-up ml-1 text-indigo-500" title="按到期时间升序排列"></i>
              </th>
              <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style="width: 15%;">
                提醒设置
              </th>
              <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style="width: 10%;">
                状态
              </th>
              <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style="width: 15%;">
                操作
              </th>
            </tr>
          </thead>
        <tbody id="subscriptionsBody" class="bg-white divide-y divide-gray-200">
        </tbody>
        </table>
      </div>
    </div>
  </div>

  <div id="subscriptionModal" class="fixed inset-0 bg-gray-600 bg-opacity-50 modal-container hidden flex items-center justify-center z-50">
    <div class="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-screen overflow-y-auto">
      <div class="bg-gray-50 px-6 py-4 border-b border-gray-200 rounded-t-lg">
        <div class="flex items-center justify-between">
          <h3 id="modalTitle" class="text-lg font-medium text-gray-900">添加新订阅</h3>
          <button id="closeModal" class="text-gray-400 hover:text-gray-600">
            <i class="fas fa-times text-xl"></i>
          </button>
        </div>
      </div>
      
      <form id="subscriptionForm" class="p-6 space-y-6">
        <input type="hidden" id="subscriptionId">
        
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label for="name" class="block text-sm font-medium text-gray-700 mb-1">订阅名称 *</label>
            <input type="text" id="name" required
              class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500">
            <div class="error-message text-red-500"></div>
          </div>
          
          <div>
            <label for="customType" class="block text-sm font-medium text-gray-700 mb-1">订阅类型</label>
            <input type="text" id="customType" placeholder="例如：流媒体、云服务、软件等"
              class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500">
            <div class="error-message text-red-500"></div>
          </div>
        </div>
        
        <div class="mb-4">
          <label class="lunar-toggle">
            <input type="checkbox" id="showLunar" class="form-checkbox h-4 w-4 text-indigo-600">
            <span class="text-gray-700">显示农历日期</span>
          </label>
        </div>
		<div class="mb-4">
		  <label class="lunar-toggle">
			<input type="checkbox" id="useLunar" class="form-checkbox h-4 w-4 text-indigo-600">
			<span class="text-gray-700">周期按农历</span>
		  </label>
		</div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label for="startDate" class="block text-sm font-medium text-gray-700 mb-1">开始日期</label>
            <input type="date" id="startDate"
              class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500">
            <div id="startDateLunar" class="lunar-display"></div>
            <div class="error-message text-red-500"></div>
          </div>
          
          <div>
            <label for="periodValue" class="block text-sm font-medium text-gray-700 mb-1">周期数值 *</label>
            <input type="number" id="periodValue" min="1" value="1" required
              class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500">
            <div class="error-message text-red-500"></div>
          </div>
          
          <div>
            <label for="periodUnit" class="block text-sm font-medium text-gray-700 mb-1">周期单位 *</label>
            <select id="periodUnit" required
              class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500">
              <option value="day">天</option>
              <option value="month" selected>月</option>
              <option value="year">年</option>
            </select>
            <div class="error-message text-red-500"></div>
          </div>
        </div>
        
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label for="expiryDate" class="block text-sm font-medium text-gray-700 mb-1">到期日期 *</label>
            <input type="date" id="expiryDate" required
              class="readonly-input w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none">
            <div id="expiryDateLunar" class="lunar-display"></div>
            <div class="error-message text-red-500"></div>
          </div>
          
          <div class="flex items-end">
            <button type="button" id="calculateExpiryBtn" 
              class="btn-primary text-white px-4 py-2 rounded-md text-sm font-medium h-10">
              <i class="fas fa-calculator mr-2"></i>自动计算到期日期
            </button>
          </div>
        </div>
        
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label for="reminderDays" class="block text-sm font-medium text-gray-700 mb-1">提前提醒天数</label>
            <input type="number" id="reminderDays" min="0" value="7"
              class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500">
            <p class="text-xs text-gray-500 mt-1">0 = 仅到期日当天提醒，1+ = 提前N天开始提醒</p>
            <div class="error-message text-red-500"></div>
          </div>
          
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-3">选项设置</label>
            <div class="space-y-2">
              <label class="inline-flex items-center">
                <input type="checkbox" id="isActive" checked 
                  class="form-checkbox h-4 w-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500">
                <span class="ml-2 text-sm text-gray-700">启用订阅</span>
              </label>
              <label class="inline-flex items-center">
                <input type="checkbox" id="autoRenew" checked 
                  class="form-checkbox h-4 w-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500">
                <span class="ml-2 text-sm text-gray-700">自动续订</span>
              </label>
            </div>
          </div>
        </div>
        
        <div>
          <label for="notes" class="block text-sm font-medium text-gray-700 mb-1">备注</label>
          <textarea id="notes" rows="3" placeholder="可添加相关备注信息..."
            class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"></textarea>
          <div class="error-message text-red-500"></div>
        </div>
        
        <div class="flex justify-end space-x-3 pt-4 border-t border-gray-200">
          <button type="button" id="cancelBtn" 
            class="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50">
            取消
          </button>
          <button type="submit" 
            class="btn-primary text-white px-4 py-2 rounded-md text-sm font-medium">
            <i class="fas fa-save mr-2"></i>保存
          </button>
        </div>
      </form>
    </div>
  </div>

  <script>
    // Timezone utility function - Frontend version
    function formatBeijingTime(date = new Date(), format = 'full') {
      if (format === 'date') {
        return date.toLocaleDateString('zh-CN', {
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        });
      } else if (format === 'datetime') {
        return date.toLocaleString('zh-CN', {
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
      } else {
        // full format
        return date.toLocaleString('zh-CN', {
          timeZone: 'Asia/Shanghai'
        });
      }
    }

    // Lunar calendar utility function - Frontend version
    const lunarCalendar = {
      // Lunar data (1900-2100)
      lunarInfo: [
        0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
        0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
        0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
        0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
        0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
        0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0,
        0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
        0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
        0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
        0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x055c0, 0x0ab60, 0x096d5, 0x092e0,
        0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
        0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
        0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
        0x05aa0, 0x076a3, 0x096d0, 0x04bd7, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
        0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0
      ],
      gan: ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'],
      zhi: ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'],
      months: ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'],
      days: ['初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
             '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
             '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'],
      lunarYearDays: function(year) {
        let sum = 348;
        for (let i = 0x8000; i > 0x8; i >>= 1) {
          sum += (this.lunarInfo[year - 1900] & i) ? 1 : 0;
        }
        return sum + this.leapDays(year);
      },
      leapDays: function(year) {
        if (this.leapMonth(year)) {
          return (this.lunarInfo[year - 1900] & 0x10000) ? 30 : 29;
        }
        return 0;
      },
      leapMonth: function(year) {
        return this.lunarInfo[year - 1900] & 0xf;
      },
      monthDays: function(year, month) {
        return (this.lunarInfo[year - 1900] & (0x10000 >> month)) ? 30 : 29;
      },
      solar2lunar: function(year, month, day) {
        if (year < 1900 || year > 2100) return null;
        const baseDate = new Date(1900, 0, 31);
        const objDate = new Date(year, month - 1, day);
        let offset = Math.floor((objDate - baseDate) / 86400000);
        let temp = 0;
        let lunarYear = 1900;
        for (lunarYear = 1900; lunarYear < 2101 && offset > 0; lunarYear++) {
          temp = this.lunarYearDays(lunarYear);
          offset -= temp;
        }
        if (offset < 0) {
          offset += temp;
          lunarYear--;
        }
        let lunarMonth = 1;
        let leap = this.leapMonth(lunarYear);
        let isLeap = false;
        for (lunarMonth = 1; lunarMonth < 13 && offset > 0; lunarMonth++) {
          if (leap > 0 && lunarMonth === (leap + 1) && !isLeap) {
            --lunarMonth;
            isLeap = true;
            temp = this.leapDays(lunarYear);
          } else {
            temp = this.monthDays(lunarYear, lunarMonth);
          }
          if (isLeap && lunarMonth === (leap + 1)) isLeap = false;
          offset -= temp;
        }
        if (offset === 0 && leap > 0 && lunarMonth === leap + 1) {
          if (isLeap) {
            isLeap = false;
          } else {
            isLeap = true;
            --lunarMonth;
          }
        }
        if (offset < 0) {
          offset += temp;
          --lunarMonth;
        }
        const lunarDay = offset + 1;
        const ganIndex = (lunarYear - 4) % 10;
        const zhiIndex = (lunarYear - 4) % 12;
        const yearStr = this.gan[ganIndex] + this.zhi[zhiIndex] + '年';
        const monthStr = (isLeap ? '闰' : '') + this.months[lunarMonth - 1] + '月';
        const dayStr = this.days[lunarDay - 1];
        return {
          year: lunarYear,
          month: lunarMonth,
          day: lunarDay,
          isLeap: isLeap,
          yearStr: yearStr,
          monthStr: monthStr,
          dayStr: dayStr,
          fullStr: yearStr + monthStr + dayStr
        };
      }
    };
	

// Convert lunar to solar (simplified, for 1900-2100)
function lunar2solar(lunar) {
  for (let y = lunar.year - 1; y <= lunar.year + 1; y++) {
    for (let m = 1; m <= 12; m++) {
      for (let d = 1; d <= 31; d++) {
        const date = new Date(y, m - 1, d);
        if (date.getFullYear() !== y || date.getMonth() + 1 !== m || date.getDate() !== d) continue;
        const l = lunarCalendar.solar2lunar(y, m, d);
        if (
          l &&
          l.year === lunar.year &&
          l.month === lunar.month &&
          l.day === lunar.day &&
          l.isLeap === lunar.isLeap
        ) {
          return { year: y, month: m, day: d };
        }
      }
    }
  }
  return null;
}

// Add a period to a lunar date
function addLunarPeriod(lunar, periodValue, periodUnit) {
  let { year, month, day, isLeap } = lunar;
  if (periodUnit === 'year') {
    year += periodValue;
    const leap = lunarCalendar.leapMonth(year);
    isLeap = isLeap && leap === month;
  } else if (periodUnit === 'month') {
    let totalMonths = (year - 1900) * 12 + (month - 1) + periodValue;
    year = Math.floor(totalMonths / 12) + 1900;
    month = (totalMonths % 12) + 1;
    const leap = lunarCalendar.leapMonth(year);
    isLeap = isLeap && leap === month;
  } else if (periodUnit === 'day') {
    const solar = lunar2solar(lunar);
    const date = new Date(solar.year, solar.month - 1, solar.day + periodValue);
    return lunarCalendar.solar2lunar(date.getFullYear(), date.getMonth() + 1, date.getDate());
  }
  let maxDay = isLeap
    ? lunarCalendar.leapDays(year)
    : lunarCalendar.monthDays(year, month);
  let targetDay = Math.min(day, maxDay);
  while (targetDay > 0) {
    let solar = lunar2solar({ year, month, day: targetDay, isLeap });
    if (solar) {
      return { year, month, day: targetDay, isLeap };
    }
    targetDay--;
  }
  return { year, month, day, isLeap };
}



    // Lunar display related functions
    function updateLunarDisplay(dateInputId, lunarDisplayId) {
      const dateInput = document.getElementById(dateInputId);
      const lunarDisplay = document.getElementById(lunarDisplayId);
      const showLunar = document.getElementById('showLunar');

      if (!dateInput.value || !showLunar.checked) {
        lunarDisplay.classList.remove('show');
        return;
      }

      const date = new Date(dateInput.value);
      const lunar = lunarCalendar.solar2lunar(date.getFullYear(), date.getMonth() + 1, date.getDate());

      if (lunar) {
        lunarDisplay.textContent = '农历：' + lunar.fullStr;
        lunarDisplay.classList.add('show');
      } else {
        lunarDisplay.classList.remove('show');
      }
    }

    function toggleLunarDisplay() {
      const showLunar = document.getElementById('showLunar');
      updateLunarDisplay('startDate', 'startDateLunar');
      updateLunarDisplay('expiryDate', 'expiryDateLunar');

      // Save user preference
      localStorage.setItem('showLunar', showLunar.checked);
    }

    function loadLunarPreference() {
      const showLunar = document.getElementById('showLunar');
      const saved = localStorage.getItem('showLunar');
      if (saved !== null) {
        showLunar.checked = saved === 'true';
      } else {
        showLunar.checked = true; // Default to show
      }
      toggleLunarDisplay();
    }

    function handleListLunarToggle() {
      const listShowLunar = document.getElementById('listShowLunar');
      // Save user preference
      localStorage.setItem('showLunar', listShowLunar.checked);
      // Reload subscription list to apply lunar display settings
      loadSubscriptions();
    }

    function showToast(message, type = 'success', duration = 3000) {
      const container = document.getElementById('toast-container');
      const toast = document.createElement('div');
      toast.className = 'toast ' + type;
      
      const icon = type === 'success' ? 'check-circle' :
                   type === 'error' ? 'exclamation-circle' :
                   type === 'warning' ? 'exclamation-triangle' : 'info-circle';
      
      toast.innerHTML = '<div class="flex items-center"><i class="fas fa-' + icon + ' mr-2"></i><span>' + message + '</span></div>';
      
      container.appendChild(toast);
      setTimeout(() => toast.classList.add('show'), 100);
      setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
          if (container.contains(toast)) {
            container.removeChild(toast);
          }
        }, 300);
      }, duration);
    }

    function showFieldError(fieldId, message) {
      const field = document.getElementById(fieldId);
      const errorDiv = field.parentElement.querySelector('.error-message');
      if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.classList.add('show');
        field.classList.add('border-red-500');
      }
    }

    function clearFieldErrors() {
      document.querySelectorAll('.error-message').forEach(el => {
        el.classList.remove('show');
        el.textContent = '';
      });
      document.querySelectorAll('.border-red-500').forEach(el => {
        el.classList.remove('border-red-500');
      });
    }

    function validateForm() {
      clearFieldErrors();
      let isValid = true;

      const name = document.getElementById('name').value.trim();
      if (!name) {
        showFieldError('name', '请输入订阅名称');
        isValid = false;
      }

      const periodValue = document.getElementById('periodValue').value;
      if (!periodValue || periodValue < 1) {
        showFieldError('periodValue', '周期数值必须大于0');
        isValid = false;
      }

      const expiryDate = document.getElementById('expiryDate').value;
      if (!expiryDate) {
        showFieldError('expiryDate', '请选择到期日期');
        isValid = false;
      }

      const reminderDays = document.getElementById('reminderDays').value;
      if (reminderDays === '' || reminderDays < 0) {
        showFieldError('reminderDays', '提醒天数不能为负数');
        isValid = false;
      }

      return isValid;
    }

    // Create text element with hover tooltip
    function createHoverText(text, maxLength = 30, className = 'text-sm text-gray-900') {
      if (!text || text.length <= maxLength) {
        return '<div class="' + className + '">' + text + '</div>';
      }

      const truncated = text.substring(0, maxLength) + '...';
      return '<div class="hover-container">' +
        '<div class="hover-text ' + className + '" data-full-text="' + text.replace(/"/g, '&quot;') + '">' +
          truncated +
        '</div>' +
        '<div class="hover-tooltip"></div>' +
      '</div>';
    }

    // Get all subscriptions and sort by expiry date
    async function loadSubscriptions() {
      try {
        // Load lunar display preference
        const listShowLunar = document.getElementById('listShowLunar');
        const saved = localStorage.getItem('showLunar');
        if (saved !== null) {
          listShowLunar.checked = saved === 'true';
        } else {
          listShowLunar.checked = true; // Default to show
        }

        const tbody = document.getElementById('subscriptionsBody');
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4"><i class="fas fa-spinner fa-spin mr-2"></i>加载中...</td></tr>';

        const response = await fetch('/api/subscriptions');
        const data = await response.json();
        
        tbody.innerHTML = '';
        
        if (data.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-gray-500">没有订阅数据</td></tr>';
          document.getElementById('statusSummary').innerHTML = '';
          return;
        }
        
        // Sort by expiry date ascending (earliest expiring first)
        data.sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));
        
        // ==== Status statistics ====
        let total = data.length;
        let active = 0, expired = 0, upcoming = 0, stopped = 0;
        
        data.forEach(subscription => {
          const expiryDate = new Date(subscription.expiryDate);
          const now = new Date();
          const daysDiff = Math.ceil((expiryDate - now) / (1000*60*60*24));
        
          if (!subscription.isActive) {
            stopped++;
          } else if (daysDiff < 0) {
            expired++;
          } else if (daysDiff <= (subscription.reminderDays || 7)) {
            upcoming++;
          } else {
            active++;
          }
        });
        
        const statusSummaryEl = document.getElementById('statusSummary');
        if (statusSummaryEl) {
          statusSummaryEl.innerHTML =  
          '<span class="mr-4">总数: <strong>' + total + '</strong></span>' +
          '<span class="text-green-600 mr-4">正常: ' + active + '</span>' +
          '<span class="text-yellow-600 mr-4">即将到期: ' + upcoming + '</span>' +
          '<span class="text-red-600 mr-4">已过期: ' + expired + '</span>' +
          '<span class="text-gray-600">已停用: ' + stopped + '</span>';
        } else {
          console.error('Status summary element not found');
        }
        // ==== End of statistics ====
        

        
		// Add calendar type
        data.forEach((subscription, index)  => {
          const row = document.createElement('tr');
          row.className = subscription.isActive === false ? 'hover:bg-gray-50 bg-gray-100' : 'hover:bg-gray-50';
          
		  // Calendar type display
		  let calendarTypeHtml = '';
		  if (subscription.useLunar) {
			calendarTypeHtml = '<div class="text-xs text-purple-600 mt-1">日历类型：农历</div>';
		  } else {
			calendarTypeHtml = '<div class="text-xs text-gray-600 mt-1">日历类型：公历</div>';
		  }
		  
          const expiryDate = new Date(subscription.expiryDate);
          const now = new Date();
          const daysDiff = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
          
          let statusHtml = '';
          if (!subscription.isActive) {
            statusHtml = '<span class="px-2 py-1 text-xs font-medium rounded-full text-white bg-gray-500"><i class="fas fa-pause-circle mr-1"></i>已停用</span>';
          } else if (daysDiff < 0) {
            statusHtml = '<span class="px-2 py-1 text-xs font-medium rounded-full text-white bg-red-500"><i class="fas fa-exclamation-circle mr-1"></i>已过期</span>';
          } else if (daysDiff <= (subscription.reminderDays || 7)) {
            statusHtml = '<span class="px-2 py-1 text-xs font-medium rounded-full text-white bg-yellow-500"><i class="fas fa-exclamation-triangle mr-1"></i>即将到期</span>';
          } else {
            statusHtml = '<span class="px-2 py-1 text-xs font-medium rounded-full text-white bg-green-500"><i class="fas fa-check-circle mr-1"></i>正常</span>';
          }
          
          let periodText = '';
          if (subscription.periodValue && subscription.periodUnit) {
            const unitMap = { day: '天', month: '月', year: '年' };
            periodText = subscription.periodValue + ' ' + (unitMap[subscription.periodUnit] || subscription.periodUnit);
          }
          
          const autoRenewIcon = subscription.autoRenew !== false ? 
            '<i class="fas fa-sync-alt text-blue-500 ml-1" title="自动续订"></i>' : 
            '<i class="fas fa-ban text-gray-400 ml-1" title="不自动续订"></i>';
          
          // Check if lunar should be displayed
          const showLunar = document.getElementById('listShowLunar').checked;
          let lunarExpiryText = '';
          let startLunarText = '';

          if (showLunar) {
            // Calculate lunar date
            const expiryDateObj = new Date(subscription.expiryDate);
            const lunarExpiry = lunarCalendar.solar2lunar(expiryDateObj.getFullYear(), expiryDateObj.getMonth() + 1, expiryDateObj.getDate());
            lunarExpiryText = lunarExpiry ? lunarExpiry.fullStr : '';

            if (subscription.startDate) {
              const startDateObj = new Date(subscription.startDate);
              const lunarStart = lunarCalendar.solar2lunar(startDateObj.getFullYear(), startDateObj.getMonth() + 1, startDateObj.getDate());
              startLunarText = lunarStart ? lunarStart.fullStr : '';
            }
          }

          // Handle notes display
          let notesHtml = '';
          if (subscription.notes) {
            const notes = subscription.notes;
            if (notes.length > 50) {
              const truncatedNotes = notes.substring(0, 50) + '...';
              notesHtml = '<div class="notes-container">' +
                '<div class="notes-text text-xs text-gray-500" data-full-notes="' + notes.replace(/"/g, '&quot;') + '">' +
                  truncatedNotes +
                '</div>' +
                '<div class="notes-tooltip"></div>' +
              '</div>';
            } else {
              notesHtml = '<div class="text-xs text-gray-500">' + notes + '</div>';
            }
          }

		  // Generate content for each column
		  const nameHtml = createHoverText(subscription.name, 20, 'text-sm font-medium text-gray-900');
		  const typeHtml = createHoverText((subscription.customType || '其他'), 15, 'text-sm text-gray-900');
		  const periodHtml = periodText ? createHoverText('周期: ' + periodText, 20, 'text-xs text-gray-500 mt-1') : '';

          // Expiry date related info
          const expiryDateText = formatBeijingTime(new Date(subscription.expiryDate), 'date');
          const lunarHtml = lunarExpiryText ? createHoverText('农历: ' + lunarExpiryText, 25, 'text-xs text-blue-600 mt-1') : '';
          const daysLeftText = daysDiff < 0 ? '已过期' + Math.abs(daysDiff) + '天' : '还剩' + daysDiff + '天';
          const startDateText = subscription.startDate ?
            '开始: ' + formatBeijingTime(new Date(subscription.startDate), 'date') + (startLunarText ? ' (' + startLunarText + ')' : '') : '';
          const startDateHtml = startDateText ? createHoverText(startDateText, 30, 'text-xs text-gray-500 mt-1') : '';

		  // Modify calendar type
		  row.innerHTML =
      '<td data-label="序列" class="px-4 py-3"><div class="td-content-wrapper">' + (index + 1) + '</td>' +   // Auto index
			'<td data-label="名称" class="px-4 py-3"><div class="td-content-wrapper">' +
			  nameHtml +
			  notesHtml +
			'</div></td>' +
			'<td data-label="类型" class="px-4 py-3"><div class="td-content-wrapper">' +
			  '<div class="flex items-center"><i class="fas fa-tag mr-1"></i><span>' + typeHtml + '</span></div>' +
			  (periodHtml ? '<div class="flex items-center">' + periodHtml + autoRenewIcon + '</div>' : '') +
			  calendarTypeHtml + // Add: calendar type
			'</div></td>' +
			'<td data-label="到期时间" class="px-4 py-3"><div class="td-content-wrapper">' +
			  '<div class="text-sm text-gray-900">' + expiryDateText + '</div>' +
			  lunarHtml +
			  '<div class="text-xs text-gray-500 mt-1">' + daysLeftText + '</div>' +
			  startDateHtml +
			'</div></td>' +
			'<td data-label="提醒设置" class="px-4 py-3"><div class="td-content-wrapper">' +
			  '<div><i class="fas fa-bell mr-1"></i>提前' + (subscription.reminderDays || 0) + '天</div>' +
			  (subscription.reminderDays === 0 ? '<div class="text-xs text-gray-500 mt-1">仅到期日提醒</div>' : '') +
			'</div></td>' +
			'<td data-label="状态" class="px-4 py-3"><div class="td-content-wrapper">' + statusHtml + '</div></td>' +
			'<td data-label="操作" class="px-4 py-3">' +
			  '<div class="action-buttons-wrapper">' +
				'<button class="edit btn-primary text-white px-2 py-1 rounded text-xs whitespace-nowrap" data-id="' + subscription.id + '"><i class="fas fa-edit mr-1"></i>编辑</button>' +
				'<button class="test-notify btn-info text-white px-2 py-1 rounded text-xs whitespace-nowrap" data-id="' + subscription.id + '"><i class="fas fa-paper-plane mr-1"></i>测试</button>' +
				'<button class="delete btn-danger text-white px-2 py-1 rounded text-xs whitespace-nowrap" data-id="' + subscription.id + '"><i class="fas fa-trash-alt mr-1"></i>删除</button>' +
				(subscription.isActive ?
				  '<button class="toggle-status btn-warning text-white px-2 py-1 rounded text-xs whitespace-nowrap" data-id="' + subscription.id + '" data-action="deactivate"><i class="fas fa-pause-circle mr-1"></i>停用</button>' :
				  '<button class="toggle-status btn-success text-white px-2 py-1 rounded text-xs whitespace-nowrap" data-id="' + subscription.id + '" data-action="activate"><i class="fas fa-play-circle mr-1"></i>启用</button>') +
			  '</div>' +
			'</td>';

		  tbody.appendChild(row);
        });
        
        document.querySelectorAll('.edit').forEach(button => {
          button.addEventListener('click', editSubscription);
        });
        
        document.querySelectorAll('.delete').forEach(button => {
          button.addEventListener('click', deleteSubscription);
        });
        
        document.querySelectorAll('.toggle-status').forEach(button => {
          button.addEventListener('click', toggleSubscriptionStatus);
        });

        document.querySelectorAll('.test-notify').forEach(button => {
          button.addEventListener('click', testSubscriptionNotification);
        });

        document.addEventListener('click', function (e) {
          if (e.target.classList.contains('notes-text')) {
            let text = e.target.innerText.trim();
            if (text.startsWith('http')) {
              let choice = confirm("点击【确定】在新页面打开，点击【取消】复制网址");
              if (choice) {
                // 在新页面打开
                window.open(text, '_blank');
              } else {
                // 复制到剪贴板
                navigator.clipboard.writeText(text).then(() => {
                  alert("网址已复制");
                }).catch(err => {
                  console.error("复制失败:", err);
                });
              }
            }
          }
        });


        // Add hover functionality
        function addHoverListeners() {
          // Calculate tooltip position
          function positionTooltip(element, tooltip) {
            const rect = element.getBoundingClientRect();
            const tooltipHeight = 100; // Estimated height
            const viewportHeight = window.innerHeight;
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

            let top = rect.bottom + scrollTop + 8;
            let left = rect.left;

            // If not enough space below, show above
            if (rect.bottom + tooltipHeight > viewportHeight) {
              top = rect.top + scrollTop - tooltipHeight - 8;
              tooltip.style.transform = 'translateY(10px)';
              // Adjust arrow position
              tooltip.classList.add('tooltip-above');
            } else {
              tooltip.style.transform = 'translateY(-10px)';
              tooltip.classList.remove('tooltip-above');
            }

            // Ensure not out of right boundary
            const maxLeft = window.innerWidth - 320 - 20;
            if (left > maxLeft) {
              left = maxLeft;
            }

            tooltip.style.left = left + 'px';
            tooltip.style.top = top + 'px';
          }

          // Notes hover functionality
          document.querySelectorAll('.notes-text').forEach(notesElement => {
            const fullNotes = notesElement.getAttribute('data-full-notes');
            const tooltip = notesElement.parentElement.querySelector('.notes-tooltip');

            if (fullNotes && tooltip) {
              notesElement.addEventListener('mouseenter', () => {
                tooltip.textContent = fullNotes;
                positionTooltip(notesElement, tooltip);
                tooltip.classList.add('show');
              });

              notesElement.addEventListener('mouseleave', () => {
                tooltip.classList.remove('show');
              });

              // Hide tooltip on scroll
              window.addEventListener('scroll', () => {
                if (tooltip.classList.contains('show')) {
                  tooltip.classList.remove('show');
                }
              }, { passive: true });
            }
          });

          // General hover functionality
          document.querySelectorAll('.hover-text').forEach(hoverElement => {
            const fullText = hoverElement.getAttribute('data-full-text');
            const tooltip = hoverElement.parentElement.querySelector('.hover-tooltip');

            if (fullText && tooltip) {
              hoverElement.addEventListener('mouseenter', () => {
                tooltip.textContent = fullText;
                positionTooltip(hoverElement, tooltip);
                tooltip.classList.add('show');
              });

              hoverElement.addEventListener('mouseleave', () => {
                tooltip.classList.remove('show');
              });

              // Hide tooltip on scroll
              window.addEventListener('scroll', () => {
                if (tooltip.classList.contains('show')) {
                  tooltip.classList.remove('show');
                }
              }, { passive: true });
            }
          });
        }

        addHoverListeners();

        // Add lunar switch event listener
        listShowLunar.removeEventListener('change', handleListLunarToggle);
        listShowLunar.addEventListener('change', handleListLunarToggle);
      } catch (error) {
        console.error('Failed to load subscriptions:', error);
        const tbody = document.getElementById('subscriptionsBody');
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-red-500"><i class="fas fa-exclamation-circle mr-2"></i>Failed to load, please refresh the page to try again</td></tr>';
        showToast('Failed to load subscription list', 'error');
      }
    }
    
    async function testSubscriptionNotification(e) {
        const button = e.target.closest('button');
        const id = button.dataset.id;
        const originalContent = button.innerHTML;
        button.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>';
        button.disabled = true;

        try {
            const response = await fetch('/api/subscriptions/' + id + '/test-notify', { method: 'POST' });
            const result = await response.json();
            if (result.success) {
                showToast(result.message || 'Test notification sent', 'success');
            } else {
                showToast(result.message || 'Failed to send test notification', 'error');
            }
        } catch (error) {
            console.error('Test notification failed:', error);
            showToast('An error occurred while sending the test notification', 'error');
        } finally {
            button.innerHTML = originalContent;
            button.disabled = false;
        }
    }
    
    async function toggleSubscriptionStatus(e) {
      const button = e.target.closest('button');
      const id = button.dataset.id;
      const action = button.dataset.action;
      const isActivate = action === 'activate';
      
      const originalContent = button.innerHTML;
      button.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>' + (isActivate ? 'Enabling...' : 'Disabling...');
      button.disabled = true;
      
      try {
        const response = await fetch('/api/subscriptions/' + id + '/toggle-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive: isActivate })
        });
        
        if (response.ok) {
          showToast((isActivate ? 'Enable' : 'Disable') + ' successful', 'success');
          loadSubscriptions();
        } else {
          const error = await response.json();
          showToast((isActivate ? 'Enable' : 'Disable') + ' failed: ' + (error.message || 'Unknown error'), 'error');
          button.innerHTML = originalContent;
          button.disabled = false;
        }
      } catch (error) {
        console.error((isActivate ? 'Enable' : 'Disable') + ' subscription failed:', error);
        showToast((isActivate ? 'Enable' : 'Disable') + ' failed, please try again later', 'error');
        button.innerHTML = originalContent;
        button.disabled = false;
      }
    }
    
    document.getElementById('addSubscriptionBtn').addEventListener('click', () => {
      document.getElementById('modalTitle').textContent = 'Add New Subscription';
      document.getElementById('subscriptionModal').classList.remove('hidden');

      document.getElementById('subscriptionForm').reset();
      document.getElementById('subscriptionId').value = '';
      clearFieldErrors();

      const today = new Date().toISOString().split('T')[0];
      document.getElementById('startDate').value = today;
      document.getElementById('reminderDays').value = '7';
      document.getElementById('isActive').checked = true;
      document.getElementById('autoRenew').checked = true;

      loadLunarPreference();
      calculateExpiryDate();
      setupModalEventListeners();
    });
    
    function setupModalEventListeners() {
      const calculateBtn = document.getElementById('calculateExpiryBtn');
      calculateBtn.removeEventListener('click', calculateExpiryDate);
      calculateBtn.addEventListener('click', calculateExpiryDate);
	  
      const useLunarCheckbox = document.getElementById('useLunar');
      useLunarCheckbox.removeEventListener('change', calculateExpiryDate);
      useLunarCheckbox.addEventListener('change', calculateExpiryDate);

      ['startDate', 'periodValue', 'periodUnit'].forEach(id => {
        const element = document.getElementById(id);
        element.removeEventListener('change', calculateExpiryDate);
        element.addEventListener('change', calculateExpiryDate);
      });
      
      const showLunarCheckbox = document.getElementById('showLunar');
      showLunarCheckbox.removeEventListener('change', toggleLunarDisplay);
      showLunarCheckbox.addEventListener('change', toggleLunarDisplay);

      const startDateInput = document.getElementById('startDate');
      startDateInput.removeEventListener('change', () => updateLunarDisplay('startDate', 'startDateLunar'));
      startDateInput.addEventListener('change', () => updateLunarDisplay('startDate', 'startDateLunar'));

      const expiryDateInput = document.getElementById('expiryDate');
      expiryDateInput.removeEventListener('change', () => updateLunarDisplay('expiryDate', 'expiryDateLunar'));
      expiryDateInput.addEventListener('change', () => updateLunarDisplay('expiryDate', 'expiryDateLunar'));

      document.getElementById('cancelBtn').addEventListener('click', () => {
        document.getElementById('subscriptionModal').classList.add('hidden');
      });
    }

	// 3. calculateExpiryDate function, supports lunar period calculation
	function calculateExpiryDate() {
	  const startDate = document.getElementById('startDate').value;
	  const periodValue = parseInt(document.getElementById('periodValue').value);
	  const periodUnit = document.getElementById('periodUnit').value;
	  const useLunar = document.getElementById('useLunar').checked;

	  if (!startDate || !periodValue || !periodUnit) {
		return;
	  }

	  if (useLunar) {
		// Lunar calculation
		const start = new Date(startDate);
		const lunar = lunarCalendar.solar2lunar(start.getFullYear(), start.getMonth() + 1, start.getDate());
		if (!lunar) return; // Exit if date is out of range
		let nextLunar = addLunarPeriod(lunar, periodValue, periodUnit);
		const solar = lunar2solar(nextLunar);
		if (!solar) return; // Exit if conversion fails
		
        const expiry = new Date(solar.year, solar.month - 1, solar.day);
		document.getElementById('expiryDate').value = expiry.toISOString().split('T')[0];
	  } else {
		// Solar calculation
		const start = new Date(startDate);
		const expiry = new Date(start);
		if (periodUnit === 'day') {
		  expiry.setDate(start.getDate() + periodValue);
		} else if (periodUnit === 'month') {
		  expiry.setMonth(start.getMonth() + periodValue);
		} else if (periodUnit === 'year') {
		  expiry.setFullYear(start.getFullYear() + periodValue);
		}
		document.getElementById('expiryDate').value = expiry.toISOString().split('T')[0];
	  }

	  // Update lunar display
	  updateLunarDisplay('startDate', 'startDateLunar');
	  updateLunarDisplay('expiryDate', 'expiryDateLunar');
	}
    
    document.getElementById('closeModal').addEventListener('click', () => {
      document.getElementById('subscriptionModal').classList.add('hidden');
    });
    
	// 4. Listen for useLunar checkbox changes to recalculate
	document.getElementById('useLunar').addEventListener('change', calculateExpiryDate);
   
   // Include useLunar field on form submission
    document.getElementById('subscriptionForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      if (!validateForm()) {
        return;
      }
      
      const id = document.getElementById('subscriptionId').value;
      const subscription = {
        name: document.getElementById('name').value.trim(),
        customType: document.getElementById('customType').value.trim(),
        notes: document.getElementById('notes').value.trim() || '',
        isActive: document.getElementById('isActive').checked,
        autoRenew: document.getElementById('autoRenew').checked,
        startDate: document.getElementById('startDate').value,
        expiryDate: document.getElementById('expiryDate').value,
        periodValue: parseInt(document.getElementById('periodValue').value),
        periodUnit: document.getElementById('periodUnit').value,
        reminderDays: parseInt(document.getElementById('reminderDays').value) || 0,
		useLunar: document.getElementById('useLunar').checked
      };
      
      const submitButton = e.target.querySelector('button[type="submit"]');
      const originalContent = submitButton.innerHTML;
      submitButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>' + (id ? 'Updating...' : 'Saving...');
      submitButton.disabled = true;
      
      try {
        const url = id ? '/api/subscriptions/' + id : '/api/subscriptions';
        const method = id ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
          method: method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(subscription)
        });
        
        const result = await response.json();
        
        if (result.success) {
          showToast((id ? 'Update' : 'Add') + ' subscription successful', 'success');
          document.getElementById('subscriptionModal').classList.add('hidden');
          loadSubscriptions();
        } else {
          showToast((id ? 'Update' : 'Add') + ' subscription failed: ' + (result.message || 'Unknown error'), 'error');
        }
      } catch (error) {
        console.error((id ? 'Update' : 'Add') + ' subscription failed:', error);
        showToast((id ? 'Update' : 'Add') + ' subscription failed, please try again later', 'error');
      } finally {
        submitButton.innerHTML = originalContent;
        submitButton.disabled = false;
      }
    });
    
	// Populate useLunar field when editing
    async function editSubscription(e) {
      const id = e.target.closest('button').dataset.id;
      
      try {
        const response = await fetch('/api/subscriptions/' + id);
        const subscription = await response.json();
        
        if (subscription) {
          document.getElementById('modalTitle').textContent = 'Edit Subscription';
          document.getElementById('subscriptionId').value = subscription.id;
          document.getElementById('name').value = subscription.name;
          document.getElementById('customType').value = subscription.customType || '';
          document.getElementById('notes').value = subscription.notes || '';
          document.getElementById('isActive').checked = subscription.isActive;
          document.getElementById('autoRenew').checked = subscription.autoRenew;
          document.getElementById('startDate').value = subscription.startDate ? subscription.startDate.split('T')[0] : '';
          document.getElementById('expiryDate').value = subscription.expiryDate ? subscription.expiryDate.split('T')[0] : '';
          document.getElementById('periodValue').value = subscription.periodValue || 1;
          document.getElementById('periodUnit').value = subscription.periodUnit || 'month';
          document.getElementById('reminderDays').value = subscription.reminderDays !== undefined ? subscription.reminderDays : 7;
		  document.getElementById('useLunar').checked = !!subscription.useLunar;
          
          clearFieldErrors();
          loadLunarPreference();
          document.getElementById('subscriptionModal').classList.remove('hidden');
          setupModalEventListeners();

          // Update lunar display
          setTimeout(() => {
            updateLunarDisplay('startDate', 'startDateLunar');
            updateLunarDisplay('expiryDate', 'expiryDateLunar');
          }, 100);
        }
      } catch (error) {
        console.error('Failed to get subscription info:', error);
        showToast('Failed to get subscription info', 'error');
      }
    }
    
    async function deleteSubscription(e) {
      const button = e.target.closest('button');
      const id = button.dataset.id;
      
      if (!confirm('Are you sure you want to delete this subscription? This action cannot be undone.')) {
        return;
      }
      
      const originalContent = button.innerHTML;
      button.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Deleting...';
      button.disabled = true;
      
      try {
        const response = await fetch('/api/subscriptions/' + id, {
          method: 'DELETE'
        });
        
        if (response.ok) {
          showToast('Deletion successful', 'success');
          loadSubscriptions();
        } else {
          const error = await response.json();
          showToast('Deletion failed: ' + (error.message || 'Unknown error'), 'error');
          button.innerHTML = originalContent;
          button.disabled = false;
        }
      } catch (error) {
        console.error('Failed to delete subscription:', error);
        showToast('Deletion failed, please try again later', 'error');
        button.innerHTML = originalContent;
        button.disabled = false;
      }
    }
    
    window.addEventListener('load', loadSubscriptions);
  </script>
</body>
</html>
`;

const configPage = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>系统配置 - 订阅管理系统</title>
  <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css" rel="stylesheet">
  <style>
    .btn-primary { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); transition: all 0.3s; }
    .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1); }
    .btn-secondary { background: linear-gradient(135deg, #6b7280 0%, #4b5563 100%); transition: all 0.3s; }
    .btn-secondary:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1); }
    
    .toast {
      position: fixed; top: 20px; right: 20px; padding: 12px 20px; border-radius: 8px;
      color: white; font-weight: 500; z-index: 1000; transform: translateX(400px);
      transition: all 0.3s ease-in-out; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }
    .toast.show { transform: translateX(0); }
    .toast.success { background-color: #10b981; }
    .toast.error { background-color: #ef4444; }
    .toast.info { background-color: #3b82f6; }
    .toast.warning { background-color: #f59e0b; }
    
    .config-section { 
      border: 1px solid #e5e7eb; 
      border-radius: 8px; 
      padding: 16px; 
      margin-bottom: 24px; 
    }
    .config-section.active { 
      background-color: #f8fafc; 
      border-color: #6366f1; 
    }
    .config-section.inactive { 
      background-color: #f9fafb; 
      opacity: 0.7; 
    }
  </style>
</head>
<body class="bg-gray-100 min-h-screen">
  <div id="toast-container"></div>

  <nav class="bg-white shadow-md">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex justify-between h-16">
        <div class="flex items-center">
          <i class="fas fa-calendar-check text-indigo-600 text-2xl mr-2"></i>
          <span class="font-bold text-xl text-gray-800">订阅管理系统</span>
        </div>
        <div class="flex items-center space-x-4">
          <a href="/admin" class="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium">
            <i class="fas fa-list mr-1"></i>订阅列表
          </a>
          <a href="/admin/config" class="text-indigo-600 border-b-2 border-indigo-600 px-3 py-2 rounded-md text-sm font-medium">
            <i class="fas fa-cog mr-1"></i>系统配置
          </a>
          <a href="/api/logout" class="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium">
            <i class="fas fa-sign-out-alt mr-1"></i>退出登录
          </a>
        </div>
      </div>
    </div>
  </nav>
  
  <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <div class="bg-white rounded-lg shadow-md p-6">
      <h2 class="text-2xl font-bold text-gray-800 mb-6">系统配置</h2>
      
      <form id="configForm" class="space-y-8">
        <div class="border-b border-gray-200 pb-6">
          <h3 class="text-lg font-medium text-gray-900 mb-4">管理员账户</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label for="adminUsername" class="block text-sm font-medium text-gray-700">用户名</label>
              <input type="text" id="adminUsername" class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
            </div>
            <div>
              <label for="adminPassword" class="block text-sm font-medium text-gray-700">密码</label>
              <input type="password" id="adminPassword" placeholder="如不修改密码，请留空" class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
              <p class="mt-1 text-sm text-gray-500">留空表示不修改当前密码</p>
            </div>
          </div>
        </div>
        
        <div class="border-b border-gray-200 pb-6">
          <h3 class="text-lg font-medium text-gray-900 mb-4">显示设置</h3>
          <div class="mb-6">
            <label class="inline-flex items-center">
              <input type="checkbox" id="showLunarGlobal" class="form-checkbox h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500" checked>
              <span class="ml-2 text-sm text-gray-700">在通知中显示农历日期</span>
            </label>
            <p class="mt-1 text-sm text-gray-500">控制是否在通知消息中包含农历日期信息</p>
          </div>
        </div>

        <div class="border-b border-gray-200 pb-6">
          <h3 class="text-lg font-medium text-gray-900 mb-4">通知设置</h3>
          <div class="mb-6">
            <label class="block text-sm font-medium text-gray-700 mb-3">通知方式（可多选）</label>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label class="inline-flex items-center">
                <input type="checkbox" name="enabledNotifiers" value="telegram" class="form-checkbox h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500">
                <span class="ml-2 text-sm text-gray-700">Telegram</span>
              </label>
              <label class="inline-flex items-center">
                <input type="checkbox" name="enabledNotifiers" value="notifyx" class="form-checkbox h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500" checked>
                <span class="ml-2 text-sm text-gray-700 font-semibold">NotifyX</span>
              </label>
              <label class="inline-flex items-center">
                <input type="checkbox" name="enabledNotifiers" value="webhook" class="form-checkbox h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500">
                <span class="ml-2 text-sm text-gray-700">企业微信应用通知</span>
              </label>
              <label class="inline-flex items-center">
                <input type="checkbox" name="enabledNotifiers" value="wechatbot" class="form-checkbox h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500">
                <span class="ml-2 text-sm text-gray-700">企业微信机器人</span>
              </label>
              <label class="inline-flex items-center">
                <input type="checkbox" name="enabledNotifiers" value="email" class="form-checkbox h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500">
                <span class="ml-2 text-sm text-gray-700">邮件通知</span>
              </label>
            </div>
            <div class="mt-2 flex flex-wrap gap-4">
              <a href="https://www.notifyx.cn/" target="_blank" class="text-indigo-600 hover:text-indigo-800 text-sm">
                <i class="fas fa-external-link-alt ml-1"></i> NotifyX官网
              </a>
              <a href="https://push.wangwangit.com" target="_blank" class="text-indigo-600 hover:text-indigo-800 text-sm">
                <i class="fas fa-external-link-alt ml-1"></i> 企业微信应用通知官网
              </a>
              <a href="https://developer.work.weixin.qq.com/document/path/91770" target="_blank" class="text-indigo-600 hover:text-indigo-800 text-sm">
                <i class="fas fa-external-link-alt ml-1"></i> 企业微信机器人文档
              </a>
              <a href="https://developers.cloudflare.com/workers/tutorials/send-emails-with-resend/" target="_blank" class="text-indigo-600 hover:text-indigo-800 text-sm">
                <i class="fas fa-external-link-alt ml-1"></i> 获取 Resend API Key
              </a>
            </div>
          </div>
          
          <div id="telegramConfig" class="config-section">
            <h4 class="text-md font-medium text-gray-900 mb-3">Telegram 配置</h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label for="tgBotToken" class="block text-sm font-medium text-gray-700">Bot Token</label>
                <input type="text" id="tgBotToken" placeholder="从 @BotFather 获取" class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
              </div>
              <div>
                <label for="tgChatId" class="block text-sm font-medium text-gray-700">Chat ID</label>
                <input type="text" id="tgChatId" placeholder="可从 @userinfobot 获取" class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
              </div>
            </div>
            <div class="flex justify-end">
              <button type="button" id="testTelegramBtn" class="btn-secondary text-white px-4 py-2 rounded-md text-sm font-medium">
                <i class="fas fa-paper-plane mr-2"></i>测试 Telegram 通知
              </button>
            </div>
          </div>
          
          <div id="notifyxConfig" class="config-section">
            <h4 class="text-md font-medium text-gray-900 mb-3">NotifyX 配置</h4>
            <div class="mb-4">
              <label for="notifyxApiKey" class="block text-sm font-medium text-gray-700">API Key</label>
              <input type="text" id="notifyxApiKey" placeholder="从 NotifyX 平台获取的 API Key" class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
              <p class="mt-1 text-sm text-gray-500">从 <a href="https://www.notifyx.cn/" target="_blank" class="text-indigo-600 hover:text-indigo-800">NotifyX平台</a> 获取的 API Key</p>
            </div>
            <div class="flex justify-end">
              <button type="button" id="testNotifyXBtn" class="btn-secondary text-white px-4 py-2 rounded-md text-sm font-medium">
                <i class="fas fa-paper-plane mr-2"></i>测试 NotifyX 通知
              </button>
            </div>
          </div>

          <div id="webhookConfig" class="config-section">
            <h4 class="text-md font-medium text-gray-900 mb-3">企业微信应用通知 配置</h4>
            <div class="grid grid-cols-1 gap-4 mb-4">
              <div>
                <label for="webhookUrl" class="block text-sm font-medium text-gray-700">企业微信应用通知 URL</label>
                <input type="url" id="webhookUrl" placeholder="https://push.wangwangit.com/api/send/your-key" class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
                <p class="mt-1 text-sm text-gray-500">从 <a href="https://push.wangwangit.com" target="_blank" class="text-indigo-600 hover:text-indigo-800">企业微信应用通知平台</a> 获取的推送URL</p>
              </div>
              <div>
                <label for="webhookMethod" class="block text-sm font-medium text-gray-700">请求方法</label>
                <select id="webhookMethod" class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
                  <option value="POST">POST</option>
                  <option value="GET">GET</option>
                  <option value="PUT">PUT</option>
                </select>
              </div>
              <div>
                <label for="webhookHeaders" class="block text-sm font-medium text-gray-700">自定义请求头 (JSON格式，可选)</label>
                <textarea id="webhookHeaders" rows="3" placeholder='{"Authorization": "Bearer your-token", "Content-Type": "application/json"}' class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"></textarea>
                <p class="mt-1 text-sm text-gray-500">JSON格式的自定义请求头，留空使用默认</p>
              </div>
              <div>
                <label for="webhookTemplate" class="block text-sm font-medium text-gray-700">消息模板 (JSON格式，可选)</label>
                <textarea id="webhookTemplate" rows="4" placeholder='{"title": "{{title}}", "content": "{{content}}", "timestamp": "{{timestamp}}"}' class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"></textarea>
                <p class="mt-1 text-sm text-gray-500">支持变量: {{title}}, {{content}}, {{timestamp}}。留空使用默认格式</p>
              </div>
            </div>
            <div class="flex justify-end">
              <button type="button" id="testWebhookBtn" class="btn-secondary text-white px-4 py-2 rounded-md text-sm font-medium">
                <i class="fas fa-paper-plane mr-2"></i>测试 企业微信应用通知
              </button>
            </div>
          </div>

          <div id="wechatbotConfig" class="config-section">
            <h4 class="text-md font-medium text-gray-900 mb-3">企业微信机器人 配置</h4>
            <div class="grid grid-cols-1 gap-4 mb-4">
              <div>
                <label for="wechatbotWebhook" class="block text-sm font-medium text-gray-700">机器人 Webhook URL</label>
                <input type="url" id="wechatbotWebhook" placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=your-key" class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
                <p class="mt-1 text-sm text-gray-500">从企业微信群聊中添加机器人获取的 Webhook URL</p>
              </div>
              <div>
                <label for="wechatbotMsgType" class="block text-sm font-medium text-gray-700">消息类型</label>
                <select id="wechatbotMsgType" class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
                  <option value="text">文本消息</option>
                  <option value="markdown">Markdown消息</option>
                </select>
                <p class="mt-1 text-sm text-gray-500">选择发送的消息格式类型</p>
              </div>
              <div>
                <label for="wechatbotAtMobiles" class="block text-sm font-medium text-gray-700">@手机号 (可选)</label>
                <input type="text" id="wechatbotAtMobiles" placeholder="13800138000,13900139000" class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
                <p class="mt-1 text-sm text-gray-500">需要@的手机号，多个用逗号分隔，留空则不@任何人</p>
              </div>
              <div>
                <label for="wechatbotAtAll" class="block text-sm font-medium text-gray-700 mb-2">@所有人</label>
                <label class="inline-flex items-center">
                  <input type="checkbox" id="wechatbotAtAll" class="form-checkbox h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500">
                  <span class="ml-2 text-sm text-gray-700">发送消息时@所有人</span>
                </label>
              </div>
            </div>
            <div class="flex justify-end">
              <button type="button" id="testWechatBotBtn" class="btn-secondary text-white px-4 py-2 rounded-md text-sm font-medium">
                <i class="fas fa-paper-plane mr-2"></i>测试 企业微信机器人
              </button>
            </div>
          </div>

          <div id="emailConfig" class="config-section">
            <h4 class="text-md font-medium text-gray-900 mb-3">邮件通知 配置</h4>
            <div class="grid grid-cols-1 gap-4 mb-4">
              <div>
                <label for="resendApiKey" class="block text-sm font-medium text-gray-700">Resend API Key</label>
                <input type="text" id="resendApiKey" placeholder="re_xxxxxxxxxx" class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
                <p class="mt-1 text-sm text-gray-500">从 <a href="https://resend.com/api-keys" target="_blank" class="text-indigo-600 hover:text-indigo-800">Resend控制台</a> 获取的 API Key</p>
              </div>
              <div>
                <label for="emailFrom" class="block text-sm font-medium text-gray-700">发件人邮箱</label>
                <input type="email" id="emailFrom" placeholder="noreply@yourdomain.com" class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
                <p class="mt-1 text-sm text-gray-500">必须是已在Resend验证的域名邮箱</p>
              </div>
              <div>
                <label for="emailFromName" class="block text-sm font-medium text-gray-700">发件人名称</label>
                <input type="text" id="emailFromName" placeholder="订阅提醒系统" class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
                <p class="mt-1 text-sm text-gray-500">显示在邮件中的发件人名称</p>
              </div>
              <div>
                <label for="emailTo" class="block text-sm font-medium text-gray-700">收件人邮箱</label>
                <input type="email" id="emailTo" placeholder="user@example.com" class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
                <p class="mt-1 text-sm text-gray-500">接收通知邮件的邮箱地址</p>
              </div>
            </div>
            <div class="flex justify-end">
              <button type="button" id="testEmailBtn" class="btn-secondary text-white px-4 py-2 rounded-md text-sm font-medium">
                <i class="fas fa-paper-plane mr-2"></i>测试 邮件通知
              </button>
            </div>
          </div>
        </div>

        <div class="flex justify-end">
          <button type="submit" class="btn-primary text-white px-6 py-2 rounded-md text-sm font-medium">
            <i class="fas fa-save mr-2"></i>保存配置
          </button>
        </div>
      </form>
    </div>
  </div>

  <script>
    function showToast(message, type = 'success', duration = 3000) {
      const container = document.getElementById('toast-container');
      const toast = document.createElement('div');
      toast.className = 'toast ' + type;
      
      const icon = type === 'success' ? 'check-circle' :
                   type === 'error' ? 'exclamation-circle' :
                   type === 'warning' ? 'exclamation-triangle' : 'info-circle';
      
      toast.innerHTML = '<div class="flex items-center"><i class="fas fa-' + icon + ' mr-2"></i><span>' + message + '</span></div>';
      
      container.appendChild(toast);
      setTimeout(() => toast.classList.add('show'), 100);
      setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
          if (container.contains(toast)) {
            container.removeChild(toast);
          }
        }, 300);
      }, duration);
    }

    async function loadConfig() {
      try {
        const response = await fetch('/api/config');
        const config = await response.json();

        document.getElementById('adminUsername').value = config.ADMIN_USERNAME || '';
        document.getElementById('tgBotToken').value = config.TG_BOT_TOKEN || '';
        document.getElementById('tgChatId').value = config.TG_CHAT_ID || '';
        document.getElementById('notifyxApiKey').value = config.NOTIFYX_API_KEY || '';
        document.getElementById('webhookUrl').value = config.WEBHOOK_URL || '';
        document.getElementById('webhookMethod').value = config.WEBHOOK_METHOD || 'POST';
        document.getElementById('webhookHeaders').value = config.WEBHOOK_HEADERS || '';
        document.getElementById('webhookTemplate').value = config.WEBHOOK_TEMPLATE || '';
        document.getElementById('wechatbotWebhook').value = config.WECHATBOT_WEBHOOK || '';
        document.getElementById('wechatbotMsgType').value = config.WECHATBOT_MSG_TYPE || 'text';
        document.getElementById('wechatbotAtMobiles').value = config.WECHATBOT_AT_MOBILES || '';
        document.getElementById('wechatbotAtAll').checked = config.WECHATBOT_AT_ALL === 'true';
        document.getElementById('resendApiKey').value = config.RESEND_API_KEY || '';
        document.getElementById('emailFrom').value = config.EMAIL_FROM || '';
        document.getElementById('emailFromName').value = config.EMAIL_FROM_NAME || '订阅提醒系统';
        document.getElementById('emailTo').value = config.EMAIL_TO || '';

        // Load lunar display setting
        document.getElementById('showLunarGlobal').checked = config.SHOW_LUNAR === true;

        // Handle multi-select notification channels
        const enabledNotifiers = config.ENABLED_NOTIFIERS || ['notifyx'];
        document.querySelectorAll('input[name="enabledNotifiers"]').forEach(checkbox => {
          checkbox.checked = enabledNotifiers.includes(checkbox.value);
        });

        toggleNotificationConfigs(enabledNotifiers);
      } catch (error) {
        console.error('Failed to load config:', error);
        showToast('Failed to load config, please refresh the page', 'error');
      }
    }
    
    function toggleNotificationConfigs(enabledNotifiers) {
      const telegramConfig = document.getElementById('telegramConfig');
      const notifyxConfig = document.getElementById('notifyxConfig');
      const webhookConfig = document.getElementById('webhookConfig');
      const wechatbotConfig = document.getElementById('wechatbotConfig');
      const emailConfig = document.getElementById('emailConfig');

      // Reset all config sections
      [telegramConfig, notifyxConfig, webhookConfig, wechatbotConfig, emailConfig].forEach(config => {
        config.classList.remove('active', 'inactive');
        config.classList.add('inactive');
      });

      // Activate selected config sections
      enabledNotifiers.forEach(type => {
        if (type === 'telegram') {
          telegramConfig.classList.remove('inactive');
          telegramConfig.classList.add('active');
        } else if (type === 'notifyx') {
          notifyxConfig.classList.remove('inactive');
          notifyxConfig.classList.add('active');
        } else if (type === 'webhook') {
          webhookConfig.classList.remove('inactive');
          webhookConfig.classList.add('active');
        } else if (type === 'wechatbot') {
          wechatbotConfig.classList.remove('inactive');
          wechatbotConfig.classList.add('active');
        } else if (type === 'email') {
          emailConfig.classList.remove('inactive');
          emailConfig.classList.add('active');
        }
      });
    }

    document.querySelectorAll('input[name="enabledNotifiers"]').forEach(checkbox => {
      checkbox.addEventListener('change', () => {
        const enabledNotifiers = Array.from(document.querySelectorAll('input[name="enabledNotifiers"]:checked'))
          .map(cb => cb.value);
        toggleNotificationConfigs(enabledNotifiers);
      });
    });
    
    document.getElementById('configForm').addEventListener('submit', async (e) => {
      e.preventDefault();

      const enabledNotifiers = Array.from(document.querySelectorAll('input[name="enabledNotifiers"]:checked'))
        .map(cb => cb.value);

      if (enabledNotifiers.length === 0) {
        showToast('Please select at least one notification method', 'warning');
        return;
      }

      const config = {
        ADMIN_USERNAME: document.getElementById('adminUsername').value.trim(),
        TG_BOT_TOKEN: document.getElementById('tgBotToken').value.trim(),
        TG_CHAT_ID: document.getElementById('tgChatId').value.trim(),
        NOTIFYX_API_KEY: document.getElementById('notifyxApiKey').value.trim(),
        WEBHOOK_URL: document.getElementById('webhookUrl').value.trim(),
        WEBHOOK_METHOD: document.getElementById('webhookMethod').value,
        WEBHOOK_HEADERS: document.getElementById('webhookHeaders').value.trim(),
        WEBHOOK_TEMPLATE: document.getElementById('webhookTemplate').value.trim(),
        SHOW_LUNAR: document.getElementById('showLunarGlobal').checked,
        WECHATBOT_WEBHOOK: document.getElementById('wechatbotWebhook').value.trim(),
        WECHATBOT_MSG_TYPE: document.getElementById('wechatbotMsgType').value,
        WECHATBOT_AT_MOBILES: document.getElementById('wechatbotAtMobiles').value.trim(),
        WECHATBOT_AT_ALL: document.getElementById('wechatbotAtAll').checked.toString(),
        RESEND_API_KEY: document.getElementById('resendApiKey').value.trim(),
        EMAIL_FROM: document.getElementById('emailFrom').value.trim(),
        EMAIL_FROM_NAME: document.getElementById('emailFromName').value.trim(),
        EMAIL_TO: document.getElementById('emailTo').value.trim(),
        ENABLED_NOTIFIERS: enabledNotifiers
      };

      const passwordField = document.getElementById('adminPassword');
      if (passwordField.value.trim()) {
        config.ADMIN_PASSWORD = passwordField.value.trim();
      }

      const submitButton = e.target.querySelector('button[type="submit"]');
      const originalContent = submitButton.innerHTML;
      submitButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...';
      submitButton.disabled = true;

      try {
        const response = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config)
        });

        const result = await response.json();

        if (result.success) {
          showToast('Config saved successfully', 'success');
          passwordField.value = '';
        } else {
          showToast('Failed to save config: ' + (result.message || 'Unknown error'), 'error');
        }
      } catch (error) {
        console.error('Failed to save config:', error);
        showToast('Failed to save config, please try again later', 'error');
      } finally {
        submitButton.innerHTML = originalContent;
        submitButton.disabled = false;
      }
    });
    
    async function testNotification(type) {
      const buttonId = type === 'telegram' ? 'testTelegramBtn' :
                      type === 'notifyx' ? 'testNotifyXBtn' :
                      type === 'wechatbot' ? 'testWechatBotBtn' :
                      type === 'email' ? 'testEmailBtn' : 'testWebhookBtn';
      const button = document.getElementById(buttonId);
      const originalContent = button.innerHTML;
      const serviceName = type === 'telegram' ? 'Telegram' :
                          type === 'notifyx' ? 'NotifyX' :
                          type === 'wechatbot' ? '企业微信机器人' :
                          type === 'email' ? '邮件通知' : '企业微信应用通知';

      button.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Testing...';
      button.disabled = true;

      const config = {};
      if (type === 'telegram') {
        config.TG_BOT_TOKEN = document.getElementById('tgBotToken').value.trim();
        config.TG_CHAT_ID = document.getElementById('tgChatId').value.trim();

        if (!config.TG_BOT_TOKEN || !config.TG_CHAT_ID) {
          showToast('Please fill in Telegram Bot Token and Chat ID first', 'warning');
          button.innerHTML = originalContent;
          button.disabled = false;
          return;
        }
      } else if (type === 'notifyx') {
        config.NOTIFYX_API_KEY = document.getElementById('notifyxApiKey').value.trim();

        if (!config.NOTIFYX_API_KEY) {
          showToast('Please fill in NotifyX API Key first', 'warning');
          button.innerHTML = originalContent;
          button.disabled = false;
          return;
        }
      } else if (type === 'webhook') {
        config.WEBHOOK_URL = document.getElementById('webhookUrl').value.trim();
        config.WEBHOOK_METHOD = document.getElementById('webhookMethod').value;
        config.WEBHOOK_HEADERS = document.getElementById('webhookHeaders').value.trim();
        config.WEBHOOK_TEMPLATE = document.getElementById('webhookTemplate').value.trim();

        if (!config.WEBHOOK_URL) {
          showToast('Please fill in Enterprise WeChat App Notification URL first', 'warning');
          button.innerHTML = originalContent;
          button.disabled = false;
          return;
        }
      } else if (type === 'wechatbot') {
        config.WECHATBOT_WEBHOOK = document.getElementById('wechatbotWebhook').value.trim();
        config.WECHATBOT_MSG_TYPE = document.getElementById('wechatbotMsgType').value;
        config.WECHATBOT_AT_MOBILES = document.getElementById('wechatbotAtMobiles').value.trim();
        config.WECHATBOT_AT_ALL = document.getElementById('wechatbotAtAll').checked.toString();

        if (!config.WECHATBOT_WEBHOOK) {
          showToast('Please fill in Enterprise WeChat Bot Webhook URL first', 'warning');
          button.innerHTML = originalContent;
          button.disabled = false;
          return;
        }
      } else if (type === 'email') {
        config.RESEND_API_KEY = document.getElementById('resendApiKey').value.trim();
        config.EMAIL_FROM = document.getElementById('emailFrom').value.trim();
        config.EMAIL_FROM_NAME = document.getElementById('emailFromName').value.trim();
        config.EMAIL_TO = document.getElementById('emailTo').value.trim();

        if (!config.RESEND_API_KEY || !config.EMAIL_FROM || !config.EMAIL_TO) {
          showToast('Please fill in Resend API Key, Sender Email and Recipient Email first', 'warning');
          button.innerHTML = originalContent;
          button.disabled = false;
          return;
        }
      }

      try {
        const response = await fetch('/api/test-notification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: type, ...config })
        });

        const result = await response.json();

        if (result.success) {
          showToast(serviceName + ' notification test successful!', 'success');
        } else {
          showToast(serviceName + ' notification test failed: ' + (result.message || 'Unknown error'), 'error');
        }
      } catch (error) {
        console.error('Test notification failed:', error);
        showToast('Test failed, please try again later', 'error');
      } finally {
        button.innerHTML = originalContent;
        button.disabled = false;
      }
    }
    
    document.getElementById('testTelegramBtn').addEventListener('click', () => {
      testNotification('telegram');
    });
    
    document.getElementById('testNotifyXBtn').addEventListener('click', () => {
      testNotification('notifyx');
    });

    document.getElementById('testWebhookBtn').addEventListener('click', () => {
      testNotification('webhook');
    });

    document.getElementById('testWechatBotBtn').addEventListener('click', () => {
      testNotification('wechatbot');
    });

    document.getElementById('testEmailBtn').addEventListener('click', () => {
      testNotification('email');
    });

    window.addEventListener('load', loadConfig);
  </script>
</body>
</html>
`;

// Admin page
const admin = {
  async handleRequest(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const pathname = url.pathname;

      console.log('[Admin Page] Access path:', pathname);

      const token = getCookieValue(request.headers.get('Cookie'), 'token');
      console.log('[Admin Page] Token exists:', !!token);

      const config = await getConfig(env);
      const user = token ? await verifyJWT(token, config.JWT_SECRET) : null;

      console.log('[Admin Page] User validation result:', !!user);

      if (!user) {
        console.log('[Admin Page] User not logged in, redirecting to login page');
        return new Response('', {
          status: 302,
          headers: { 'Location': '/' }
        });
      }

      if (pathname === '/admin/config') {
        return new Response(configPage, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      return new Response(adminPage, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    } catch (error) {
      console.error('[Admin Page] Error handling request:', error);
      return new Response('Internal Server Error', {
        status: 500,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
  }
};

// Handle API requests
const api = {
  async handleRequest(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.slice(4);
    const method = request.method;

    const config = await getConfig(env);

    if (path === '/login' && method === 'POST') {
      const body = await request.json();

      if (body.username === config.ADMIN_USERNAME && body.password === config.ADMIN_PASSWORD) {
        const token = await generateJWT(body.username, config.JWT_SECRET);

        return new Response(
          JSON.stringify({ success: true }),
          {
            headers: {
              'Content-Type': 'application/json',
              'Set-Cookie': 'token=' + token + '; HttpOnly; Path=/; SameSite=Strict; Max-Age=86400'
            }
          }
        );
      } else {
        return new Response(
          JSON.stringify({ success: false, message: 'Incorrect username or password' }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    if (path === '/logout' && (method === 'GET' || method === 'POST')) {
      return new Response('', {
        status: 302,
        headers: {
          'Location': '/',
          'Set-Cookie': 'token=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0'
        }
      });
    }

    const token = getCookieValue(request.headers.get('Cookie'), 'token');
    const user = token ? await verifyJWT(token, config.JWT_SECRET) : null;

    if (!user && path !== '/login') {
      return new Response(
        JSON.stringify({ success: false, message: 'Unauthorized access' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (path === '/config') {
      if (method === 'GET') {
        const { JWT_SECRET, ADMIN_PASSWORD, ...safeConfig } = config;
        return new Response(
          JSON.stringify(safeConfig),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (method === 'POST') {
        try {
          const newConfig = await request.json();

          const updatedConfig = {
            ...config,
            ADMIN_USERNAME: newConfig.ADMIN_USERNAME || config.ADMIN_USERNAME,
            TG_BOT_TOKEN: newConfig.TG_BOT_TOKEN || '',
            TG_CHAT_ID: newConfig.TG_CHAT_ID || '',
            NOTIFYX_API_KEY: newConfig.NOTIFYX_API_KEY || '',
            WEBHOOK_URL: newConfig.WEBHOOK_URL || '',
            WEBHOOK_METHOD: newConfig.WEBHOOK_METHOD || 'POST',
            WEBHOOK_HEADERS: newConfig.WEBHOOK_HEADERS || '',
            WEBHOOK_TEMPLATE: newConfig.WEBHOOK_TEMPLATE || '',
            SHOW_LUNAR: newConfig.SHOW_LUNAR === true,
            WECHATBOT_WEBHOOK: newConfig.WECHATBOT_WEBHOOK || '',
            WECHATBOT_MSG_TYPE: newConfig.WECHATBOT_MSG_TYPE || 'text',
            WECHATBOT_AT_MOBILES: newConfig.WECHATBOT_AT_MOBILES || '',
            WECHATBOT_AT_ALL: newConfig.WECHATBOT_AT_ALL || 'false',
            RESEND_API_KEY: newConfig.RESEND_API_KEY || '',
            EMAIL_FROM: newConfig.EMAIL_FROM || '',
            EMAIL_FROM_NAME: newConfig.EMAIL_FROM_NAME || '',
            EMAIL_TO: newConfig.EMAIL_TO || '',
            ENABLED_NOTIFIERS: newConfig.ENABLED_NOTIFIERS || ['notifyx']
          };

          if (newConfig.ADMIN_PASSWORD) {
            updatedConfig.ADMIN_PASSWORD = newConfig.ADMIN_PASSWORD;
          }

          // Ensure JWT_SECRET exists and is secure
          if (!updatedConfig.JWT_SECRET || updatedConfig.JWT_SECRET === 'your-secret-key') {
            updatedConfig.JWT_SECRET = generateRandomSecret();
            console.log('[Security] Generated new JWT secret');
          }

          await env.SUBSCRIPTIONS_KV.put('config', JSON.stringify(updatedConfig));

          return new Response(
            JSON.stringify({ success: true }),
            { headers: { 'Content-Type': 'application/json' } }
          );
        } catch (error) {
          console.error('Error saving config:', error);
          return new Response(
            JSON.stringify({ success: false, message: 'Failed to update config: ' + error.message }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }
    }

    if (path === '/test-notification' && method === 'POST') {
      try {
        const body = await request.json();
        let success = false;
        let message = '';

        if (body.type === 'telegram') {
          const testConfig = {
            ...config,
            TG_BOT_TOKEN: body.TG_BOT_TOKEN,
            TG_CHAT_ID: body.TG_CHAT_ID
          };

          const content = '*Test Notification*\n\nThis is a test notification to verify that the Telegram notification function is working correctly.\n\nSent at: ' + formatBeijingTime();
          success = await sendTelegramNotification(content, testConfig);
          message = success ? 'Telegram notification sent successfully' : 'Failed to send Telegram notification, please check your configuration';
        } else if (body.type === 'notifyx') {
          const testConfig = {
            ...config,
            NOTIFYX_API_KEY: body.NOTIFYX_API_KEY
          };

          const title = 'Test Notification';
          const content = '## This is a test notification\n\nTo verify that the NotifyX notification function is working correctly.\n\nSent at: ' + formatBeijingTime();
          const description = 'Test NotifyX notification function';

          success = await sendNotifyXNotification(title, content, description, testConfig);
          message = success ? 'NotifyX notification sent successfully' : 'Failed to send NotifyX notification, please check your configuration';
        } else if (body.type === 'webhook') {
          const testConfig = {
            ...config,
            WEBHOOK_URL: body.WEBHOOK_URL,
            WEBHOOK_METHOD: body.WEBHOOK_METHOD,
            WEBHOOK_HEADERS: body.WEBHOOK_HEADERS,
            WEBHOOK_TEMPLATE: body.WEBHOOK_TEMPLATE
          };

          const title = 'Test Notification';
          const content = 'This is a test notification to verify that the Enterprise WeChat App notification function is working correctly.\n\nSent at: ' + formatBeijingTime();

          success = await sendWebhookNotification(title, content, testConfig);
          message = success ? 'Enterprise WeChat App notification sent successfully' : 'Failed to send Enterprise WeChat App notification, please check your configuration';
         } else if (body.type === 'wechatbot') {
          const testConfig = {
            ...config,
            WECHATBOT_WEBHOOK: body.WECHATBOT_WEBHOOK,
            WECHATBOT_MSG_TYPE: body.WECHATBOT_MSG_TYPE,
            WECHATBOT_AT_MOBILES: body.WECHATBOT_AT_MOBILES,
            WECHATBOT_AT_ALL: body.WECHATBOT_AT_ALL
          };

          const title = 'Test Notification';
          const content = 'This is a test notification to verify that the Enterprise WeChat Bot function is working correctly.\n\nSent at: ' + formatBeijingTime();

          success = await sendWechatBotNotification(title, content, testConfig);
          message = success ? 'Enterprise WeChat Bot notification sent successfully' : 'Failed to send Enterprise WeChat Bot notification, please check your configuration';
        } else if (body.type === 'email') {
          const testConfig = {
            ...config,
            RESEND_API_KEY: body.RESEND_API_KEY,
            EMAIL_FROM: body.EMAIL_FROM,
            EMAIL_FROM_NAME: body.EMAIL_FROM_NAME,
            EMAIL_TO: body.EMAIL_TO
          };

          const title = 'Test Notification';
          const content = 'This is a test notification to verify that the email notification function is working correctly.\n\nSent at: ' + formatBeijingTime();

          success = await sendEmailNotification(title, content, testConfig);
          message = success ? 'Email notification sent successfully' : 'Failed to send email notification, please check your configuration';
        }

        return new Response(
          JSON.stringify({ success, message }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      } catch (error) {
        console.error('Test notification failed:', error);
        return new Response(
          JSON.stringify({ success: false, message: 'Test notification failed: ' + error.message }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    if (path === '/subscriptions') {
      if (method === 'GET') {
        const subscriptions = await getAllSubscriptions(env);
        return new Response(
          JSON.stringify(subscriptions),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (method === 'POST') {
        const subscription = await request.json();
        const result = await createSubscription(subscription, env);

        return new Response(
          JSON.stringify(result),
          {
            status: result.success ? 201 : 400,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }
    }

    if (path.startsWith('/subscriptions/')) {
      const parts = path.split('/');
      const id = parts[2];

      if (parts[3] === 'toggle-status' && method === 'POST') {
        const body = await request.json();
        const result = await toggleSubscriptionStatus(id, body.isActive, env);

        return new Response(
          JSON.stringify(result),
          {
            status: result.success ? 200 : 400,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }

      if (parts[3] === 'test-notify' && method === 'POST') {
        const result = await testSingleSubscriptionNotification(id, env);
        return new Response(JSON.stringify(result), { status: result.success ? 200 : 500, headers: { 'Content-Type': 'application/json' } });
      }

      if (method === 'GET') {
        const subscription = await getSubscription(id, env);

        return new Response(
          JSON.stringify(subscription),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (method === 'PUT') {
        const subscription = await request.json();
        const result = await updateSubscription(id, subscription, env);

        return new Response(
          JSON.stringify(result),
          {
            status: result.success ? 200 : 400,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }

      if (method === 'DELETE') {
        const result = await deleteSubscription(id, env);

        return new Response(
          JSON.stringify(result),
          {
            status: result.success ? 200 : 400,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }
    }

    // Handle third-party notification API
    if (path.startsWith('/notify/')) {
      const code = path.split('/')[2];
      if (method === 'POST') {
        try {
          const body = await request.json();
          const title = body.title || 'Third-Party Notification';
          const content = body.content || '';

          if (!content) {
            return new Response(
              JSON.stringify({ message: 'Missing required parameter content' }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
          }

          const config = await getConfig(env);

          // Send notification to all channels
          await sendNotificationToAllChannels(title, content, config, '[Third-Party API]');

          return new Response(
            JSON.stringify({
              message: 'Sent successfully',
              response: {
                errcode: 0,
                errmsg: 'ok',
                msgid: 'MSGID' + Date.now()
              }
            }),
            { headers: { 'Content-Type': 'application/json' } }
          );
        } catch (error) {
          console.error('[Third-Party API] Failed to send notification:', error);
          return new Response(
            JSON.stringify({
              message: 'Failed to send',
              response: {
                errcode: 1,
                errmsg: error.message
              }
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }
    }

    return new Response(
      JSON.stringify({ success: false, message: 'Requested resource not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

// Utility functions
function generateRandomSecret() {
  // Generate a 64-character random secret
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let result = '';
  for (let i = 0; i < 64; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function getConfig(env) {
  try {
    if (!env.SUBSCRIPTIONS_KV) {
      console.error('[Config] KV store not bound');
      throw new Error('KV store not bound');
    }

    const data = await env.SUBSCRIPTIONS_KV.get('config');
    console.log('[Config] Read config from KV:', data ? 'Success' : 'Empty config');

    const config = data ? JSON.parse(data) : {};

    // Ensure JWT_SECRET consistency
    let jwtSecret = config.JWT_SECRET;
    if (!jwtSecret || jwtSecret === 'your-secret-key') {
      jwtSecret = generateRandomSecret();
      console.log('[Config] Generated new JWT secret');

      // Save new JWT secret
      const updatedConfig = { ...config, JWT_SECRET: jwtSecret };
      await env.SUBSCRIPTIONS_KV.put('config', JSON.stringify(updatedConfig));
    }

    const finalConfig = {
      ADMIN_USERNAME: config.ADMIN_USERNAME || 'admin',
      ADMIN_PASSWORD: config.ADMIN_PASSWORD || 'password',
      JWT_SECRET: jwtSecret,
      TG_BOT_TOKEN: config.TG_BOT_TOKEN || '',
      TG_CHAT_ID: config.TG_CHAT_ID || '',
      NOTIFYX_API_KEY: config.NOTIFYX_API_KEY || '',
      WEBHOOK_URL: config.WEBHOOK_URL || '',
      WEBHOOK_METHOD: config.WEBHOOK_METHOD || 'POST',
      WEBHOOK_HEADERS: config.WEBHOOK_HEADERS || '',
      WEBHOOK_TEMPLATE: config.WEBHOOK_TEMPLATE || '',
      SHOW_LUNAR: config.SHOW_LUNAR === true,
      WECHATBOT_WEBHOOK: config.WECHATBOT_WEBHOOK || '',
      WECHATBOT_MSG_TYPE: config.WECHATBOT_MSG_TYPE || 'text',
      WECHATBOT_AT_MOBILES: config.WECHATBOT_AT_MOBILES || '',
      WECHATBOT_AT_ALL: config.WECHATBOT_AT_ALL || 'false',
      RESEND_API_KEY: config.RESEND_API_KEY || '',
      EMAIL_FROM: config.EMAIL_FROM || '',
      EMAIL_FROM_NAME: config.EMAIL_FROM_NAME || '',
      EMAIL_TO: config.EMAIL_TO || '',
      ENABLED_NOTIFIERS: config.ENABLED_NOTIFIERS || ['notifyx']
    };

    console.log('[Config] Final config username:', finalConfig.ADMIN_USERNAME);
    return finalConfig;
  } catch (error) {
    console.error('[Config] Failed to get config:', error);
    const defaultJwtSecret = generateRandomSecret();

    return {
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'password',
      JWT_SECRET: defaultJwtSecret,
      TG_BOT_TOKEN: '',
      TG_CHAT_ID: '',
      NOTIFYX_API_KEY: '',
      WEBHOOK_URL: '',
      WEBHOOK_METHOD: 'POST',
      WEBHOOK_HEADERS: '',
      WEBHOOK_TEMPLATE: '',
      SHOW_LUNAR: true,
      WECHATBOT_WEBHOOK: '',
      WECHATBOT_MSG_TYPE: 'text',
      WECHATBOT_AT_MOBILES: '',
      WECHATBOT_AT_ALL: 'false',
      RESEND_API_KEY: '',
      EMAIL_FROM: '',
      EMAIL_FROM_NAME: '',
      EMAIL_TO: '',
      ENABLED_NOTIFIERS: ['notifyx']
    };
  }
}

async function generateJWT(username, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = { username, iat: Math.floor(Date.now() / 1000) };

  const headerBase64 = btoa(JSON.stringify(header));
  const payloadBase64 = btoa(JSON.stringify(payload));

  const signatureInput = headerBase64 + '.' + payloadBase64;
  const signature = await CryptoJS.HmacSHA256(signatureInput, secret);

  return headerBase64 + '.' + payloadBase64 + '.' + signature;
}

async function verifyJWT(token, secret) {
  try {
    if (!token || !secret) {
      console.log('[JWT] Token or Secret is empty');
      return null;
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      console.log('[JWT] Invalid token format, number of parts:', parts.length);
      return null;
    }

    const [headerBase64, payloadBase64, signature] = parts;
    const signatureInput = headerBase64 + '.' + payloadBase64;
    const expectedSignature = await CryptoJS.HmacSHA256(signatureInput, secret);

    if (signature !== expectedSignature) {
      console.log('[JWT] Signature verification failed');
      return null;
    }

    const payload = JSON.parse(atob(payloadBase64));
    console.log('[JWT] Verification successful, user:', payload.username);
    return payload;
  } catch (error) {
    console.error('[JWT] Error during verification:', error);
    return null;
  }
}

// Helper to convert D1 integer to JS boolean
function toBoolean(value) {
    return value === 1;
}

// Helper to convert D1 results to JS objects with correct boolean types
function mapD1Result(result) {
    if (!result) return null;
    return {
        ...result,
        isActive: toBoolean(result.isActive),
        autoRenew: toBoolean(result.autoRenew),
        useLunar: toBoolean(result.useLunar)
    };
}


async function getAllSubscriptions(env) {
  try {
    const { results } = await env.DB.prepare("SELECT * FROM subscriptions").all();
    return results.map(mapD1Result);
  } catch (error) {
    console.error("D1: Failed to get all subscriptions", error);
    return [];
  }
}

async function getSubscription(id, env) {
  try {
    const result = await env.DB.prepare("SELECT * FROM subscriptions WHERE id = ?").bind(id).first();
    return mapD1Result(result);
  } catch (error) {
    console.error(`D1: Failed to get subscription with id ${id}`, error);
    return null;
  }
}

async function createSubscription(subscription, env) {
  try {
    if (!subscription.name || !subscription.expiryDate) {
      return { success: false, message: 'Missing required fields' };
    }

    let expiryDate = new Date(subscription.expiryDate);
    const now = new Date();
    
    let useLunar = !!subscription.useLunar;
    if (useLunar) {
      let lunar = lunarCalendar.solar2lunar(
        expiryDate.getFullYear(),
        expiryDate.getMonth() + 1,
        expiryDate.getDate()
      );
      
      if (lunar && subscription.periodValue && subscription.periodUnit) {
        // If expiry date is in the past, calculate the next period
        while (expiryDate <= now) {
          lunar = lunarBiz.addLunarPeriod(lunar, subscription.periodValue, subscription.periodUnit);
          const solar = lunarBiz.lunar2solar(lunar);
          expiryDate = new Date(solar.year, solar.month - 1, solar.day);
        }
        subscription.expiryDate = expiryDate.toISOString().split('T')[0];
      }
    } else {
      if (expiryDate < now && subscription.periodValue && subscription.periodUnit) {
        while (expiryDate < now) {
          if (subscription.periodUnit === 'day') {
            expiryDate.setDate(expiryDate.getDate() + subscription.periodValue);
          } else if (subscription.periodUnit === 'month') {
            expiryDate.setMonth(expiryDate.getMonth() + subscription.periodValue);
          } else if (subscription.periodUnit === 'year') {
            expiryDate.setFullYear(expiryDate.getFullYear() + subscription.periodValue);
          }
        }
        subscription.expiryDate = expiryDate.toISOString().split('T')[0];
      }
    }

    const newId = Date.now().toString();
    const newSubscription = {
      id: newId,
      name: subscription.name,
      customType: subscription.customType || '',
      startDate: subscription.startDate || null,
      expiryDate: subscription.expiryDate,
      periodValue: subscription.periodValue || 1,
      periodUnit: subscription.periodUnit || 'month',
      reminderDays: subscription.reminderDays !== undefined ? subscription.reminderDays : 7,
      notes: subscription.notes || '',
      isActive: subscription.isActive !== false ? 1 : 0,
      autoRenew: subscription.autoRenew !== false ? 1 : 0,
      useLunar: useLunar ? 1 : 0,
      createdAt: new Date().toISOString()
    };
    
    await env.DB.prepare(
        "INSERT INTO subscriptions (id, name, customType, startDate, expiryDate, periodValue, periodUnit, reminderDays, notes, isActive, autoRenew, useLunar, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
        newSubscription.id, newSubscription.name, newSubscription.customType, newSubscription.startDate, newSubscription.expiryDate,
        newSubscription.periodValue, newSubscription.periodUnit, newSubscription.reminderDays, newSubscription.notes,
        newSubscription.isActive, newSubscription.autoRenew, newSubscription.useLunar, newSubscription.createdAt
    ).run();

    return { success: true, subscription: { ...newSubscription, isActive: toBoolean(newSubscription.isActive), autoRenew: toBoolean(newSubscription.autoRenew), useLunar: toBoolean(newSubscription.useLunar) } };
  } catch (error) {
    console.error("D1: Error creating subscription:", error);
    return { success: false, message: 'Failed to create subscription: ' + (error.message || 'Unknown error') };
  }
}

async function updateSubscription(id, subscription, env) {
  try {
    const existing = await getSubscription(id, env);
    if (!existing) {
        return { success: false, message: 'Subscription not found' };
    }

    if (!subscription.name || !subscription.expiryDate) {
      return { success: false, message: 'Missing required fields' };
    }

    let expiryDate = new Date(subscription.expiryDate);
    const now = new Date();

    let useLunar = !!subscription.useLunar;
    if (useLunar) {
      let lunar = lunarCalendar.solar2lunar(
        expiryDate.getFullYear(),
        expiryDate.getMonth() + 1,
        expiryDate.getDate()
      );
      if (!lunar) {
        return { success: false, message: 'Lunar date out of supported range (1900-2100)' };
      }
      if (expiryDate < now && subscription.periodValue && subscription.periodUnit) {
        do {
          lunar = lunarBiz.addLunarPeriod(lunar, subscription.periodValue, subscription.periodUnit);
          const solar = lunarBiz.lunar2solar(lunar);
          expiryDate = new Date(solar.year, solar.month - 1, solar.day);
        } while (expiryDate < now);
        subscription.expiryDate = expiryDate.toISOString().split('T')[0];
      }
    } else {
      if (expiryDate < now && subscription.periodValue && subscription.periodUnit) {
        while (expiryDate < now) {
          if (subscription.periodUnit === 'day') {
            expiryDate.setDate(expiryDate.getDate() + subscription.periodValue);
          } else if (subscription.periodUnit === 'month') {
            expiryDate.setMonth(expiryDate.getMonth() + subscription.periodValue);
          } else if (subscription.periodUnit === 'year') {
            expiryDate.setFullYear(expiryDate.getFullYear() + subscription.periodValue);
          }
        }
        subscription.expiryDate = expiryDate.toISOString().split('T')[0];
      }
    }

    const updatedSubscription = {
      name: subscription.name,
      customType: subscription.customType,
      startDate: subscription.startDate,
      expiryDate: subscription.expiryDate,
      periodValue: subscription.periodValue,
      periodUnit: subscription.periodUnit,
      reminderDays: subscription.reminderDays,
      notes: subscription.notes || '',
      isActive: subscription.isActive ? 1 : 0,
      autoRenew: subscription.autoRenew ? 1 : 0,
      useLunar: useLunar ? 1 : 0,
      updatedAt: new Date().toISOString()
    };

    await env.DB.prepare(
        "UPDATE subscriptions SET name = ?, customType = ?, startDate = ?, expiryDate = ?, periodValue = ?, periodUnit = ?, reminderDays = ?, notes = ?, isActive = ?, autoRenew = ?, useLunar = ?, updatedAt = ? WHERE id = ?"
    ).bind(
        updatedSubscription.name, updatedSubscription.customType, updatedSubscription.startDate, updatedSubscription.expiryDate,
        updatedSubscription.periodValue, updatedSubscription.periodUnit, updatedSubscription.reminderDays, updatedSubscription.notes,
        updatedSubscription.isActive, updatedSubscription.autoRenew, updatedSubscription.useLunar, updatedSubscription.updatedAt,
        id
    ).run();

    return { success: true, subscription: mapD1Result({ ...existing, ...updatedSubscription }) };
  } catch (error) {
    console.error("D1: Error updating subscription:", error);
    return { success: false, message: 'Failed to update subscription' };
  }
}

async function deleteSubscription(id, env) {
  try {
    const { success } = await env.DB.prepare("DELETE FROM subscriptions WHERE id = ?").bind(id).run();
    if (!success) {
      return { success: false, message: 'Subscription not found or delete failed' };
    }
    return { success: true };
  } catch (error) {
    console.error("D1: Error deleting subscription:", error);
    return { success: false, message: 'Failed to delete subscription' };
  }
}

async function toggleSubscriptionStatus(id, isActive, env) {
  try {
    const { success } = await env.DB.prepare("UPDATE subscriptions SET isActive = ?, updatedAt = ? WHERE id = ?")
      .bind(isActive ? 1 : 0, new Date().toISOString(), id)
      .run();

    if (!success) {
        return { success: false, message: 'Subscription not found' };
    }
    const updatedSubscription = await getSubscription(id, env);
    return { success: true, subscription: updatedSubscription };
  } catch (error) {
    console.error("D1: Error toggling subscription status:", error);
    return { success: false, message: 'Failed to update subscription status' };
  }
}

async function testSingleSubscriptionNotification(id, env) {
  try {
    const subscription = await getSubscription(id, env);
    if (!subscription) {
      return { success: false, message: 'Subscription not found' };
    }
    const config = await getConfig(env);

    const title = `Manual Test Notification: ${subscription.name}`;

    // Check if lunar should be displayed (from config, default no)
    const showLunar = config.SHOW_LUNAR === true;
    let lunarExpiryText = '';

    if (showLunar) {
      // Calculate lunar date
      const expiryDateObj = new Date(subscription.expiryDate);
      const lunarExpiry = lunarCalendar.solar2lunar(expiryDateObj.getFullYear(), expiryDateObj.getMonth() + 1, expiryDateObj.getDate());
      lunarExpiryText = lunarExpiry ? ` (Lunar: ${lunarExpiry.fullStr})` : '';
    }

    const commonContent = `**Subscription Details**:\n- **Type**: ${subscription.customType || 'Other'}\n- **Expiry Date**: ${formatBeijingTime(new Date(subscription.expiryDate), 'date')}${lunarExpiryText}\n- **Notes**: ${subscription.notes || 'None'}`;

    // Send to all channels
    await sendNotificationToAllChannels(title, commonContent, config, '[Manual Test]');

    return { success: true, message: 'Test notification sent to all enabled channels' };

  } catch (error) {
    console.error('[Manual Test] Failed to send:', error);
    return { success: false, message: 'An error occurred while sending: ' + error.message };
  }
}

async function sendWebhookNotification(title, content, config) {
  try {
    if (!config.WEBHOOK_URL) {
      console.error('[Enterprise WeChat App] Notification not configured, missing URL');
      return false;
    }

    console.log('[Enterprise WeChat App] Starting to send notification to: ' + config.WEBHOOK_URL);

    const timestamp = formatBeijingTime(new Date(), 'datetime');
    let requestBody;
    let headers = { 'Content-Type': 'application/json' };

    // Handle custom headers
    if (config.WEBHOOK_HEADERS) {
      try {
        const customHeaders = JSON.parse(config.WEBHOOK_HEADERS);
        headers = { ...headers, ...customHeaders };
      } catch (error) {
        console.warn('[Enterprise WeChat App] Invalid custom header format, using default headers');
      }
    }

    // Handle message template
    if (config.WEBHOOK_TEMPLATE) {
      try {
        const template = JSON.parse(config.WEBHOOK_TEMPLATE);
        requestBody = JSON.stringify(template)
          .replace(/\{\{title\}\}/g, title)
          .replace(/\{\{content\}\}/g, content)
          .replace(/\{\{timestamp\}\}/g, timestamp);
        requestBody = JSON.parse(requestBody);
      } catch (error) {
        console.warn('[Enterprise WeChat App] Invalid message template format, using default format');
        requestBody = { title, content, timestamp };
      }
    } else {
      requestBody = { title, content, timestamp };
    }

    const response = await fetch(config.WEBHOOK_URL, {
      method: config.WEBHOOK_METHOD || 'POST',
      headers: headers,
      body: JSON.stringify(requestBody)
    });

    const result = await response.text();
    console.log('[Enterprise WeChat App] Send result:', response.status, result);
    return response.ok;
  } catch (error) {
    console.error('[Enterprise WeChat App] Failed to send notification:', error);
    return false;
  }
}

async function sendWeComNotification(message, config) {
    // This is a placeholder. In a real scenario, you would implement the WeCom notification logic here.
    console.log("[Enterprise WeChat] Notification function not implemented");
    return { success: false, message: "Enterprise WeChat notification function not implemented" };
}

async function sendWechatBotNotification(title, content, config) {
  try {
    if (!config.WECHATBOT_WEBHOOK) {
      console.error('[Enterprise WeChat Bot] Notification not configured, missing Webhook URL');
      return false;
    }

    console.log('[Enterprise WeChat Bot] Starting to send notification to: ' + config.WECHATBOT_WEBHOOK);

    // Build message content
    let messageData;
    const msgType = config.WECHATBOT_MSG_TYPE || 'text';

    if (msgType === 'markdown') {
      // Markdown message format
      const markdownContent = `# ${title}\n\n${content}`;
      messageData = {
        msgtype: 'markdown',
        markdown: {
          content: markdownContent
        }
      };
    } else {
      // Text message format
      const textContent = `${title}\n\n${content}`;
      messageData = {
        msgtype: 'text',
        text: {
          content: textContent
        }
      };
    }

    // Handle @ functionality
    if (config.WECHATBOT_AT_ALL === 'true') {
      // @all
      if (msgType === 'text') {
        messageData.text.mentioned_list = ['@all'];
      }
    } else if (config.WECHATBOT_AT_MOBILES) {
      // @ specific mobile numbers
      const mobiles = config.WECHATBOT_AT_MOBILES.split(',').map(m => m.trim()).filter(m => m);
      if (mobiles.length > 0) {
        if (msgType === 'text') {
          messageData.text.mentioned_mobile_list = mobiles;
        }
      }
    }

    console.log('[Enterprise WeChat Bot] Sending message data:', JSON.stringify(messageData, null, 2));

    const response = await fetch(config.WECHATBOT_WEBHOOK, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(messageData)
    });

    const responseText = await response.text();
    console.log('[Enterprise WeChat Bot] Response status:', response.status);
    console.log('[Enterprise WeChat Bot] Response content:', responseText);

    if (response.ok) {
      try {
        const result = JSON.parse(responseText);
        if (result.errcode === 0) {
          console.log('[Enterprise WeChat Bot] Notification sent successfully');
          return true;
        } else {
          console.error('[Enterprise WeChat Bot] Failed to send, error code:', result.errcode, 'error message:', result.errmsg);
          return false;
        }
      } catch (parseError) {
        console.error('[Enterprise WeChat Bot] Failed to parse response:', parseError);
        return false;
      }
    } else {
      console.error('[Enterprise WeChat Bot] HTTP request failed, status code:', response.status);
      return false;
    }
  } catch (error) {
    console.error('[Enterprise WeChat Bot] Failed to send notification:', error);
    return false;
  }
}

async function sendNotificationToAllChannels(title, commonContent, config, logPrefix = '[Cron Job]') {
    if (!config.ENABLED_NOTIFIERS || config.ENABLED_NOTIFIERS.length === 0) {
        console.log(`${logPrefix} No notification channels enabled.`);
        return;
    }

    if (config.ENABLED_NOTIFIERS.includes('notifyx')) {
        const notifyxContent = `## ${title}\n\n${commonContent}`;
        const success = await sendNotifyXNotification(title, notifyxContent, `Subscription Reminder`, config);
        console.log(`${logPrefix} Sent NotifyX notification ${success ? 'successfully' : 'failed'}`);
    }
    if (config.ENABLED_NOTIFIERS.includes('telegram')) {
        const telegramContent = `*${title}*\n\n${commonContent.replace(/(\s)/g, ' ')}`;
        const success = await sendTelegramNotification(telegramContent, config);
        console.log(`${logPrefix} Sent Telegram notification ${success ? 'successfully' : 'failed'}`);
    }
    if (config.ENABLED_NOTIFIERS.includes('webhook')) {
        const webhookContent = commonContent.replace(/(\**|\*|##|#|`)/g, '');
        const success = await sendWebhookNotification(title, webhookContent, config);
        console.log(`${logPrefix} Sent Enterprise WeChat App notification ${success ? 'successfully' : 'failed'}`);
    }
    if (config.ENABLED_NOTIFIERS.includes('wechatbot')) {
        const wechatbotContent = commonContent.replace(/(\**|\*|##|#|`)/g, '');
        const success = await sendWechatBotNotification(title, wechatbotContent, config);
        console.log(`${logPrefix} Sent Enterprise WeChat Bot notification ${success ? 'successfully' : 'failed'}`);
    }
    if (config.ENABLED_NOTIFIERS.includes('weixin')) {
        const weixinContent = `【${title}】\n\n${commonContent.replace(/(\**|\*|##|#|`)/g, '')}`;
        const result = await sendWeComNotification(weixinContent, config);
        console.log(`${logPrefix} Sent Enterprise WeChat notification ${result.success ? 'successfully' : 'failed'}. ${result.message}`);
    }
    if (config.ENABLED_NOTIFIERS.includes('email')) {
        const emailContent = commonContent.replace(/(\**|\*|##|#|`)/g, '');
        const success = await sendEmailNotification(title, emailContent, config);
        console.log(`${logPrefix} Sent email notification ${success ? 'successfully' : 'failed'}`);
    }
}

async function sendTelegramNotification(message, config) {
  try {
    if (!config.TG_BOT_TOKEN || !config.TG_CHAT_ID) {
      console.error('[Telegram] Notification not configured, missing Bot Token or Chat ID');
      return false;
    }

    console.log('[Telegram] Starting to send notification to Chat ID: ' + config.TG_CHAT_ID);

    const url = 'https://api.telegram.org/bot' + config.TG_BOT_TOKEN + '/sendMessage';
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.TG_CHAT_ID,
        text: message,
        parse_mode: 'Markdown'
      })
    });

    const result = await response.json();
    console.log('[Telegram] Send result:', result);
    return result.ok;
  } catch (error) {
    console.error('[Telegram] Failed to send notification:', error);
    return false;
  }
}

async function sendNotifyXNotification(title, content, description, config) {
  try {
    if (!config.NOTIFYX_API_KEY) {
      console.error('[NotifyX] Notification not configured, missing API Key');
      return false;
    }

    console.log('[NotifyX] Starting to send notification: ' + title);

    const url = 'https://www.notifyx.cn/api/v1/send/' + config.NOTIFYX_API_KEY;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title,
        content: content,
        description: description || ''
      })
    });

    const result = await response.json();
    console.log('[NotifyX] Send result:', result);
    return result.status === 'queued';
  } catch (error) {
    console.error('[NotifyX] Failed to send notification:', error);
    return false;
  }
}

async function sendEmailNotification(title, content, config) {
  try {
    if (!config.RESEND_API_KEY || !config.EMAIL_FROM || !config.EMAIL_TO) {
      console.error('[Email Notification] Notification not configured, missing required parameters');
      return false;
    }

    console.log('[Email Notification] Starting to send email to: ' + config.EMAIL_TO);

    // Generate HTML email content
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f5f5f5; }
        .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px 20px; text-align: center; }
        .header h1 { color: white; margin: 0; font-size: 24px; }
        .content { padding: 30px 20px; }
        .content h2 { color: #333; margin-top: 0; }
        .content p { color: #666; line-height: 1.6; margin: 16px 0; }
        .footer { background-color: #f8f9fa; padding: 20px; text-align: center; color: #666; font-size: 14px; }
        .highlight { background-color: #e3f2fd; padding: 15px; border-radius: 8px; margin: 20px 0; }
        .button { display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📅 ${title}</h1>
        </div>
        <div class="content">
            <div class="highlight">
                ${content.replace(/\n/g, '<br>')}
            </div>
            <p>This email was sent automatically by the subscription management system. Please handle related subscription matters in a timely manner.</p>
        </div>
        <div class="footer">
            <p>Subscription Management System | Sent at: ${formatBeijingTime()}</p>
        </div>
    </div>
</body>
</html>`;

    const fromEmail = config.EMAIL_FROM_NAME ?
      `${config.EMAIL_FROM_NAME} <${config.EMAIL_FROM}>` :
      config.EMAIL_FROM;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromEmail,
        to: config.EMAIL_TO,
        subject: title,
        html: htmlContent,
        text: content // Plain text fallback
      })
    });

    const result = await response.json();
    console.log('[Email Notification] Send result:', response.status, result);

    if (response.ok && result.id) {
      console.log('[Email Notification] Email sent successfully, ID:', result.id);
      return true;
    } else {
      console.error('[Email Notification] Failed to send email:', result);
      return false;
    }
  } catch (error) {
    console.error('[Email Notification] Failed to send email:', error);
    return false;
  }
}

async function sendNotification(title, content, description, config) {
  if (config.NOTIFICATION_TYPE === 'notifyx') {
    return await sendNotifyXNotification(title, content, description, config);
  } else {
    return await sendTelegramNotification(content, config);
  }
}

async function checkExpiringSubscriptions(env) {
  try {
    const now = new Date();
    const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    console.log('[Cron Job] Start checking expiring subscriptions UTC: ' + now.toISOString() + ', Beijing Time: ' + beijingTime.toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'}));

    const subscriptions = await getAllSubscriptions(env);
    console.log('[Cron Job] Found ' + subscriptions.length + ' total subscriptions');

    const config = await getConfig(env);
    const expiringSubscriptions = [];
    const updatePromises = [];

    for (const subscription of subscriptions) {
      if (!subscription.isActive) {
        console.log(`[Cron Job] Subscription "${subscription.name}" is disabled, skipping`);
        continue;
      }

      let daysDiff;
      let currentExpiryDate = new Date(subscription.expiryDate);

      if (subscription.useLunar) {
        let lunar = lunarCalendar.solar2lunar(currentExpiryDate.getFullYear(), currentExpiryDate.getMonth() + 1, currentExpiryDate.getDate());
        daysDiff = lunarBiz.daysToLunar(lunar);

        console.log(`[Cron Job] Subscription "${subscription.name}" expiry date: ${currentExpiryDate.toISOString()}, days left: ${daysDiff}`);

        if (daysDiff < 0 && subscription.autoRenew) {
            let nextLunar = lunar;
            let newExpiryDate;
            do {
                nextLunar = lunarBiz.addLunarPeriod(nextLunar, subscription.periodValue, subscription.periodUnit);
                const solar = lunarBiz.lunar2solar(nextLunar);
                newExpiryDate = new Date(solar.year, solar.month - 1, solar.day);
                daysDiff = lunarBiz.daysToLunar(nextLunar);
            } while (daysDiff < 0);
            
            console.log(`[Cron Job] Subscription "${subscription.name}" updated expiry date to: ${newExpiryDate.toISOString()}, new days left: ${daysDiff}`);
            
            const updatedSubscription = { ...subscription, expiryDate: newExpiryDate.toISOString().split('T')[0] };
            
            updatePromises.push(env.DB.prepare(
                "UPDATE subscriptions SET expiryDate = ?, updatedAt = ? WHERE id = ?"
            ).bind(updatedSubscription.expiryDate, new Date().toISOString(), subscription.id).run());
            
            const reminderDays = subscription.reminderDays ?? 7;
            if (daysDiff <= reminderDays) {
                console.log(`[Cron Job] Subscription "${subscription.name}" is within reminder range after renewal, will send notification`);
                expiringSubscriptions.push({ ...updatedSubscription, daysRemaining: daysDiff });
            }
            continue;
        }

      } else { // Solar calendar logic
        daysDiff = Math.ceil((currentExpiryDate - now) / (1000 * 60 * 60 * 24));
        console.log(`[Cron Job] Subscription "${subscription.name}" expiry date: ${currentExpiryDate.toISOString()}, days left: ${daysDiff}`);
        
        if (daysDiff < 0 && subscription.autoRenew) {
            let newExpiryDate = new Date(currentExpiryDate);
            while (newExpiryDate < now) {
                if (subscription.periodUnit === 'day') newExpiryDate.setDate(newExpiryDate.getDate() + subscription.periodValue);
                else if (subscription.periodUnit === 'month') newExpiryDate.setMonth(newExpiryDate.getMonth() + subscription.periodValue);
                else if (subscription.periodUnit === 'year') newExpiryDate.setFullYear(newExpiryDate.getFullYear() + subscription.periodValue);
            }
            
            const newDaysDiff = Math.ceil((newExpiryDate - now) / (1000 * 60 * 60 * 24));
            console.log(`[Cron Job] Subscription "${subscription.name}" updated expiry date to: ${newExpiryDate.toISOString()}, new days left: ${newDaysDiff}`);

            const updatedSubscription = { ...subscription, expiryDate: newExpiryDate.toISOString().split('T')[0] };
            updatePromises.push(env.DB.prepare(
                "UPDATE subscriptions SET expiryDate = ?, updatedAt = ? WHERE id = ?"
            ).bind(updatedSubscription.expiryDate, new Date().toISOString(), subscription.id).run());

            const reminderDays = subscription.reminderDays ?? 7;
            if (newDaysDiff <= reminderDays) {
                console.log(`[Cron Job] Subscription "${subscription.name}" is within reminder range after renewal, will send notification`);
                expiringSubscriptions.push({ ...updatedSubscription, daysRemaining: newDaysDiff });
            }
            continue;
        }
      }

      const reminderDays = subscription.reminderDays ?? 7;
      let shouldRemind = (reminderDays === 0 && daysDiff === 0) || (daysDiff >= 0 && daysDiff <= reminderDays);

      if (daysDiff < 0 && !subscription.autoRenew) {
          console.log(`[Cron Job] Subscription "${subscription.name}" has expired and auto-renew is off, will send expired notification`);
          expiringSubscriptions.push({ ...subscription, daysRemaining: daysDiff });
      } else if (shouldRemind) {
          console.log(`[Cron Job] Subscription "${subscription.name}" is within reminder range, will send notification`);
          expiringSubscriptions.push({ ...subscription, daysRemaining: daysDiff });
      }
    }

    if (updatePromises.length > 0) {
      await Promise.all(updatePromises);
      console.log(`[Cron Job] Successfully updated ${updatePromises.length} subscriptions in D1.`);
    }

    if (expiringSubscriptions.length > 0) {
      let commonContent = '';
      expiringSubscriptions.sort((a, b) => a.daysRemaining - b.daysRemaining);

      const showLunar = config.SHOW_LUNAR === true;

      for (const sub of expiringSubscriptions) {
        const typeText = sub.customType || 'Other';
        const periodText = (sub.periodValue && sub.periodUnit) ? `(Period: ${sub.periodValue} ${ { day: 'days', month: 'months', year: 'years' }[sub.periodUnit] || sub.periodUnit})` : '';

        let lunarExpiryText = '';
        if (showLunar) {
          const expiryDateObj = new Date(sub.expiryDate);
          const lunarExpiry = lunarCalendar.solar2lunar(expiryDateObj.getFullYear(), expiryDateObj.getMonth() + 1, expiryDateObj.getDate());
          lunarExpiryText = lunarExpiry ? ` (Lunar: ${lunarExpiry.fullStr})` : '';
        }

        let statusText;
        if (sub.daysRemaining === 0) statusText = `⚠️ **${sub.name}** (${typeText}) ${periodText} is due today!${lunarExpiryText}`;
        else if (sub.daysRemaining < 0) statusText = `🚨 **${sub.name}** (${typeText}) ${periodText} expired ${Math.abs(sub.daysRemaining)} days ago${lunarExpiryText}`;
        else statusText = `📅 **${sub.name}** (${typeText}) ${periodText} will expire in ${sub.daysRemaining} days${lunarExpiryText}`;

        if (sub.notes) statusText += `\n   Notes: ${sub.notes}`;
        commonContent += statusText + '\n\n';
      }

      const title = 'Subscription Expiry Reminder';
      await sendNotificationToAllChannels(title, commonContent, config, '[Cron Job]');
    }
  } catch (error) {
    console.error('[Cron Job] Failed to check expiring subscriptions:', error);
  }
}


function getCookieValue(cookieString, key) {
  if (!cookieString) return null;

  const match = cookieString.match(new RegExp('(^| )' + key + '=([^;]+)'));
  return match ? match[2] : null;
}

async function handleRequest(request, env, ctx) {
  return new Response(loginPage, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

const CryptoJS = {
  HmacSHA256: function(message, key) {
    const keyData = new TextEncoder().encode(key);
    const messageData = new TextEncoder().encode(message);

    return Promise.resolve().then(() => {
      return crypto.subtle.importKey(
        "raw",
        keyData,
        { name: "HMAC", hash: {name: "SHA-256"} },
        false,
        ["sign"]
      );
    }).then(cryptoKey => {
      return crypto.subtle.sign(
        "HMAC",
        cryptoKey,
        messageData
      );
    }).then(buffer => {
      const hashArray = Array.from(new Uint8Array(buffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    });
  }
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Add debug page
    if (url.pathname === '/debug') {
      try {
        const config = await getConfig(env);
        const d1Binding = !!env.DB;
        let d1QuerySuccess = false;
        let d1Error = "N/A";
        if(d1Binding) {
            try {
                await env.DB.prepare("SELECT 1").first();
                d1QuerySuccess = true;
            } catch(e) {
                d1Error = e.message;
            }
        }

        const debugInfo = {
          timestamp: new Date().toISOString(),
          pathname: url.pathname,
          kvBinding: !!env.SUBSCRIPTIONS_KV,
          d1Binding: d1Binding,
          d1QuerySuccess: d1QuerySuccess,
          d1Error: d1Error,
          configExists: !!config,
          adminUsername: config.ADMIN_USERNAME,
          hasJwtSecret: !!config.JWT_SECRET,
          jwtSecretLength: config.JWT_SECRET ? config.JWT_SECRET.length : 0
        };

        return new Response(`
<!DOCTYPE html>
<html>
<head>
  <title>Debug Info</title>
  <style>
    body { font-family: monospace; padding: 20px; background: #f5f5f5; }
    .info { background: white; padding: 15px; margin: 10px 0; border-radius: 5px; }
    .success { color: green; }
    .error { color: red; }
  </style>
</head>
<body>
  <h1>System Debug Info</h1>
  <div class="info">
    <h3>Basic Info</h3>
    <p>Time: ${debugInfo.timestamp}</p>
    <p>Path: ${debugInfo.pathname}</p>
    <p class="${debugInfo.kvBinding ? 'success' : 'error'}">KV Binding (for config): ${debugInfo.kvBinding ? '✓' : '✗'}</p>
    <p class="${debugInfo.d1Binding ? 'success' : 'error'}">D1 Binding (for data): ${debugInfo.d1Binding ? '✓' : '✗'}</p>
    <p class="${debugInfo.d1QuerySuccess ? 'success' : 'error'}">D1 Test Query: ${debugInfo.d1QuerySuccess ? '✓ Success' : '✗ Failed'}</p>
    ${!debugInfo.d1QuerySuccess ? `<p class="error">D1 Error: ${debugInfo.d1Error}</p>` : ''}
  </div>

  <div class="info">
    <h3>Config Info</h3>
    <p class="${debugInfo.configExists ? 'success' : 'error'}">Config exists: ${debugInfo.configExists ? '✓' : '✗'}</p>
    <p>Admin Username: ${debugInfo.adminUsername}</p>
    <p class="${debugInfo.hasJwtSecret ? 'success' : 'error'}">JWT Secret: ${debugInfo.hasJwtSecret ? '✓' : '✗'} (Length: ${debugInfo.jwtSecretLength})</p>
  </div>

  <div class="info">
    <h3>Solutions</h3>
    <p>1. Ensure a KV namespace is correctly bound as SUBSCRIPTIONS_KV for storing settings.</p>
    <p>2. Ensure a D1 database is correctly bound as DB for storing subscription data.</p>
    <p>3. If D1 test query fails, check the binding name and ensure the database has been created.</p>
    <p>4. Try accessing <a href="/">/</a> to log in.</p>
    <p>5. If problems persist, check the Cloudflare Workers logs.</p>
  </div>
</body>
</html>`, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      } catch (error) {
        return new Response(`Debug page error: ${error.message}`, {
          status: 500,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }
    }

    if (url.pathname.startsWith('/api')) {
      return api.handleRequest(request, env, ctx);
    } else if (url.pathname.startsWith('/admin')) {
      return admin.handleRequest(request, env, ctx);
    } else {
      return handleRequest(request, env, ctx);
    }
  },

  async scheduled(event, env, ctx) {
    const now = new Date();
    const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    console.log('[Workers] Cron Job triggered UTC:', now.toISOString(), 'Beijing Time:', beijingTime.toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'}));
    ctx.waitUntil(checkExpiringSubscriptions(env));
  }
};