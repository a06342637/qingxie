(() => {
  'use strict';
  const C = LightType;
  const $ = id => document.getElementById(id);
  const paths = {
    user: '<circle cx="12" cy="8" r="3"/><path d="M5 21v-3a7 7 0 0 1 14 0v3"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/>',
    phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4M10 5h4"/>',
    profile: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M6 16c0-4 6-4 6 0M15 8h3M15 12h3M15 16h2"/>',
    card: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20M6 15h3"/>',
    settings: '<path d="m9 3-1 3-3 1v4l-2 1 2 3v3l4 1 3 2 3-2 4-1v-3l2-3-2-1V7l-3-1-1-3z"/><circle cx="12" cy="12" r="3"/>',
    linode: '<path d="m12 2 8 4-8 4-8-4zM4 11l8 4 8-4M4 16l8 4 8-4"/>',
    aws: '<path d="M3 15 7 5l4 10M5 11h4M13 7h6l-6 8h6M4 19c6 3 12 3 16-1"/>',
    oracle: '<rect x="2" y="6" width="20" height="12" rx="6"/>',
    azure: '<path d="m9 3-7 17h8l5-5H8l5-12zM15 6l7 14H12"/>',
    refresh: '<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',
    play: '<path d="m9 5 11 7-11 7zM3 5v14"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7"/><circle cx="12" cy="12" r="3"/>',
    shield: '<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6zM8 12l3 3 5-6"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.user}</svg>`;
  const esc = x => String(x).replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  const extension = typeof chrome !== 'undefined' && !!chrome.storage;
  const query = new URLSearchParams(location.search);
  let linkedTabId = query.has('targetTab') && /^\d+$/.test(query.get('targetTab')) ? Number(query.get('targetTab')) : null;
  const sourceWindowId = query.has('sourceWindow') && /^\d+$/.test(query.get('sourceWindow')) ? Number(query.get('sourceWindow')) : null;
  const injectedDocuments = new Set();
  const PLATFORM_IDS = ['aws', 'linode', 'oracle', 'azure', 'settings'];
  const WIDE_STEPS = ['profile', 'card', 'oci-address', 'oci-card'];
  let config = C.settings(), drafts = {}, pastes = {}, stepId = 'signup', platform = location.hash === '#settings' ? 'settings' : 'linode';
  let tabId = null, connected = false, detected = null, busy = false, taskTab = null, taskFrame = null, taskState = 'idle';
  let toastTimer, pollBusy = false, lastClearedRun = null;
  function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3200); }
  function platformOfUrl(url) {
    if (!url) return null;
    if (url.startsWith('https://login.linode.com/')) return 'linode';
    if (/^https:\/\/(signup\.cloud\.oracle\.com|shop\.oracle\.com)\//.test(url)) return 'oracle';
    return null;
  }
  function platformTitle(id) { return (C.platforms.find(p => p.id === id) || { title: String(id).toUpperCase() }).title; }
  function persist() {
    if (!extension) return Promise.resolve();
    return chrome.runtime.sendMessage({ type: 'LIGHT_SAVE', settings: config, drafts, pastes, step: stepId, platform })
      .then(result => { if (!result?.ok) throw new Error('保存失败'); })
      .catch(() => toast('保存失败，请检查插件存储权限'));
  }
  function saveSoon() { void persist(); }
  function renderNav() {
    $('platforms').innerHTML = PLATFORM_IDS.map(p => `<button class="platform ${p === platform ? 'active' : ''} ${p}" data-platform="${p}" aria-current="${p === platform ? 'page' : 'false'}">${icon(p)}<span>${p === 'settings' ? '设置' : platformTitle(p)}</span></button>`).join('');
    const list = C.stepsFor(platform);
    $('steps').innerHTML = list.map((s, i) => `<button class="step ${s.id === stepId ? 'active' : ''}" data-step="${s.id}" ${busy ? 'disabled' : ''} aria-current="${s.id === stepId ? 'step' : 'false'}">${icon(s.icon)}<span><strong>${s.title}</strong><small>0${i + 1}</small></span></button>`).join('');
    const heading = document.querySelector('.rail-heading');
    if (heading) heading.innerHTML = `${platformTitle(platform)} <span>01—0${list.length || 5}</span>`;
  }
  function render() {
    renderNav();
    const list = C.stepsFor(platform);
    const hasSteps = list.length > 0;
    if (hasSteps && !list.some(s => s.id === stepId)) stepId = list[0].id;
    $('main').dataset.stage = hasSteps ? stepId : '';
    document.querySelector('.sidebar').hidden = !hasSteps;
    $('task-area').hidden = !hasSteps;
    if (platform === 'settings') renderSettings();
    else if (!hasSteps) $('main').innerHTML = `<div class="empty"><section class="card"><div class="empty-icon">${icon(platform)}</div><p class="eyebrow">NEXT WORKSPACE</p><h2>${platformTitle(platform)}</h2><span class="badge">已预留位置</span><p>这个平台的填写模块尚未开放。<br>目前可直接使用 LINODE 与 ORACLE。</p><button class="primary" data-platform="linode">前往 LINODE</button></section></div>`;
    else renderStep();
    updateControls();
  }
  function fieldControl(f) {
    const value = drafts[stepId]?.[f.key] || '';
    if (f.control === 'radio') return `<div class="choice-group">${(f.options || []).map(o => `<label class="${value === o.value ? 'active' : ''}"><input type="radio" name="field-${f.key}" value="${esc(o.value)}" data-field="${f.key}" ${value === o.value ? 'checked' : ''} ${busy ? 'disabled' : ''}>${esc(o.label)}</label>`).join('')}</div>`;
    if (f.control === 'select') return `<select id="field-${f.key}" data-field="${f.key}" ${busy ? 'disabled' : ''}><option value="">请选择</option>${(f.options || []).map(o => `<option value="${esc(o.value)}" ${value === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    return `<div class="input-wrap"><input id="field-${f.key}" data-field="${f.key}" type="${f.type || 'text'}" placeholder="${esc(f.placeholder)}" autocomplete="off" spellcheck="false" ${f.numeric ? 'inputmode="numeric"' : ''} ${busy ? 'disabled' : ''}>${f.type === 'password' ? `<button class="eye" data-eye="field-${f.key}" title="显示或隐藏${f.label}" aria-label="显示或隐藏${f.label}">${icon('eye')}</button>` : ''}</div>`;
  }
  function renderStep() {
    const s = C.stepById(stepId); if (!s) return;
    const list = C.stepsFor(platform), n = list.indexOf(s) + 1;
    $('main').innerHTML = `<section class="card"><p class="eyebrow">0${n} · ${s.en}</p><div class="title-row"><h2>${s.title}</h2><span class="badge">${['card', 'oci-card'].includes(s.id) ? '临时填写' : '逐字输入'}</span></div><p class="hint">${s.hint}</p>${s.url ? `<button class="text-link" id="open-signup">打开 ${platformTitle(platform)} 注册页 ↗</button>` : ''}</section>
      <section class="card"><div class="section-label">填写内容<span>${s.fields.length} 个字段</span></div><div class="fields">${s.fields.map(f => `${s.id === 'phone' && f.key === 'otp' ? '<div class="subhead">02 · 收到短信后填写</div>' : ''}<div class="field ${f.wide || !WIDE_STEPS.includes(s.id) ? 'wide' : ''}"><label for="field-${f.key}">${f.label}</label>${fieldControl(f)}</div>`).join('')}</div>
      ${s.id === 'phone' ? '<div class="phone-actions"><button data-fill="phone">仅填写手机号</button><button data-fill="otp">仅填写验证码</button></div>' : ''}
      <p class="small-note secure">${icon('shield')}${s.fields.some(f => f.sensitive) ? '密码、验证码及卡片资料只临时保留；完成后清空，重启浏览器后失效。' : '普通资料可自动保存在本机，随时可在设置中清空。'}</p></section>
      <details class="card"><summary>整段粘贴<span>解析到上方字段</span></summary><div class="paste-box"><textarea id="paste" aria-label="待解析的资料" autocomplete="off" spellcheck="false"></textarea><p class="small-note">支持“字段名：内容”、JSON，或按当前字段顺序逐行粘贴。解析后先核对，再点击填写。</p><div class="paste-controls"><button class="text-link" id="example">查看本页格式</button><button id="parse">解析内容</button></div><p id="parse-result" class="parse-result" role="status"></p></div></details>`;
    for (const f of s.fields) { const el = $('field-' + f.key); if (el && el.tagName !== 'SELECT' && !el.type?.includes('radio')) el.value = drafts[stepId]?.[f.key] || ''; }
    const format = pasteFormat(s);
    $('paste').placeholder = format.example;
    $('paste').nextElementSibling.textContent = format.help;
    $('paste').value = pastes[stepId] || '';
    $('main').scrollTop = 0;
  }
  function pasteFormat(s) {
    if (s.id === 'signup') return {
      example: 'name@example.com\nyour_username\nyour_password',
      help: '三行格式：第一行邮箱，第二行用户名，第三行密码。密码中的符号和空格会原样保留。也支持字段名和 JSON。解析后先核对，再点击填写。'
    };
    if (s.id === 'oci-signup') return {
      example: 'Trinidad and Tobago\nJohn\nDoe\nname@example.com',
      help: '四行格式：账单国家/地区、名、姓、邮箱。国家可写英文全名或两位代码。也支持字段名和 JSON。'
    };
    if (s.id === 'card') return {
      example: '卡号|月份|年份|cvv',
      help: '格式：卡号|月份|年份|cvv。月份支持 1–12，年份支持两位或四位；解析后自动合并为有效期。也兼容原来的字段名和 JSON 格式。解析后先核对，再点击填写。'
    };
    if (s.id === 'oci-card') return {
      example: 'visa|4111111111111111|9|2029|001',
      help: '五段格式：卡类型|卡号|月份|年份|cvv；卡类型可省略，写成四段 卡号|月份|年份|cvv。也支持字段名和 JSON。'
    };
    if (s.id === 'profile') return {
      example: s.fields.map(f => `${f.label}：${f.placeholder}`).join('\n'),
      help: '使用字段名或 JSON；整段地图地址暂不支持自动拆分。'
    };
    return {
      example: s.fields.map(f => `${f.label}：${f.placeholder}`).join('\n'),
      help: '支持“字段名：内容”、JSON，或按当前字段顺序逐行粘贴。解析后先核对，再点击填写。'
    };
  }
  function range(key, label, unit, min, max, step, help) { return `<div class="setting-row"><div class="setting-head"><label for="setting-${key}">${label}</label><output id="output-${key}">${config[key]} ${unit}</output></div><input id="setting-${key}" data-setting="${key}" data-unit="${unit}" type="range" min="${min}" max="${max}" step="${step}" value="${config[key]}" ${busy ? 'disabled' : ''}><p>${help}</p></div>`; }
  function renderSettings() {
    $('main').innerHTML = `<div class="settings-title"><p class="eyebrow">YOUR PACE, YOUR WAY</p><h2>输入设置</h2><p class="hint">找到适合你的节奏。修改后自动保存。</p></div>
      <section class="card"><div class="section-label">输入节奏<span>全局设置</span></div>${range('interval', '字符间隔', 'ms', 20, 500, 5, '数值越小，填写越快。')}${range('jitter', '间隔浮动', '%', 0, 80, 5, '在设定间隔附近随机变化；0 表示匀速。')}${range('fieldDelay', '字段之间停顿', 'ms', 0, 2000, 50, '填完一项，再开始下一项的等待时间。')}<div class="presets"><button data-preset="slow">舒缓</button><button data-preset="normal">日常</button><button data-preset="fast">快速</button></div></section>
      <section class="card"><div class="section-label">打字与修正<span>全部输入字段</span></div><div class="setting-row toggle-row"><div><label for="setting-typoEnabled">启用打错后删除</label><p>适用于邮箱、密码、验证码、手机号、卡片等所有文字和数字输入框。下拉框直接选择。</p></div><input id="setting-typoEnabled" data-setting="typoEnabled" type="checkbox" ${config.typoEnabled ? 'checked' : ''} ${busy ? 'disabled' : ''}></div>${range('typoRate', '打错后删除概率', '%', 1, 100, 1, '每次开始输入一段内容时按此概率触发，连续打错 1–3 个字符，退格删除后再写正确内容。100% 表示每段都会先打错再修正。')}${range('correctionDelay', '修正前停顿', 'ms', 80, 1000, 20, '打完一段错字后等待，再逐个删除并重写。例如 12366 → 1236 → 123 → 1234 → 12345。')}</section>
      <section class="card"><div class="section-label">填写偏好</div><div class="setting-row"><div class="setting-head"><label for="setting-existing">网页已有内容时</label></div><select id="setting-existing" data-setting="existing" ${busy ? 'disabled' : ''}><option value="skip">跳过已有内容</option><option value="replace">清空后重新填写</option><option value="append">追加到末尾（普通文本）</option></select><p>默认跳过已填写项，包括国家默认选项。需要修改时选“清空后重新填写”。追加模式下，密码、验证码、手机号和卡片仍使用替换。</p></div><div class="setting-row toggle-row"><div><label for="setting-remember">记住普通资料</label><p>保存在此浏览器本机，不同步到云端。</p></div><input id="setting-remember" data-setting="remember" type="checkbox" ${config.remember ? 'checked' : ''}></div></section>
      <section class="card"><div class="section-label">数据管理</div><p class="small-note">清除插件中的所有草稿，包括临时敏感资料。网页上已填写的内容保持原样。</p><p><button id="clear-data" class="danger-button" ${busy ? 'disabled' : ''}>清空所有资料</button></p><button id="reset-settings" class="text-link" ${busy ? 'disabled' : ''}>恢复默认设置</button></section>
      <section class="card about"><strong>轻写 v1.7.0 · 720 × 600 工具栏弹窗</strong><br>仅在 login.linode.com 与 signup.cloud.oracle.com 填写你输入的内容。<br>逐字写入网页并触发输入事件，属于程序输入；不保证等同于物理键盘。不会自动提交或发送验证码。<br>密码、验证码、卡片暂存在浏览器会话内存，15 分钟后失效，填写完成后清空。<br>点击弹窗外会收起界面，已开始的填写继续；再次点击图标可查看进度。网页按 Esc 可停止，切换标签页或手动操作网页会暂停。</section>`;
    $('setting-existing').value = config.existing;
    updateControls();
  }
  function updateControls() {
    $('start').innerHTML = icon('play') + (busy ? '正在填写…' : '模拟手动写入');
    $('start').disabled = busy || !connected || detected !== stepId;
    $('pause').hidden = !busy; $('stop').hidden = !busy;
    $('pause').textContent = taskState === 'paused' ? '继续' : '暂停';
    $('speed-summary').textContent = `${config.interval} ms / 字符 · ${config.typoEnabled ? `修正 ${config.typoRate}%` : '准确输入'}`;
    document.querySelectorAll('[data-fill]').forEach(b => { b.disabled = busy || !connected || detected !== stepId; });
    document.querySelectorAll('[data-step],[data-field],[data-preset],#parse,#clear-data,#reset-settings,[data-setting]:not([type="checkbox"])').forEach(b => { b.disabled = busy; });
    const toggle = $('setting-typoEnabled');
    if (toggle) toggle.disabled = busy;
    for (const key of ['typoRate', 'correctionDelay']) {
      const input = $('setting-' + key);
      if (input) input.disabled = busy || !config.typoEnabled;
    }
  }
  function showStatus(s, fromTab) {
    const wasBusy = busy;
    taskState = s.state || 'idle'; busy = ['running', 'paused'].includes(taskState);
    if (busy) taskTab = fromTab;
    $('task-message').textContent = s.message || '准备就绪';
    $('task-message').style.color = taskState === 'error' ? 'var(--red)' : '';
    $('task-count').textContent = `${s.completed || 0} / ${s.total || 0}`;
    $('progress-bar').style.width = s.total ? `${Math.round((s.completed || 0) / s.total * 100)}%` : '0%';
    if (taskState === 'done' && s.runId && s.runId !== lastClearedRun) {
      lastClearedRun = s.runId;
      const completedStep = C.stepById(s.jobStage);
      completedStep?.fields.filter(f => f.sensitive).forEach(f => { if (drafts[completedStep.id]) delete drafts[completedStep.id][f.key]; });
      delete pastes[s.jobStage];
      if (completedStep?.id === stepId && C.stepsFor(platform).length) renderStep();
    }
    if (!busy) { taskTab = null; taskFrame = null; }
    if (wasBusy !== busy) renderNav();
    updateControls();
  }
  async function activeTab() {
    if (linkedTabId !== null) return chrome.tabs.get(linkedTabId);
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true }); return tabs[0];
  }
  async function findCardFrame(tabId) {
    // Inject into every frame we can reach, then let each frame report whether the card form is
    // actually in its own document tree. A blob/about:blank gateway frame inherits its parent's
    // URL, so probing the DOM from outside cannot tell the frames apart reliably.
    let results;
    try { results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['core.js', 'content.js'] }); }
    catch { return null; }
    for (const frameId of [...new Set(results.map(r => r.frameId))]) {
      try {
        const s = await chrome.tabs.sendMessage(tabId, { type: 'LIGHT_INSPECT' }, { frameId });
        if (s?.ok && s.cardFrame) return frameId;
      } catch { /* frame has no content script */ }
    }
    return null;
  }
  async function inspect(manual = false) {
    if (!extension) { $('connection-text').textContent = '界面预览 · 在 Chrome 导入后连接网页'; return; }
    if (pollBusy) return; pollBusy = true;
    try {
      const tab = busy && taskTab ? await chrome.tabs.get(taskTab) : await activeTab();
      tabId = tab?.id;
      if (!platformOfUrl(tab?.url)) throw new Error('请打开 Linode 或 Oracle 注册页面');
      let s;
      try { s = await chrome.tabs.sendMessage(tabId, { type: 'LIGHT_INSPECT' }); }
      catch {
        const key = `${tabId}:${tab.url}`;
        if (!manual && injectedDocuments.has(key)) throw new Error('请刷新页面或点击重新识别');
        injectedDocuments.add(key);
        await chrome.scripting.executeScript({ target: { tabId }, files: ['core.js', 'content.js'] });
        s = await chrome.tabs.sendMessage(tabId, { type: 'LIGHT_INSPECT' });
      }
      if (!s?.ok) throw new Error('页面连接失败，请刷新网页');
      connected = true; detected = s.stage;
      if (s.platform && platform !== 'settings' && PLATFORM_IDS.includes(s.platform)) platform = s.platform;
      const step = C.stepById(detected);
      $('connection-text').textContent = `${String(tab.url).replace(/^https:\/\//, '').split('/')[0]} · ${step ? step.title : '未识别填写步骤'}`;
      if (manual && detected && !busy) { stepId = detected; render(); saveSoon(); }
      showStatus(s, tabId);
      if (!busy && detected !== stepId) $('task-message').textContent = detected ? `网页当前为“${step.title}”，点击右上方重新识别可切换` : '当前网页未发现可填写的表单';
    } catch (error) {
      connected = false; detected = null;
      $('connection-text').textContent = error.message;
      if (busy) showStatus({ state: 'error', message: '原页面已关闭或跳转，填写已结束，请检查网页' });
      else $('task-message').textContent = '打开对应网页，再点击重新识别';
    } finally { $('connection-dot').classList.toggle('online', connected); pollBusy = false; updateControls(); }
  }
  async function start(only) {
    if (busy || !extension) return;
    const tab = await activeTab();
    if (!platformOfUrl(tab?.url)) { toast('请回到要填写的注册页面'); return; }
    if (!tab.active) { toast('请先点击“返回网页”，再开始填写'); return; }
    tabId = tab.id;
    let values = { ...(drafts[stepId] || {}) };
    if (only === 'phone') delete values.otp;
    if (only === 'otp') values = { otp: values.otp || '' };
    const step = C.stepById(stepId);
    if (step.id === 'oci-password' && values.password && !values.matchPassword) values.matchPassword = values.password;
    for (const f of step.fields) { values[f.key] = C.normalize(f, values[f.key] ?? ''); const error = C.validate(f, values[f.key]); if (error) { toast(error); $('field-' + f.key)?.focus(); return; } }
    if (!Object.values(values).some(Boolean)) { toast('请先输入要填写的内容'); return; }
    $('start').disabled = true;
    try {
      await persist();
      let frameId;
      if (step.frame) {
        frameId = await findCardFrame(tab.id);
        if (frameId == null) throw new Error('请先在网页点击 Add payment verification method 打开支付框');
      }
      const message = { type: 'LIGHT_START', stage: stepId, values, settings: config };
      const s = frameId == null ? await chrome.tabs.sendMessage(tab.id, message) : await chrome.tabs.sendMessage(tab.id, message, { frameId });
      if (!s?.ok) throw new Error(s?.error || '无法开始填写');
      taskFrame = frameId ?? null;
      showStatus(s, tab.id);
    } catch (error) { toast(error.message); $('task-message').textContent = error.message; }
    finally { updateControls(); }
  }
  document.addEventListener('input', event => {
    const el = event.target;
    if (el.dataset.field) {
      (drafts[stepId] ||= {})[el.dataset.field] = el.value;
      if (el.type === 'radio') {
        const group = el.closest('.choice-group');
        if (group) [...group.querySelectorAll('label')].forEach(label => label.classList.toggle('active', label.contains(el)));
      }
      saveSoon();
    }
    if (el.id === 'paste') { pastes[stepId] = el.value; saveSoon(); }
    if (el.dataset.setting) {
      config = C.settings({ ...config, [el.dataset.setting]: el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value });
      if ($('output-' + el.dataset.setting)) $('output-' + el.dataset.setting).textContent = `${config[el.dataset.setting]} ${el.dataset.unit}`;
      saveSoon(); updateControls();
    }
  });
  document.addEventListener('click', async event => {
    const b = event.target.closest('button'); if (!b || b.disabled) return;
    try {
      if (b.dataset.platform) { platform = b.dataset.platform; render(); saveSoon(); }
      else if (b.dataset.step) { stepId = b.dataset.step; render(); saveSoon(); void inspect(); }
      else if (b.dataset.eye) { const el = $(b.dataset.eye); el.type = el.type === 'password' ? 'text' : 'password'; }
      else if (b.dataset.fill) await start(b.dataset.fill);
      else if (b.dataset.preset) { const preset = { slow: { interval: 180, jitter: 40, fieldDelay: 700 }, normal: { interval: 95, jitter: 35, fieldDelay: 400 }, fast: { interval: 35, jitter: 15, fieldDelay: 150 } }[b.dataset.preset]; config = C.settings({ ...config, ...preset }); renderSettings(); saveSoon(); toast('已应用输入节奏'); }
      else if (b.id === 'open-settings') { platform = 'settings'; render(); saveSoon(); }
      else if (b.id === 'refresh') await inspect(true);
      else if (b.id === 'start') await start();
      else if (b.id === 'pause' || b.id === 'stop') {
        const message = { type: b.id === 'pause' ? 'LIGHT_PAUSE' : 'LIGHT_STOP' };
        const result = taskFrame == null ? await chrome.tabs.sendMessage(taskTab || tabId, message) : await chrome.tabs.sendMessage(taskTab || tabId, message, { frameId: taskFrame });
        if (!result?.ok) throw new Error(result?.error || '无法控制任务');
        if (b.id === 'pause') showStatus(result, taskTab || tabId);
      }
      else if (b.id === 'focus-page') {
        const target = await chrome.tabs.get(taskTab || linkedTabId || tabId);
        await chrome.tabs.update(target.id, { active: true });
        await chrome.windows.update(target.windowId, { focused: true });
      }
      else if (b.id === 'open-signup') {
        if (extension) {
          const url = C.stepById(stepId)?.url || 'https://login.linode.com/signup';
          const created = await chrome.tabs.create({ url, ...(sourceWindowId !== null ? { windowId: sourceWindowId } : {}) });
          if (query.has('floating')) {
            linkedTabId = created.id; query.set('targetTab', String(created.id));
            history.replaceState(null, '', `?${query}`);
            void inspect();
          }
        }
      }
      else if (b.id === 'example') {
        const s = C.stepById(stepId);
        $('paste').value = ['signup', 'card', 'oci-signup', 'oci-card'].includes(stepId) ? pasteFormat(s).example : s.fields.map(f => `${f.label}：`).join('\n');
        pastes[stepId] = $('paste').value; saveSoon(); $('paste').focus();
      }
      else if (b.id === 'parse') {
        const result = C.parse(stepId, $('paste').value);
        if (!Object.keys(result.values).length) { $('parse-result').textContent = result.warnings.join('；') || '没有识别到内容，请查看本页格式'; return; }
        Object.assign(drafts[stepId] ||= {}, result.values);
        Object.entries(result.values).forEach(([key, value]) => { const el = $('field-' + key); if (!el) return; if (el.type === 'radio') { [...document.querySelectorAll(`[data-field="${key}"]`)].forEach(r => { r.checked = r.value === value; }); const group = el.closest('.choice-group'); if (group) [...group.querySelectorAll('label')].forEach(label => label.classList.toggle('active', label.contains(document.querySelector(`[data-field="${key}"][value="${value}"]`)))); } else el.value = value; });
        $('paste').value = '';
        delete pastes[stepId];
        $('parse-result').textContent = `已解析 ${Object.keys(result.values).length} 项，请核对上方内容。${result.warnings.join('；')}`;
        saveSoon();
      } else if (b.id === 'clear-data') { drafts = {}; pastes = {}; await persist(); toast('已清空所有插件资料'); }
      else if (b.id === 'reset-settings') { config = C.settings(); renderSettings(); await persist(); toast('已恢复默认设置'); }
    } catch (error) {
      if (b.id === 'parse') $('parse-result').textContent = error.message || '解析失败，请检查格式';
      toast(error.message || '操作失败，请重试');
    }
  });
  if (extension) chrome.runtime.onMessage.addListener((m, sender) => {
    if (m.type !== 'LIGHT_STATUS' || sender.id !== chrome.runtime.id || !sender.tab || sender.tab.id !== (taskTab || tabId)) return;
    showStatus(m.payload, sender.tab.id);
  });
  async function init() {
    if (extension) {
      const { local, session, ok } = await chrome.runtime.sendMessage({ type: 'LIGHT_LOAD' });
      if (!ok) throw new Error('载入资料失败');
      config = C.settings(local.settings);
      // Reclassify loaded data so sensitive keys cannot persist in local storage.
      drafts = C.splitDrafts(config.remember ? local.drafts || {} : {}).saved;
      const temp = session.draftSession;
      if (temp?.expires > Date.now()) {
        for (const s of C.allSteps) Object.assign(drafts[s.id] ||= {}, C.splitDrafts(temp.transient || {}).transient[s.id]);
        pastes = temp.pastes || {};
      }
      if (C.allSteps.some(s => s.id === temp?.step)) stepId = temp.step;
      if (location.hash !== '#settings' && PLATFORM_IDS.includes(temp?.platform)) platform = temp.platform;
      const task = session.activeTask;
      lastClearedRun = task?.clearedRun || null;
      if (task && ['running', 'paused'].includes(task.state)) {
        const sourceId = linkedTabId !== null ? (await chrome.tabs.get(linkedTabId)).windowId : (await chrome.windows.getCurrent()).id;
        if (sourceId === task.windowId) {
          taskTab = task.tabId; busy = true; taskState = task.state;
          stepId = task.jobStage; platform = C.stepById(task.jobStage)?.platform || 'linode';
        }
      }
    }
    $('open-settings').innerHTML = icon('settings'); $('refresh').innerHTML = icon('refresh');
    $('focus-page').hidden = linkedTabId === null;
    render(); await inspect();
    setInterval(() => { void inspect(); }, 1200);
    // Remove inactive sensitive drafts after 15 minutes, including while the panel stays open.
    if (extension) setInterval(async () => {
      if (busy) return;
      const session = await chrome.storage.session.get('draftSession');
      if (session.draftSession?.expires <= Date.now()) {
        drafts = C.splitDrafts(drafts).saved;
        pastes = {};
        await persist(); if (C.stepsFor(platform).length) renderStep();
      }
    }, 30000);
  }
  void init().catch(() => { $('connection-text').textContent = '初始化失败，请重新加载插件'; });
})();
