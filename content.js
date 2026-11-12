(() => {
  'use strict';
  const version = chrome.runtime.getManifest().version;
  if (globalThis.__lightTypeInstalled === version && globalThis.__lightTypeAlive?.()) return;
  globalThis.__lightTypeInstalled = version;
  const runtime = chrome.runtime;
  globalThis.__lightTypeAlive = () => Boolean(runtime.id);
  const C = globalThis.LightType;
  const host = location.hostname;
  const PLATFORM = host === 'login.linode.com' ? 'linode' : /(^|\.)oracle\.com$/.test(host) ? 'oracle' : null;
  let job = null;
  let status = { state: 'idle', message: '等待填写', completed: 0, total: 0, skipped: 0 };
  const winOf = el => el?.ownerDocument?.defaultView || window;
  const visible = el => {
    if (!el || !el.isConnected) return false;
    const style = winOf(el).getComputedStyle(el);
    return el.getClientRects().length > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const editable = el => visible(el) && !el.disabled && !el.readOnly && !el.closest('[inert]') && !el.classList.contains('inactive-field') && !el.classList.contains('honeypot-field');
  const fire = (el, type) => { const win = winOf(el); el.dispatchEvent(new win.Event(type, { bubbles: true })); };
  const flat = x => String(x ?? '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9一-鿿]/g, '');

  // --- Linode ---
  function detectLinode() {
    if (visible(document.querySelector('#cc_number')) && editable(document.querySelector('#cc_number'))) return 'card';
    if (visible(document.querySelector('#first_name'))) return 'profile';
    if (document.querySelector('#phone_number') && (visible(document.querySelector('#phone_number')) || visible(document.querySelector('#otp')))) return 'phone';
    if (visible(document.querySelector('#email')) && visible(document.querySelector('#password'))) return 'signup';
    if (visible(document.querySelector('#otp')) && location.pathname.includes('verify-email')) return 'email';
    return null;
  }

  // --- Oracle ---
  const CARD_SELECTORS = [
    'input[autocomplete="cc-number"]', 'input[autocomplete="cc-csc"]', 'input[autocomplete="cc-exp"]',
    'input[name*="card" i]', 'input[id*="card" i]', 'input[name*="cvv" i]', 'input[id*="cvv" i]',
    'input[name*="cvc" i]', 'input[id*="cvc" i]', 'input[name*="expir" i]', 'input[id*="expir" i]',
    'select[name*="month" i]', 'select[name*="year" i]', 'select[name*="expir" i]'
  ];
  const CARD_FIELD_SELECTORS = {
    cc_number: ['input[autocomplete="cc-number"]', 'input[name*="cardnumber" i]', 'input[name*="card_number" i]', 'input[id*="cardnumber" i]', 'input[id*="card-number" i]', 'input[name*="pan" i]', 'input[id*="pan" i]', 'input[placeholder*="card number" i]', 'input[name*="card" i]', 'input[id*="card" i]'],
    cc_expiration: ['input[autocomplete="cc-exp"]', 'input[name*="expir" i]', 'input[id*="expir" i]', 'input[name*="exp" i]', 'input[id*="exp" i]', 'input[placeholder*="MM" i]', 'input[placeholder*="expir" i]'],
    cvv: ['input[autocomplete="cc-csc"]', 'input[name*="cvv" i]', 'input[name*="cvc" i]', 'input[name*="csc" i]', 'input[id*="cvv" i]', 'input[id*="cvc" i]', 'input[id*="csc" i]', 'input[id*="security" i]', 'input[placeholder*="CVV" i]', 'input[placeholder*="CVC" i]', 'input[placeholder*="security" i]']
  };
  const CARD_BRANDS = { visa: ['visa'], mastercard: ['mastercard', 'master card'], amex: ['amex', 'american express'], discover: ['discover'], diners: ['diners', 'diner'] };
  function docsUnder(root = document, depth = 0) {
    const list = [root];
    if (depth >= 3) return list;
    for (const frame of root.querySelectorAll('iframe')) {
      try { const inner = frame.contentDocument; if (inner) list.push(...docsUnder(inner, depth + 1)); } catch { /* cross-origin frame */ }
    }
    return list;
  }
  function cardDoc() {
    for (const doc of docsUnder()) if (CARD_SELECTORS.some(sel => doc.querySelector(sel))) return doc;
    return null;
  }
  function findIn(doc, selectors) { return doc ? selectors.flatMap(s => [...doc.querySelectorAll(s)]).find(visible) : null; }
  function cardBrandControl() {
    const doc = cardDoc() || document;
    for (const sel of [...doc.querySelectorAll('select')].filter(visible)) {
      const text = [...sel.options].map(o => (o.textContent || '').toLowerCase()).join(' ');
      if (/(visa|mastercard|amex|american express|discover|diners)/.test(text)) return { kind: 'select', el: sel };
    }
    const radios = [...doc.querySelectorAll('input[type="radio"]')].filter(visible)
      .filter(r => /(visa|mastercard|amex|american express|discover|diners)/i.test(`${r.value} ${r.closest('label')?.textContent || ''} ${r.id} ${r.name}`));
    return radios.length ? { kind: 'radio', el: radios[0], inputs: radios } : null;
  }
  function expiryControl() {
    const doc = cardDoc() || document;
    const combined = findIn(doc, CARD_FIELD_SELECTORS.cc_expiration);
    if (combined) return { combined };
    const month = findIn(doc, ['select[autocomplete="cc-exp-month"]', 'input[autocomplete="cc-exp-month"]', 'select[name*="month" i]', 'input[name*="month" i]', 'select[id*="month" i]']);
    const year = findIn(doc, ['select[autocomplete="cc-exp-year"]', 'input[autocomplete="cc-exp-year"]', 'select[name*="year" i]', 'input[name*="year" i]', 'select[id*="year" i]']);
    return month && year ? { month, year } : null;
  }
  function reactSelectRoot(f) {
    const needle = (f.selectLabel || '').toLowerCase();
    if (!needle) return null;
    const nodes = [...document.querySelectorAll('label, .redwoodSelect, [class*="placeholder"], [class*="floatedLabel"], [class*="singleValue"]')]
      .filter(n => (n.textContent || '').toLowerCase().includes(needle))
      .sort((a, b) => a.childElementCount - b.childElementCount);
    for (const node of nodes) {
      const root = node.closest('label') || node.closest('[class*="-container"]') || node.parentElement;
      const input = root?.querySelector('input');
      if (input) return { root, input };
    }
    return null;
  }
  function detectOracle() {
    if (cardDoc()) return 'oci-card';
    if (visible(document.querySelector('#opayifrm'))) return 'oci-card';
    if (visible(document.querySelector('#address1'))) return 'oci-address';
    if (visible(document.querySelector('input[name="password"]'))) return 'oci-password';
    if (visible(document.querySelector('#email')) && (visible(document.querySelector('#firstName')) || visible(document.querySelector('#lastName')))) return 'oci-signup';
    return null;
  }
  function detect() {
    if (PLATFORM === 'oracle') return detectOracle();
    if (PLATFORM === 'linode') return detectLinode();
    return null;
  }
  function find(f) {
    if (f.reactSelect) { const root = reactSelectRoot(f); return root ? root.input : null; }
    if (f.frame && f.key === 'cardType') { const control = cardBrandControl(); return control ? control.el : null; }
    if (f.frame && f.key === 'cc_expiration') { const control = expiryControl(); return control ? (control.combined || control.month) : null; }
    if (f.frame) return findIn(cardDoc(), CARD_FIELD_SELECTORS[f.key] || []);
    return f.selectors.flatMap(s => [...document.querySelectorAll(s)]).find(visible);
  }
  function snapshot() { return { ...status, stage: detect(), platform: PLATFORM, cardFrame: PLATFORM === 'oracle' && Boolean(cardDoc()), path: location.pathname }; }
  function update(patch) {
    status = { ...status, ...patch };
    chrome.runtime.sendMessage({ type: 'LIGHT_STATUS', payload: snapshot() }).catch(() => {});
  }
  async function gate() {
    while (job?.paused && !job?.cancelled) await new Promise(r => setTimeout(r, 40));
    if (!job || job.cancelled) throw new Error('已停止，已填写的内容保留在网页中');
    if (document.hidden) { job.paused = true; update({ state: 'paused', message: '标签页已隐藏，返回原页面后点击继续' }); return gate(); }
  }
  async function wait(ms) {
    let remaining = ms;
    while (remaining > 0) { await gate(); const tick = Math.min(40, remaining); await new Promise(r => setTimeout(r, tick)); remaining -= tick; }
    await gate();
  }
  const delay = s => Math.max(10, s.interval * (1 + (Math.random() * 2 - 1) * s.jitter / 100));
  function ensure(el, f) {
    if (!el) throw new Error(`网页上找不到${f.label}，请确认当前步骤`);
    if (!f.reactSelect && !f.frame && !editable(el)) throw new Error(`${f.label}已不可填写，请确认网页当前步骤`);
    if (detect() !== job.stage) throw new Error('页面步骤已改变，请停止后重新识别');
  }
  function keyEvent(el, name, key) { const win = winOf(el); return el.dispatchEvent(new win.KeyboardEvent(name, { key, bubbles: true, cancelable: true })); }
  function edit(el, value, data, inputType, key) {
    if (!keyEvent(el, 'keydown', key)) throw new Error('网页阻止了按键输入，请手动检查该字段');
    const win = winOf(el);
    const allowed = el.dispatchEvent(new win.InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType, data }));
    if (!allowed) { keyEvent(el, 'keyup', key); throw new Error('网页阻止了输入，请手动检查该字段'); }
    const proto = el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType, data }));
    keyEvent(el, 'keyup', key);
  }
  function optionFor(el, value) {
    const q = String(value).toLowerCase().trim();
    const options = [...el.options].filter(o => !o.disabled && !['', '-'].includes(o.value));
    const exact = options.find(o => o.value.toLowerCase() === q || o.textContent.trim().toLowerCase() === q);
    if (exact) return exact;
    const matches = options.filter(o => o.value.toLowerCase().split('~').includes(q));
    return matches.length === 1 ? matches[0] : null;
  }
  function occupied(el) { return el.tagName === 'SELECT' ? !['', '-'].includes(el.value) : el.value !== ''; }
  function canonical(f, value) {
    if (['cc_number', 'cvv', 'phone_number', 'phoneNumber'].includes(f.key)) return String(value).replace(/\D/g, '');
    if (f.key === 'cc_expiration') return C.normalize(f, value);
    return value;
  }
  function wrongCharacter(ch, f, current) {
    let pool = /[0-9]/.test(ch) || f.numeric || f.key === 'cc_expiration' ? '0123456789'
      : /^[A-Z]$/.test(ch) ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
      : /^[a-z]$/.test(ch) ? 'abcdefghijklmnopqrstuvwxyz'
      : /\p{Script=Han}/u.test(ch) ? '的了是在中'
      : /\p{Script=Hiragana}/u.test(ch) ? 'あいうえお'
      : /\p{Script=Katakana}/u.test(ch) ? 'アイウエオ'
      : /\p{L}/u.test(ch) ? 'xyz' : '!@#$%&*';
    // Keep provisional months valid so the date mask does not rewrite the prefix.
    if (f.key === 'cc_expiration') {
      const digits = current.replace(/\D/g, '');
      if (!digits.length) pool = '01';
      else if (digits.length === 1) pool = digits === '1' ? '012' : '123456789';
    }
    const choices = [...pool].filter(candidate => candidate !== ch);
    return choices[Math.floor(Math.random() * choices.length)];
  }
  async function fillSelect(el, f, value, s) {
    let option, attempts = f.dynamic ? 200 : 8;
    while (attempts-- > 0) {
      await gate(); el = find(f); ensure(el, f); option = optionFor(el, value);
      if (option) break;
      await wait(40);
    }
    if (!option) throw new Error(`${f.label}没有匹配的选项，请核对名称或代码`);
    el.value = option.value;
    fire(el, 'input'); fire(el, 'change');
    await wait(f.key === 'country' ? 250 : 60);
    if (el.value !== option.value) throw new Error(`${f.label}选择未被网页接受`);
    el.blur(); return true;
  }
  async function fillText(el, f, value, s, opts = {}) {
    const original = el.value;
    const append = !opts.replace && s.existing === 'append' && !f.sensitive && !f.numeric;
    const expected = (append ? original : '') + value;
    if (el.maxLength > -1 && expected.length > el.maxLength) throw new Error(`${f.label}超过网页允许的长度`);
    if (!append && original) { edit(el, '', null, 'deleteContentBackward', 'Backspace'); await wait(delay(s)); }
    // Expiration masks supply their own slash; send digits to avoid duplicate separators.
    const text = opts.digitsOnly ? String(value).replace(/\D/g, '') : value;
    const units = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), part => part.segment);
    for (let i = 0; i < units.length;) {
      const mistype = s.typoEnabled && Math.random() * 100 < s.typoRate;
      const count = mistype ? Math.min(units.length - i, 1 + Math.floor(Math.random() * 3)) : 1;
      if (mistype) {
        // Snapshots represent one typed character each, including formatter-added spaces/slashes.
        const before = el.value, history = [];
        for (const ch of units.slice(i, i + count)) {
          await wait(delay(s)); ensure(el, f);
          history.push(el.value);
          const wrong = wrongCharacter(ch, f, el.value);
          edit(el, el.value + wrong, wrong, 'insertText', wrong);
        }
        await wait(s.correctionDelay);
        while (history.length) {
          await wait(delay(s)); ensure(el, f);
          edit(el, history.pop(), null, 'deleteContentBackward', 'Backspace');
        }
        if (el.value !== before) throw new Error(`${f.label}的错字未能完整删除，请检查网页`);
      }
      for (const ch of units.slice(i, i + count)) {
        await wait(delay(s)); ensure(el, f);
        edit(el, el.value + ch, ch, 'insertText', ch);
      }
      i += count;
    }
    // Plain inputs do not have the site's expiration mask.
    if (opts.digitsOnly && /^\d{6}$/.test(el.value)) edit(el, value, '/', 'insertText', '/');
    fire(el, 'change');
    el.blur(); await wait(60);
    if (!opts.skipCheck && canonical(f, el.value) !== canonical(f, expected)) throw new Error(`${f.label}的最终内容与输入不一致，请在网页检查`);
    return true;
  }
  async function setSubValue(el, candidates, label, s) {
    if (el.tagName === 'SELECT') {
      const option = candidates.map(v => optionFor(el, String(v))).find(Boolean);
      if (!option) throw new Error(`${label}没有匹配的选项（${candidates.join(' / ')}）`);
      el.value = option.value; fire(el, 'input'); fire(el, 'change'); await wait(80);
      return true;
    }
    const value = candidates.find(v => el.maxLength < 0 || String(v).length <= el.maxLength) ?? candidates[0];
    el.scrollIntoView({ behavior: 'instant', block: 'center' }); el.focus();
    return fillText(el, { key: '', label, sensitive: true, numeric: true }, String(value), s, { replace: true, skipCheck: true });
  }
  async function fillExpiry(f, value, s) {
    const control = expiryControl();
    if (!control) throw new Error('网页上找不到有效期输入框，请手动填写');
    const [month, year] = String(value).split('/');
    if (control.combined) {
      control.combined.scrollIntoView({ behavior: 'instant', block: 'center' }); control.combined.focus();
      return fillText(control.combined, f, value, s, { digitsOnly: true });
    }
    await setSubValue(control.month, [month, Number(month)], '有效期月份', s);
    await setSubValue(control.year, [year, year.slice(-2)], '有效期年份', s);
    return true;
  }
  async function fillCardBrand(f, value, s) {
    const control = cardBrandControl();
    if (!control) return false; // the gateway may derive the brand from the card number itself
    const names = CARD_BRANDS[String(value).toLowerCase()] || [String(value).toLowerCase()];
    const label = `${f.label}（${value}）`;
    if (control.kind === 'select') {
      const option = [...control.el.options].find(o => names.some(n => `${o.value} ${o.textContent}`.toLowerCase().includes(n)));
      if (!option) throw new Error(`${label}没有匹配的选项`);
      if (control.el.value === option.value) return false;
      control.el.value = option.value; fire(control.el, 'input'); fire(control.el, 'change'); await wait(120);
      if (control.el.value !== option.value) throw new Error(`${f.label}选择未被网页接受`);
      return true;
    }
    const target = control.inputs.find(r => names.some(n => `${r.value} ${r.closest('label')?.textContent || ''} ${r.id}`.toLowerCase().includes(n)));
    if (!target) throw new Error(`${label}没有匹配的选项`);
    if (target.checked) return false;
    target.click(); await wait(120);
    if (!target.checked) throw new Error(`${f.label}选择未被网页接受`);
    return true;
  }
  function pickOption(list, value) {
    const q = flat(value);
    if (!q) return null;
    return list.find(o => flat(o.text) === q)
      || list.find(o => flat(o.text).startsWith(q))
      || list.find(o => flat(o.text).includes(q))
      || (list.filter(o => q.startsWith(flat(o.text))).length === 1 ? list.find(o => q.startsWith(flat(o.text))) : null);
  }
  async function fillReactSelect(f, value, s) {
    const found = reactSelectRoot(f);
    if (!found) throw new Error(`网页上找不到${f.label}下拉框，请确认当前步骤`);
    const { root, input } = found;
    root.scrollIntoView?.({ behavior: 'instant', block: 'center' });
    const current = root.querySelector('[class*="singleValue"]')?.textContent?.trim() || '';
    if (s.existing === 'skip' && current && flat(current) === flat(value)) return false;
    input.focus();
    const win = winOf(root);
    const control = root.querySelector('[class*="-control"]') || root;
    for (const type of ['mousedown', 'mouseup', 'click']) control.dispatchEvent(new win.MouseEvent(type, { bubbles: true, cancelable: true }));
    await wait(120);
    const read = () => [...document.querySelectorAll('[id*="-option-"]')].filter(visible).map(el => ({ el, text: (el.textContent || '').trim() }));
    let options = read();
    if (!options.length) { keyEvent(input, 'keydown', 'ArrowDown'); await wait(140); options = read(); }
    if (!options.length) throw new Error(`${f.label}下拉框没有展开，请在网页手动选择`);
    const match = pickOption(options, value);
    if (!match) throw new Error(`${f.label}没有匹配“${value}”的选项`);
    for (const type of ['mousedown', 'mouseup', 'click']) match.el.dispatchEvent(new win.MouseEvent(type, { bubbles: true, cancelable: true }));
    await wait(180);
    const after = root.querySelector('[class*="singleValue"]')?.textContent?.trim() || '';
    if (flat(after) !== flat(match.text)) throw new Error(`${f.label}选择未被网页接受`);
    return true;
  }
  function radioTarget(f, value) {
    const wanted = String(value).trim().toLowerCase();
    const option = (f.options || []).find(o => o.value.toLowerCase() === wanted || o.label.toLowerCase() === wanted);
    if (!option) return null;
    const scope = f.frame ? (cardDoc() || document) : document;
    const radios = [...scope.querySelectorAll('input[type="radio"]')];
    const target = radios.find(r => (r.value || '').toLowerCase() === option.value)
      || radios.find(r => (r.closest('label')?.textContent || '').trim().toLowerCase() === option.label.toLowerCase());
    return target ? { option, target } : null;
  }
  async function fillRadio(f, value, s) {
    const found = radioTarget(f, value);
    if (!found) {
      const option = (f.options || []).find(o => o.value.toLowerCase() === String(value).trim().toLowerCase());
      if (!option) throw new Error(`${f.label}请选择${(f.options || []).map(o => o.label).join(' 或 ')}`);
      throw new Error(`网页上找不到“${option.label}”选项`);
    }
    const { target } = found;
    if (target.checked) return false;
    target.scrollIntoView({ behavior: 'instant', block: 'center' });
    target.click(); await wait(120);
    if (!target.checked) {
      const win = winOf(target);
      target.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
      await wait(80);
    }
    if (!target.checked) throw new Error(`${f.label}选择未被网页接受`);
    return true;
  }
  async function fill(f, value, s) {
    if (f.control === 'radio') return fillRadio(f, value, s);
    if (f.reactSelect) return fillReactSelect(f, value, s);
    if (f.key === 'cardType') return fillCardBrand(f, value, s);
    if (f.frame && f.key === 'cc_expiration') return fillExpiry(f, value, s);
    const el = find(f); ensure(el, f);
    if (s.existing === 'skip' && occupied(el)) return false;
    el.scrollIntoView({ behavior: 'instant', block: 'center' }); el.focus();
    if (el.tagName === 'SELECT') return fillSelect(el, f, value, s);
    // A country-dependent field can be a react-select on some countries and a plain input on others.
    if (el.readOnly) return fillReactSelect(f, value, s);
    return fillText(el, f, value, s, { digitsOnly: f.key === 'cc_expiration' });
  }
  function prepare(message) {
    if (job) throw new Error('已有填写任务，请先停止');
    const step = C.stepById(message.stage);
    if (!step || step.id !== detect()) throw new Error('当前网页与所选步骤不一致，请重新识别或在网页进入对应步骤');
    const s = C.settings(message.settings);
    const entries = [];
    for (const f of step.fields) {
      const value = C.normalize(f, message.values?.[f.key] ?? '');
      if (value === '') continue;
      const error = C.validate(f, value); if (error) throw new Error(error);
      // Radio groups are located by value or label, not by the generic field selectors.
      if (f.control === 'radio') {
        if (!radioTarget(f, value)) throw new Error(`${f.label}请选择${(f.options || []).map(o => o.label).join(' 或 ')}`);
        entries.push([f, value]); continue;
      }
      const el = find(f);
      const usable = el && (f.reactSelect || f.frame || editable(el));
      if (!usable) {
        if (f.optional) continue;
        throw new Error(`${f.label}当前不可填写${f.key === 'otp' ? '，请先在网页发送验证码' : '，请确认网页步骤'}`);
      }
      if (el.tagName === 'SELECT' && !f.dynamic && !optionFor(el, value)) throw new Error(`${f.label}没有匹配的选项`);
      if (el.tagName !== 'SELECT' && !f.frame && el.maxLength > -1 && value.length > el.maxLength) throw new Error(`${f.label}超过网页允许的长度`);
      entries.push([f, value]);
    }
    if (!entries.length) throw new Error('请先填写至少一项内容');
    return { entries, s, stage: step.id };
  }
  async function run(plan) {
    try {
      for (const [f, value] of plan.entries) {
        await gate(); update({ field: f.label, message: `正在填写：${f.label}` });
        const changed = await fill(f, value, plan.s);
        update({ completed: status.completed + 1, skipped: status.skipped + (changed ? 0 : 1) });
        await wait(plan.s.fieldDelay);
      }
      update({ state: 'done', field: '', message: status.skipped ? `已处理 ${status.total} 项，跳过 ${status.skipped} 项已有内容，请检查网页` : '填写完成，请在网页检查并继续' });
    } catch (error) {
      update({ state: job?.cancelled ? 'stopped' : 'error', field: '', message: error.message });
    } finally { job = null; }
  }
  document.addEventListener('keydown', event => {
    if (!job || !event.isTrusted) return;
    if (event.key === 'Escape') job.cancelled = true;
    else { job.paused = true; update({ state: 'paused', message: '检测到手动输入，已暂停；确认后可继续' }); }
  }, true);
  document.addEventListener('pointerdown', event => {
    if (job && event.isTrusted) { job.paused = true; update({ state: 'paused', message: '检测到网页操作，已暂停；确认后可继续' }); }
  }, true);
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !message?.type?.startsWith('LIGHT_')) return;
    try {
      if (message.type === 'LIGHT_INSPECT') respond({ ok: true, ...snapshot() });
      else if (message.type === 'LIGHT_START') {
        const plan = prepare(message);
        job = { paused: false, cancelled: false, stage: plan.stage };
        update({ state: 'running', completed: 0, total: plan.entries.length, skipped: 0, runId: crypto.randomUUID(), jobStage: plan.stage, message: '开始填写' });
        respond({ ok: true, ...snapshot() }); void run(plan);
      } else if (message.type === 'LIGHT_PAUSE') {
        if (!job) throw new Error('当前没有填写任务');
        job.paused = !job.paused; update({ state: job.paused ? 'paused' : 'running', message: job.paused ? '已暂停' : '继续填写' }); respond({ ok: true, ...snapshot() });
      } else if (message.type === 'LIGHT_STOP') {
        if (job) job.cancelled = true; respond({ ok: true });
      } else if (message.type === 'LIGHT_SUSPEND') {
        if (job) { job.paused = true; update({ state: 'paused', message: '已切换标签页，返回原页面后点击继续' }); }
        respond({ ok: true });
      }
    } catch (error) { respond({ ok: false, error: error.message }); }
  });
})();
