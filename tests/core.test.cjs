const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');
const field = (step, key) => C.steps.find(s => s.id === step).fields.find(f => f.key === key);

test('Chinese labeled account text preserves password punctuation', () => {
  const r = C.parse('signup', '邮箱：test@example.com\n用户名：sample\n密码：ab:=cd!');
  assert.deepEqual(r.values, { email: 'test@example.com', username: 'sample', password: 'ab:=cd!' });
});
test('positional text and tab-separated values', () => {
  assert.deepEqual(C.parse('signup', 'test@example.com\nsample\nabc123').values, { email: 'test@example.com', username: 'sample', password: 'abc123' });
  assert.equal(C.parse('signup', 'a@b.co\tsample\tabc').values.password, 'abc');
});

test('three-line signup preserves password separators, labels and boundary spaces', () => {
  for (const password of ['ab|cd----ef:=gh', 'password:ab|cd', '  ab|cd  ']) {
    const result = C.parse('signup', `test@example.com\r\nsample\r\n${password}\r\n`);
    assert.deepEqual(result.values, { email: 'test@example.com', username: 'sample', password });
  }
  assert.deepEqual(C.parse('signup', 'test@example.com\n\nsecret').values, { email: 'test@example.com', username: '', password: 'secret' });
  assert.throws(() => C.parse('signup', 'test@example.com\nsample\nsecret\nextra'), /三行/);
});

test('four-part card input combines month and year and preserves leading zero CVV', () => {
  for (const year of ['29', '2029']) {
    const result = C.parse('card', `4111111111111111|9|${year}|001`);
    assert.deepEqual(result.values, { cc_number: '4111111111111111', cc_expiration: '09/2029', cvv: '001' });
    assert.deepEqual(result.warnings, []);
  }
  assert.equal(C.parse('card', '4111 1111 1111 1111 | 09 | 2029 | 0001').values.cvv, '0001');
  assert.equal(C.parse('card', '4111111111111111|09/29|001').values.cc_expiration, '09/2029');
  for (const text of ['4111111111111111|13|2029|001', '4111111111111111||2029|001', '4111111111111111|09|202|001', '4111111111111111|09|2029|', '4111111111111111|09|2029|001|extra']) assert.throws(() => C.parse('card', text));
});
test('exactly six OTP digits preserve leading zeros', () => {
  assert.equal(C.parse('email', '001234').values.otp, '001234');
  assert.equal(C.validate(field('email', 'otp'), '001234'), null);
  assert.ok(C.validate(field('email', 'otp'), '12345'));
});
test('JSON requires strings for sensitive and phone values', () => {
  const result = C.parse('card', '{"card":"4111111111111111","cvv":"001","expiry":"09/29"}');
  assert.equal(result.values.cc_expiration, '09/2029');
  assert.equal(result.values.cvv, '001');
  const unsafe = C.parse('card', '{"card":1234567890123456789,"cvv":12}');
  assert.deepEqual(unsafe.values, {});
  assert.equal(unsafe.warnings.length, 2);
});
test('malformed and oversized paste errors are actionable', () => {
  assert.throws(() => C.parse('signup', '{oops'), /JSON/);
  assert.throws(() => C.parse('signup', 'x'.repeat(20001)), /内容过长/);
});
test('unknown labeled fields never map to another input', () => {
  const result = C.parse('signup', 'email: a@b.co\nunknown: xxx');
  assert.deepEqual(result.values, { email: 'a@b.co' });
  assert.equal(result.warnings.length, 1);
});
test('country aliases and phone punctuation normalize', () => {
  assert.equal(C.normalize(field('profile', 'country'), '美国'), 'US');
  assert.equal(C.normalize(field('phone', 'iso_code'), 'gb'), 'GB');
  assert.equal(C.normalize(field('phone', 'phone_number'), '+1 (202) 555-0100'), '+12025550100');
});

test('country fields reject numbered free text before returning parsed values', () => {
  for (const value of ['〒000-0000 テスト住所１丁目', '123 Example Street', '１２３ Example Street']) {
    assert.throws(() => C.parse('profile', value), /国家.*整段地址/);
    assert.throws(() => C.parse('profile', `名：Example\n国家：${value}`), /国家.*整段地址/);
    assert.throws(() => C.parse('profile', JSON.stringify({ country: value })), /国家.*整段地址/);
    assert.ok(C.validate(field('profile', 'country'), value));
  }
  assert.equal(C.parse('profile', 'JP').values.country, 'JP');
  assert.equal(C.parse('profile', 'Japan').values.country, 'Japan');
  assert.equal(C.parse('profile', '地址：123 Example Street').values.address_1, '123 Example Street');
});
test('expiration accepts both year formats and rejects invalid month', () => {
  const f = field('card', 'cc_expiration');
  for (const input of ['9/29', '09/2029', '0929', '092029']) assert.equal(C.normalize(f, input), '09/2029');
  assert.ok(C.validate(f, C.normalize(f, '13/29')));
});
test('sensitive data never enters persistent drafts', () => {
  const result = C.splitDrafts({ signup: { email: 'a@b.co', password: 'secret' }, email: { otp: '001234' }, phone: { phone_number: '2025550100', otp: '223344' }, card: { cc_number: '4111111111111111', cc_expiration: '09/29', cvv: '001' }, unknown: { x: 'no' } });
  const local = JSON.stringify(result.saved);
  for (const secret of ['secret', '001234', '223344', '4111111111111111', '09/29', '001']) assert.ok(!local.includes(secret));
  assert.equal(result.saved.signup.email, 'a@b.co');
  assert.equal(result.transient.signup.password, 'secret');
  assert.equal(result.transient.card.cvv, '001');
});
test('settings are bounded and invalid values use defaults', () => {
  const result = C.settings({ interval: -1, jitter: 1000, existing: 'unknown', typoRate: 'no', remember: false });
  assert.equal(result.interval, 20); assert.equal(result.jitter, 80);
  assert.equal(result.existing, 'skip'); assert.equal(result.typoRate, 8); assert.equal(result.typoEnabled, false); assert.equal(result.remember, false);
});
test('correction toggle migrates old settings and supports a 1–100 percent range', () => {
  assert.equal(C.settings().typoEnabled, false);
  assert.equal(C.settings({ typoRate: 0 }).typoEnabled, false);
  assert.equal(C.settings({ typoRate: 8 }).typoEnabled, true);
  assert.equal(C.settings({ typoRate: Infinity }).typoEnabled, false);
  for (const rate of [1, 8, 50, 100]) {
    const enabled = C.settings({ typoEnabled: true, typoRate: rate });
    assert.equal(enabled.typoRate, rate);
    assert.equal(enabled.typoEnabled, true);
    const disabled = C.settings({ ...enabled, typoEnabled: false });
    assert.equal(disabled.typoEnabled, false);
    assert.equal(disabled.typoRate, rate);
    assert.deepEqual(C.settings(disabled), disabled);
  }
  assert.equal(C.settings({ typoRate: 200 }).typoRate, 100);
  assert.equal(C.settings({ typoRate: -10 }).typoRate, 1);
});

test('oracle steps are registered separately from linode steps', () => {
  assert.deepEqual(C.stepsFor('oracle').map(s => s.id), ['oci-signup', 'oci-password', 'oci-address', 'oci-card']);
  assert.deepEqual(C.stepsFor('linode').map(s => s.id), ['signup', 'email', 'phone', 'profile', 'card']);
  assert.equal(C.stepById('oci-address').platform, 'oracle');
  assert.equal(C.stepById('profile').platform, undefined);
  assert.equal(C.stepById('oci-card').frame, true);
});
test('oracle billing country expands codes to the full names the react-select lists', () => {
  const oci = C.stepById('oci-signup').fields.find(f => f.key === 'country');
  const linode = C.stepById('profile').fields.find(f => f.key === 'country');
  assert.equal(C.normalize(oci, 'US'), 'United States');
  assert.equal(C.normalize(oci, '美国'), 'United States');
  assert.equal(C.normalize(oci, 'tt'), 'Trinidad and Tobago');
  assert.equal(C.normalize(oci, 'Trinidad and Tobago'), 'Trinidad and Tobago');
  assert.equal(C.normalize(oci, 'Atlantis'), 'Atlantis');
  assert.equal(C.normalize(linode, '美国'), 'US');
});
test('oracle address and password pastes map by field name', () => {
  const labeled = C.parse('oci-address', '地址1：10 Caparo Valley Brasso Rd\n城市：Montrose\n省：Caroni\n邮编：5000\n手机号：+1868 123 4567');
  assert.deepEqual(labeled.values, { address1: '10 Caparo Valley Brasso Rd', city: 'Montrose', state: 'Caroni', postalcode: '5000', phoneNumber: '+18681234567' });
  const json = C.parse('oci-password', '{"password":"Abcd1234!","accountName":"mytrial01","customerType":"individual"}');
  assert.deepEqual(json.values, { password: 'Abcd1234!', accountName: 'mytrial01', customerType: 'individual' });
});
test('oracle card paste accepts four and five part forms', () => {
  assert.deepEqual(C.parse('oci-card', '4111111111111111|9|2029|001').values, { cc_number: '4111111111111111', cc_expiration: '09/2029', cvv: '001' });
  assert.deepEqual(C.parse('oci-card', 'visa|4111111111111111|9|2029|001').values, { cardType: 'visa', cc_number: '4111111111111111', cc_expiration: '09/2029', cvv: '001' });
  assert.throws(() => C.parse('oci-card', '4111111111111111|13|2029|001'));
});
test('oracle sensitive fields never reach persistent drafts', () => {
  const result = C.splitDrafts({ 'oci-signup': { email: 'a@b.co', country: 'United States' }, 'oci-password': { password: 'Abcd1234!', accountName: 'trial01' }, 'oci-card': { cc_number: '4111111111111111', cvv: '001' } });
  assert.equal(result.saved['oci-signup'].country, 'United States');
  assert.equal(result.saved['oci-password'].accountName, 'trial01');
  assert.equal(result.transient['oci-password'].password, 'Abcd1234!');
  assert.equal(result.transient['oci-card'].cvv, '001');
  assert.ok(!JSON.stringify(result.saved).includes('4111111111111111'));
});
test('oracle tenancy name and phone validation are actionable', () => {
  const name = C.stepById('oci-password').fields.find(f => f.key === 'accountName');
  const phone = C.stepById('oci-address').fields.find(f => f.key === 'phoneNumber');
  assert.equal(C.validate(name, 'mytrial01'), null);
  assert.ok(C.validate(name, '1trial'));
  assert.ok(C.validate(name, 'my trial'));
  assert.equal(C.validate(phone, '+18681234567'), null);
  assert.ok(C.validate(phone, 'abc'));
});
