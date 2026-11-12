// End-to-end checks for the Oracle Cloud signup steps against local fixtures that mirror the
// saved Oracle HTML: a react-select combobox, a customer-type radio pair, conditional address
// fields, and a card form nested inside the payment iframe.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'test-results');
fs.mkdirSync(out, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'light-type-oracle-'));
const cases = [];
const errors = [];
const fast = { interval: 20, jitter: 0, fieldDelay: 0, existing: 'replace' };
const page = (body, script = '') => `<!doctype html><html><head><meta charset="utf-8"><style>body{font:16px sans-serif;padding:24px}label{display:block;margin:10px}</style></head><body>${body}<script>window.events=[];document.addEventListener('input',e=>events.push({id:e.target.id||e.target.name,value:e.target.value}));${script}</script></body></html>`;
// A minimal react-select stand-in: the label carries the text the extension searches for, the
// menu opens on mousedown, and options use react-select's own id shape (react-select-N-option-M).
const combo = (instance, label, options) => `
<label class="redwoodSelect">
  <div class="rs-container">
    <div class="floatedLabel">${label}</div>
    <div class="rs-control"><div class="rs-value" id="value-${instance}"></div><input id="react-select-${instance}-input" readonly></div>
  </div>
</label>
<div id="menu-${instance}"></div>
<script>
(() => {
  const list = ${JSON.stringify(options)};
  const menu = document.getElementById('menu-${instance}');
  const value = document.getElementById('value-${instance}');
  document.getElementById('react-select-${instance}-input').closest('.rs-control').addEventListener('mousedown', () => {
    menu.innerHTML = list.map((text, i) => '<div id="react-select-${instance}-option-' + i + '" class="css-option">' + text + '</div>').join('');
    [...menu.children].forEach((option, i) => option.addEventListener('mousedown', () => {
      value.textContent = list[i]; value.className = 'rs-value singleValue'; menu.innerHTML = '';
    }));
  });
})();
</script>`;

const signupPage = page(
  combo(2, 'Billing Country/Territory', ['Trinidad and Tobago', 'United States', 'United Kingdom', 'China']) +
  '<label for="firstName">First name<input id="firstName" name="firstName" maxlength="200"></label>' +
  '<label for="lastName">Last name<input id="lastName" name="lastName" maxlength="200"></label>' +
  '<label for="email">Email<input id="email" name="email" type="email"></label>' +
  '<div aria-hidden="true" style="display:none"><input id="firstName_signup_deadbeef" name="firstName_signup_deadbeef" class="honeypot-field" tabindex="-1"></div>'
);
const passwordPage = page(
  '<label>Password<input type="password" name="password" id="passwordField"></label>' +
  '<label>Confirm<input type="password" name="matchPassword"></label>' +
  '<div class="row customer-type"><label><input type="radio" id="corporate-customer-radio" name="customer-type" value="corporate" checked> Corporate</label>' +
  '<label><input type="radio" id="individual-customer-radio" name="customer-type" value="individual"> Individual</label></div>' +
  '<label>Company<input type="text" name="organization" maxlength="360"></label>' +
  '<label>Tenancy<input type="text" id="accountNameInput" name="accountName"></label>' +
  combo(3, 'Home Region', ['US East (Ashburn)', 'US West (Phoenix)', 'Japan East (Tokyo)'])
);
const addressPage = page(
  '<label>Address 1<input id="address1" name="address1" maxlength="240" required></label>' +
  '<label>Address 2<input id="address2" name="address2" maxlength="240"></label>' +
  '<label>Address 3<input id="address3" name="address3" maxlength="240"></label>' +
  '<label>City<input id="city" name="city" maxlength="60" required></label>' +
  '<label>State<input id="state" name="state" maxlength="60"></label>' +
  '<label>Province<input id="province" name="province" maxlength="60"></label>' +
  '<label>Zip<input id="postalcode" name="postalcode" maxlength="60"></label>' +
  '<label>County<input id="county" name="county" maxlength="60"></label>' +
  '<label>Phone<input id="phoneNumber" name="Phone Number" type="tel"></label>'
);
const paymentPage = page('<iframe id="opayifrm" class="payment-service" src="https://shop.oracle.com/app/paymentservice/"></iframe>');
// Mirrors the real nesting: shop.oracle.com renders the gateway into a same-origin child frame.
const gatewayPage = page('<div class="ps-container"><div id="ps-container-root"><iframe id="gateway" title="Payment gateway"></iframe></div></div>', `
(() => {
  const doc = document.getElementById('gateway').contentDocument;
  doc.open();
  doc.write('<form>' +
    '<select name="cardType"><option value="">Select</option><option value="visa">Visa</option><option value="mastercard">Mastercard</option><option value="amex">American Express</option></select>' +
    '<input autocomplete="cc-number" name="cardNumber">' +
    '<input autocomplete="cc-exp" name="expiry">' +
    '<input autocomplete="cc-csc" name="cvv">' +
    '</form>');
  doc.close();
})();
`);

let context;
(async () => {
  context = await chromium.launchPersistentContext(profile, { channel: 'chromium', executablePath: process.env.CHROME_PATH || undefined, headless: true, viewport: { width: 1000, height: 900 }, ignoreDefaultArgs: ['--disable-extensions'], args: process.env.CHROME_PATH ? ['--enable-unsafe-extension-debugging'] : [`--disable-extensions-except=${root}`, `--load-extension=${root}`] });
  let loadedId;
  if (process.env.CHROME_PATH) {
    const cdp = await context.browser().newBrowserCDPSession();
    loadedId = (await cdp.send('Extensions.loadUnpacked', { path: root })).id;
    await cdp.detach();
  }
  const signupFixtures = { '/signup': signupPage, '/password': passwordPage, '/address': addressPage, '/payment': paymentPage };
  await context.route('https://signup.cloud.oracle.com/**', route => {
    const key = new URL(route.request().url()).pathname;
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: signupFixtures[key] || page('No form') });
  });
  await context.route('https://shop.oracle.com/**', route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: gatewayPage }));
  let worker;
  if (loadedId) {
    worker = await context.newPage();
    await worker.goto(`chrome-extension://${loadedId}/panel.html`);
    await worker.locator('#start').waitFor();
  } else worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  worker.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const id = loadedId || new URL(worker.url()).host;
  const site = await context.newPage(); site.on('pageerror', e => errors.push(e.message));
  const send = (msg, frameId) => worker.evaluate(async ({ msg, frameId }) => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return frameId == null ? chrome.tabs.sendMessage(tab.id, msg) : chrome.tabs.sendMessage(tab.id, msg, { frameId });
  }, { msg, frameId });
  const start = (stage, values, frameId, settings = fast) => send({ type: 'LIGHT_START', stage, values, settings }, frameId);
  async function load(url, stage) {
    await site.goto('https://signup.cloud.oracle.com' + url); await site.bringToFront();
    for (let i = 0; i < 50; i++) {
      try { const s = await send({ type: 'LIGHT_INSPECT' }); if (s.stage === stage) return s; } catch { /* content script not ready yet */ }
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error('Stage not detected: ' + stage);
  }
  async function finish(frameId, expected = 'done') {
    for (let i = 0; i < 250; i++) {
      const s = await send({ type: 'LIGHT_INSPECT' }, frameId);
      if (['done', 'error', 'stopped'].includes(s.state)) { assert.equal(s.state, expected, s.message); return s; }
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error('Typing timeout');
  }
  const cardFrameId = () => worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['core.js', 'content.js'] });
    for (const frameId of [...new Set(results.map(r => r.frameId))]) {
      try {
        const s = await chrome.tabs.sendMessage(tab.id, { type: 'LIGHT_INSPECT' }, { frameId });
        if (s?.ok && s.cardFrame) return frameId;
      } catch { /* frame has no content script */ }
    }
    return null;
  });
  async function check(name, fn) { await fn(); cases.push(name); process.stdout.write('PASS ' + name + '\n'); }

  await check('oracle stages are detected and the platform is reported', async () => {
    assert.equal((await load('/signup', 'oci-signup')).platform, 'oracle');
    await load('/password', 'oci-password');
    await load('/address', 'oci-address');
    await load('/payment', 'oci-card');
  });
  await check('billing country uses the react-select and the honeypot stays empty', async () => {
    await load('/signup', 'oci-signup');
    assert.equal((await start('oci-signup', { country: 'TT', firstName: 'John', lastName: 'Doe', email: 'john@example.com' })).ok, true);
    await finish();
    assert.equal(await site.locator('#value-2').textContent(), 'Trinidad and Tobago');
    assert.equal(await site.locator('#firstName').inputValue(), 'John');
    assert.equal(await site.locator('#lastName').inputValue(), 'Doe');
    assert.equal(await site.locator('#email').inputValue(), 'john@example.com');
    assert.equal(await site.locator('#firstName_signup_deadbeef').inputValue(), '');
  });
  await check('password step fills both fields, picks a customer type and the home region', async () => {
    await load('/password', 'oci-password');
    await start('oci-password', { password: 'Abcd1234!', matchPassword: 'Abcd1234!', customerType: 'individual', accountName: 'mytrial01', homeRegion: 'US East (Ashburn)' });
    await finish();
    assert.equal(await site.locator('input[name="password"]').inputValue(), 'Abcd1234!');
    assert.equal(await site.locator('input[name="matchPassword"]').inputValue(), 'Abcd1234!');
    assert.equal(await site.locator('#individual-customer-radio').isChecked(), true);
    assert.equal(await site.locator('#corporate-customer-radio').isChecked(), false);
    assert.equal(await site.locator('#accountNameInput').inputValue(), 'mytrial01');
    assert.equal(await site.locator('#value-3').textContent(), 'US East (Ashburn)');
  });
  await check('address step fills the visible fields and leaves the rest untouched', async () => {
    await load('/address', 'oci-address');
    await start('oci-address', { address1: '10 Caparo Valley Brasso Rd', city: 'Montrose', state: 'Caroni', postalcode: '5000', phoneNumber: '+18681234567' });
    await finish();
    assert.equal(await site.locator('#address1').inputValue(), '10 Caparo Valley Brasso Rd');
    assert.equal(await site.locator('#city').inputValue(), 'Montrose');
    assert.equal(await site.locator('#state').inputValue(), 'Caroni');
    assert.equal(await site.locator('#postalcode').inputValue(), '5000');
    assert.equal(await site.locator('#phoneNumber').inputValue(), '+18681234567');
    for (const untouched of ['address2', 'address3', 'province', 'county']) assert.equal(await site.locator('#' + untouched).inputValue(), '', untouched);
  });
  await check('card step reaches the gateway frame and fills brand, number, expiry and cvv', async () => {
    await load('/payment', 'oci-card');
    const frameId = await cardFrameId();
    assert.notEqual(frameId, null, 'gateway frame not found');
    const started = await start('oci-card', { cardType: 'visa', cc_number: '4111111111111111', cc_expiration: '09/2029', cvv: '001' }, frameId);
    assert.equal(started.ok, true, started.error);
    await finish(frameId);
    const shop = site.frames().find(f => f.url().startsWith('https://shop.oracle.com/'));
    assert.ok(shop, 'payment frame missing');
    const card = await shop.evaluate(() => {
      const gateway = document.getElementById('gateway').contentDocument;
      return {
        brand: gateway.querySelector('select[name=cardType]').value,
        number: gateway.querySelector('input[autocomplete="cc-number"]').value,
        expiry: gateway.querySelector('input[autocomplete="cc-exp"]').value,
        cvv: gateway.querySelector('input[autocomplete="cc-csc"]').value
      };
    });
    assert.deepEqual(card, { brand: 'visa', number: '4111111111111111', expiry: '09/2029', cvv: '001' });
  });
  await check('panel exposes the four oracle steps with their own controls', async () => {
    const panel = await context.newPage();
    panel.on('pageerror', e => errors.push(e.message));
    await panel.goto(`chrome-extension://${id}/panel.html`);
    await panel.locator('[data-platform="oracle"]').click();
    assert.deepEqual(await panel.locator('#steps .step strong').allTextContents(), ['账户信息', '密码与账户', '地址信息', '卡片信息']);
    await panel.locator('[data-step="oci-password"]').click();
    assert.equal(await panel.locator('.choice-group input[type=radio]').count(), 2);
    assert.ok(await panel.locator('#field-homeRegion').isVisible());
    assert.ok(await panel.locator('#field-organization').isVisible());
    await panel.locator('[data-step="oci-card"]').click();
    assert.equal(await panel.locator('select#field-cardType option').count(), 6);
    await panel.locator('[data-step="oci-address"]').click();
    for (const key of ['address1', 'city', 'state', 'postalcode', 'county', 'phoneNumber']) assert.ok(await panel.locator('#field-' + key).isVisible(), key);
    await panel.setViewportSize({ width: 760, height: 820 });
    assert.ok(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'oracle panel overflows');
    await panel.close();
  });
  await check('panel drives an oracle address step end to end', async () => {
    await load('/address', 'oci-address');
    const panel = await context.newPage();
    panel.on('pageerror', e => errors.push(e.message));
    await panel.goto(`chrome-extension://${id}/panel.html`);
    await panel.locator('[data-step="oci-address"]').click();
    for (const [key, value] of Object.entries({ address1: '10 Caparo Valley Brasso Rd', city: 'Montrose', state: 'Caroni', postalcode: '5000', phoneNumber: '+18681234567' })) await panel.locator('#field-' + key).fill(value);
    await site.bringToFront();
    await panel.evaluate(() => document.querySelector('#refresh').click());
    await panel.locator('#start:not([disabled])').waitFor();
    await panel.evaluate(() => document.querySelector('#start').click());
    await finish();
    assert.equal(await site.locator('#address1').inputValue(), '10 Caparo Valley Brasso Rd');
    assert.equal(await site.locator('#state').inputValue(), 'Caroni');
    assert.equal(await site.locator('#phoneNumber').inputValue(), '+18681234567');
    await panel.close();
  });
  await check('panel fills the password step and mirrors the password into the confirmation field', async () => {
    await load('/password', 'oci-password');
    const panel = await context.newPage();
    panel.on('pageerror', e => errors.push(e.message));
    await panel.goto(`chrome-extension://${id}/panel.html`);
    await panel.locator('[data-step="oci-password"]').click();
    await panel.locator('#field-password').fill('Abcd1234!');
    await panel.locator('#field-accountName').fill('mytrial02');
    await panel.locator('input[name="field-customerType"][value="individual"]').check();
    await site.bringToFront();
    await panel.evaluate(() => document.querySelector('#refresh').click());
    await panel.locator('#start:not([disabled])').waitFor();
    await panel.evaluate(() => document.querySelector('#start').click());
    await finish();
    assert.equal(await site.locator('input[name="password"]').inputValue(), 'Abcd1234!');
    assert.equal(await site.locator('input[name="matchPassword"]').inputValue(), 'Abcd1234!');
    assert.equal(await site.locator('#individual-customer-radio').isChecked(), true);
    assert.equal(await site.locator('#accountNameInput').inputValue(), 'mytrial02');
    await panel.close();
  });
  await check('Chrome reports no manifest or extension runtime errors', async () => {
    const manager = await context.newPage(); await manager.goto('chrome://extensions/');
    const rows = await manager.locator('extensions-item').evaluateAll(els => els.map(el => ({ id: el.id, state: el.data.state, manifestErrors: el.data.manifestErrors, runtimeErrors: el.data.runtimeErrors })));
    const loaded = rows.find(r => r.id === id);
    assert.ok(loaded); assert.equal(loaded.state, 'ENABLED');
    assert.deepEqual(loaded.manifestErrors, []); assert.deepEqual(loaded.runtimeErrors, []);
    await manager.close();
  });
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(out, 'oracle-report.json'), JSON.stringify({ passed: cases.length, cases, errors }, null, 2));
  process.stdout.write(`\n${cases.length} oracle checks passed. Extension ID: ${id}\n`);
})().catch(e => { process.stderr.write(e.stack + '\n'); process.exitCode = 1; }).finally(async () => {
  await context?.close();
  const target = path.resolve(profile), base = path.resolve(os.tmpdir());
  if (path.dirname(target) === base && path.basename(target).startsWith('light-type-oracle-')) fs.rmSync(target, { recursive: true, force: true });
});
