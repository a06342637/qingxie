(function (root) {
  'use strict';
  const field = (key, label, placeholder, options = {}) => ({
    key, label, placeholder, selectors: [`#${key}`, `[name="${key}"]`], ...options
  });
  const steps = [
    { id: 'signup', title: '注册账号', en: 'ACCOUNT', icon: 'user', hint: '填写邮箱、用户名和密码，然后在网页继续注册。', url: 'https://login.linode.com/signup', fields: [
      field('email', '邮箱', 'name@example.com', { type: 'email', aliases: ['邮箱', '电子邮箱', 'email address'] }),
      field('username', '用户名', '你的用户名', { aliases: ['用户名', '账号', 'user'] }),
      field('password', '密码', '输入密码', { type: 'password', sensitive: true, aliases: ['密码', 'pass'] })
    ] },
    { id: 'email', title: '邮箱验证', en: 'EMAIL CODE', icon: 'mail', hint: '粘贴邮件中的 6 位验证码，填写后在网页点击验证。', fields: [
      field('otp', '邮箱验证码', '6 位数字', { sensitive: true, numeric: true, aliases: ['验证码', '邮箱验证码', 'code', 'email code'] })
    ] },
    { id: 'phone', title: '手机验证', en: 'PHONE CODE', icon: 'phone', hint: '先填号码，在网页发送短信；收到短信后再单独填验证码。', fields: [
      field('iso_code', '国家 / 地区', 'US / CN / GB', { select: true, aliases: ['国家', '地区', 'country', '国家代码', 'country code'] }),
      field('phone_number', '手机号码', '按网页格式输入号码', { numeric: true, aliases: ['手机', '手机号', '手机号码', '电话', 'phone', 'tel'] }),
      field('otp', '短信验证码', '收到后填写 6 位数字', { sensitive: true, numeric: true, aliases: ['验证码', '短信验证码', 'code', 'sms'] })
    ] },
    { id: 'profile', title: '账户资料', en: 'PROFILE', icon: 'profile', hint: '国家先填写，省 / 州会等待网页加载后选择。留空的项目不处理。', fields: [
      field('country', '国家 / 地区', 'US / CN / GB', { select: true, aliases: ['国家', '地区', '国家代码'] }),
      field('first_name', '名', 'First name', { aliases: ['名', '名字', 'first name', 'firstname'] }),
      field('last_name', '姓', 'Last name', { aliases: ['姓', '姓氏', 'last name', 'lastname'] }),
      field('company_name', '公司（可选）', 'Company', { optional: true, aliases: ['公司', 'company', 'organization'] }),
      field('address_1', '地址', 'Street address', { wide: true, aliases: ['地址', '街道', 'address', 'address1', 'address 1'] }),
      field('address_2', '地址补充（可选）', 'Apartment, suite…', { optional: true, wide: true, aliases: ['地址2', '地址 2', 'address2', 'address 2', '地址补充'] }),
      field('city', '城市', 'City', { aliases: ['城市'] }),
      field('state', '省 / 州', 'California / CA', { select: true, dynamic: true, aliases: ['省', '州', '省州', 'province'] }),
      field('zip_code', '邮政编码', 'Postal code', { aliases: ['邮编', '邮政编码', 'zip', 'zipcode', 'postal code'] }),
      field('tax_id', '税号（可选）', '仅在需要时填写', { optional: true, aliases: ['税号', 'tax id', 'tin'] })
    ] },
    { id: 'card', title: '卡片信息', en: 'PAYMENT', icon: 'card', hint: '先在网页完成账户资料并继续，再填写卡片信息。', fields: [
      field('cc_number', '卡号', '输入卡号', { sensitive: true, numeric: true, wide: true, aliases: ['卡号', 'card', 'card number', 'number'] }),
      field('cc_expiration', '有效期', 'MM/YY 或 MM/YYYY', { sensitive: true, aliases: ['有效期', '到期', 'expiry', 'expiration', 'exp'] }),
      field('cvv', '安全码', 'CVV / CVC', { sensitive: true, numeric: true, type: 'password', aliases: ['安全码', 'cvc', 'csc'] })
    ] }
  ];
  const ociSteps = [
    { id: 'oci-signup', platform: 'oracle', title: '账户信息', en: 'ACCOUNT', icon: 'user', hint: '先选账单国家/地区，再填名、姓和邮箱，然后在网页点击 Verify my email。', url: 'https://signup.cloud.oracle.com/', fields: [
      field('country', '账单国家/地区', 'Trinidad and Tobago', { fullCountry: true, reactSelect: true, selectLabel: 'billing country', selectors: [], aliases: ['国家', '地区', '账单国家', 'billing country', 'country', 'territory'] }),
      field('firstName', '名', 'First name', { selectors: ['#firstName', '[name="firstName"]'], aliases: ['名', '名字', 'first name', 'firstname', 'given name'] }),
      field('lastName', '姓', 'Last name', { selectors: ['#lastName', '[name="lastName"]'], aliases: ['姓', '姓氏', 'last name', 'lastname', 'family name'] }),
      field('email', '邮箱', 'name@example.com', { type: 'email', selectors: ['#email', '[name="email"]'], aliases: ['邮箱', '电子邮箱', 'email'] })
    ] },
    { id: 'oci-password', platform: 'oracle', title: '密码与账户', en: 'PASSWORD', icon: 'shield', hint: '填密码和确认密码，选个人或公司，填云账户名和主区域，然后在网页继续。', fields: [
      field('password', '密码', '至少 8 位，含大小写字母、数字和符号', { type: 'password', sensitive: true, selectors: ['input[name="password"]', '[data-testid="passwordField"]'], aliases: ['密码', 'password'] }),
      field('matchPassword', '确认密码', '再输入一次密码', { type: 'password', sensitive: true, selectors: ['input[name="matchPassword"]', '[data-testid="matchPasswordField"]'], aliases: ['确认密码', '重复密码', 'confirm password', 'match password'] }),
      field('customerType', '账户类型', '个人 / 公司', { control: 'radio', options: [{ value: 'individual', label: '个人' }, { value: 'corporate', label: '公司' }], selectors: ['input[name="customer-type"]', '#individual-customer-radio', '#corporate-customer-radio'], aliases: ['账户类型', '客户类型', '类型', 'customer type'] }),
      field('organization', '公司法定名称', 'Legal company name（仅公司账户）', { optional: true, selectors: ['input[name="organization"]'], aliases: ['公司', '公司名称', '公司法定名称', 'legal company name', 'organization'] }),
      field('accountName', '云账户 / 租户名', 'Cloud Account/Tenancy Name', { selectors: ['#accountNameInput', 'input[name="accountName"]'], aliases: ['账户名', '云账户', '租户名', 'account name', 'tenancy', 'tenancy name'] }),
      field('homeRegion', '主区域（Home Region）', '例如 US East (Ashburn)', { optional: true, reactSelect: true, selectLabel: 'home region', selectors: [], aliases: ['主区域', '区域', 'home region', 'region'] })
    ] },
    { id: 'oci-address', platform: 'oracle', title: '地址信息', en: 'ADDRESS', icon: 'profile', hint: '填地址、城市、省/州、邮编和手机号。网页没显示的输入框会自动跳过。', fields: [
      field('address1', '地址1', 'Street address', { wide: true, selectors: ['#address1', '[name="address1"]'], aliases: ['地址', '地址1', 'address', 'address line 1', 'address1'] }),
      field('address2', '地址2（可选）', 'Address line 2', { optional: true, wide: true, selectors: ['#address2', '[name="address2"]'], aliases: ['地址2', 'address line 2', 'address2'] }),
      field('address3', '地址3（可选）', 'Address line 3', { optional: true, wide: true, selectors: ['#address3', '[name="address3"]'], aliases: ['地址3', 'address line 3', 'address3'] }),
      field('city', '城市', 'City', { selectors: ['#city', '[name="city"]'], aliases: ['城市', 'city'] }),
      field('state', '省 / 州', 'State / Province', { selectors: ['#state', '[name="state"]'], aliases: ['省', '州', '省州', 'state'] }),
      field('province', '省份（部分国家）', 'Province', { optional: true, selectors: ['#province', '[name="province"]'], aliases: ['省份', 'province'] }),
      field('postalcode', '邮政编码', 'Zip/Postal Code', { selectors: ['#postalcode', '[name="postalcode"]'], aliases: ['邮编', '邮政编码', 'zip', 'zip code', 'postal code', 'postalcode'] }),
      field('county', '区县（部分国家）', 'County', { optional: true, selectors: ['#county', '[name="county"]'], aliases: ['区县', '县', 'county', 'district'] }),
      field('phoneNumber', '手机号码', '带国家代码，如 +18681234567', { selectors: ['#phoneNumber', '[name="Phone Number"]'], aliases: ['手机', '手机号', '手机号码', '电话', 'phone', 'phone number'] })
    ] },
    { id: 'oci-card', platform: 'oracle', title: '卡片信息', en: 'PAYMENT', icon: 'card', frame: true, hint: '先在网页点击 Add payment verification method 打开支付框，选卡类型后再填写。', fields: [
      field('cardType', '卡类型', 'Visa / Mastercard / Amex / Discover / Diners', { optional: true, frame: true, control: 'select', options: [{ value: 'visa', label: 'Visa' }, { value: 'mastercard', label: 'Mastercard' }, { value: 'amex', label: 'American Express' }, { value: 'discover', label: 'Discover' }, { value: 'diners', label: 'Diners Club' }], selectors: [], aliases: ['卡类型', '卡片类型', 'card type', 'brand'] }),
      field('cc_number', '卡号', '输入卡号', { sensitive: true, numeric: true, wide: true, frame: true, selectors: [], aliases: ['卡号', 'card', 'card number', 'number'] }),
      field('cc_expiration', '有效期', 'MM/YY 或 MM/YYYY', { sensitive: true, frame: true, selectors: [], aliases: ['有效期', '到期', 'expiry', 'expiration', 'exp'] }),
      field('cvv', '安全码', 'CVV / CVC', { sensitive: true, numeric: true, type: 'password', frame: true, selectors: [], aliases: ['安全码', 'cvc', 'csc'] })
    ] }
  ];
  const platforms = [
    { id: 'aws', title: 'AWS', enabled: false },
    { id: 'linode', title: 'LINODE', enabled: true, hosts: ['https://login.linode.com/*'] },
    { id: 'oracle', title: 'ORACLE', enabled: true, hosts: ['https://signup.cloud.oracle.com/*', 'https://shop.oracle.com/*'] },
    { id: 'azure', title: 'AZURE', enabled: false }
  ];
  const allSteps = [...steps, ...ociSteps];
  const stepById = id => allSteps.find(s => s.id === id);
  const stepsFor = platform => allSteps.filter(s => (s.platform || 'linode') === platform);
  const defaults = { interval: 95, jitter: 35, fieldDelay: 400, typoEnabled: false, typoRate: 8, correctionDelay: 240, existing: 'skip', remember: true };
  function settings(raw = {}) {
    const clamp = (k, min, max) => Number.isFinite(Number(raw[k])) ? Math.min(max, Math.max(min, Number(raw[k]))) : defaults[k];
    // Preserve the old 0 = off setting when loading existing installations.
    const typoEnabled = typeof raw.typoEnabled === 'boolean' ? raw.typoEnabled : Number.isFinite(Number(raw.typoRate)) && Number(raw.typoRate) > 0;
    const typoRate = Number(raw.typoRate) === 0 ? defaults.typoRate : Math.round(clamp('typoRate', 1, 100));
    return { interval: clamp('interval', 20, 500), jitter: clamp('jitter', 0, 80), fieldDelay: clamp('fieldDelay', 0, 2000), typoEnabled, typoRate, correctionDelay: clamp('correctionDelay', 80, 1000), existing: ['skip', 'replace', 'append'].includes(raw.existing) ? raw.existing : defaults.existing, remember: raw.remember !== false };
  }
  const countries = { '中国': 'CN', '美国': 'US', '英国': 'GB', '加拿大': 'CA', '澳大利亚': 'AU', '新加坡': 'SG', '日本': 'JP', '香港': 'HK', '台湾': 'TW', '德国': 'DE', '法国': 'FR', 'united states of america': 'US', 'united states': 'US', 'usa': 'US', 'uk': 'GB', 'united kingdom': 'GB', 'china': 'CN' };
  function country(value) { return countries[value.toLowerCase()] || (/^[a-z]{2}$/i.test(value) ? value.toUpperCase() : value); }
  // Oracle's billing country is a react-select of full English names, so two-letter codes are expanded.
  const countryNames = { US: 'United States', GB: 'United Kingdom', CN: 'China', CA: 'Canada', AU: 'Australia', SG: 'Singapore', JP: 'Japan', HK: 'Hong Kong', TW: 'Taiwan', DE: 'Germany', FR: 'France', NL: 'Netherlands', IT: 'Italy', ES: 'Spain', BR: 'Brazil', IN: 'India', KR: 'South Korea', MY: 'Malaysia', TH: 'Thailand', VN: 'Vietnam', PH: 'Philippines', ID: 'Indonesia', TR: 'Turkey', AE: 'United Arab Emirates', SA: 'Saudi Arabia', IL: 'Israel', ZA: 'South Africa', NG: 'Nigeria', KE: 'Kenya', EG: 'Egypt', MX: 'Mexico', AR: 'Argentina', CL: 'Chile', CO: 'Colombia', PE: 'Peru', PL: 'Poland', SE: 'Sweden', NO: 'Norway', DK: 'Denmark', FI: 'Finland', IE: 'Ireland', PT: 'Portugal', GR: 'Greece', CZ: 'Czech Republic', AT: 'Austria', CH: 'Switzerland', BE: 'Belgium', RO: 'Romania', UA: 'Ukraine', RU: 'Russia', NZ: 'New Zealand', TT: 'Trinidad and Tobago', PK: 'Pakistan', BD: 'Bangladesh', LK: 'Sri Lanka', NP: 'Nepal', KH: 'Cambodia', MM: 'Myanmar', LA: 'Laos', MN: 'Mongolia', KZ: 'Kazakhstan', UZ: 'Uzbekistan', GE: 'Georgia', AM: 'Armenia', AZ: 'Azerbaijan', BY: 'Belarus', BG: 'Bulgaria', HR: 'Croatia', RS: 'Serbia', SK: 'Slovakia', SI: 'Slovenia', LT: 'Lithuania', LV: 'Latvia', EE: 'Estonia', IS: 'Iceland', LU: 'Luxembourg', MT: 'Malta', CY: 'Cyprus', CR: 'Costa Rica', PA: 'Panama', GT: 'Guatemala', DO: 'Dominican Republic', JM: 'Jamaica', BS: 'Bahamas', BB: 'Barbados', GY: 'Guyana', SR: 'Suriname', BZ: 'Belize', HN: 'Honduras', SV: 'El Salvador', NI: 'Nicaragua', EC: 'Ecuador', BO: 'Bolivia', PY: 'Paraguay', UY: 'Uruguay', VE: 'Venezuela' };
  function expandCountry(value) {
    const text = String(value ?? '').trim();
    const code = countries[text.toLowerCase()];
    if (code && countryNames[code]) return countryNames[code];
    const upper = text.toUpperCase();
    if (/^[A-Z]{2}$/.test(upper) && countryNames[upper]) return countryNames[upper];
    return text;
  }
  function normalize(f, value) {
    const text = f.key === 'password' ? String(value ?? '') : String(value ?? '').trim();
    if (['country', 'iso_code'].includes(f.key)) return f.fullCountry ? expandCountry(text) : country(text);
    if (['cc_number', 'cvv', 'otp'].includes(f.key)) return text.replace(/[\s-]/g, '');
    if (['phone_number', 'phoneNumber'].includes(f.key)) return text.replace(/[\s().-]/g, '');
    if (f.key === 'cardType') return text.toLowerCase().replace(/\s+/g, '');
    if (f.key === 'cc_expiration') {
      const match = text.match(/^(\d{1,2})\s*[/\-]\s*(\d{2}|\d{4})$/) || text.match(/^(\d{2})(\d{2}|\d{4})$/);
      if (match) return `${match[1].padStart(2, '0')}/${match[2].length === 2 ? '20' + match[2] : match[2]}`;
    }
    return text;
  }
  function validate(f, value) {
    if (!value) return null;
    if (value.length > 256) return `${f.label}内容过长`;
    if (['country', 'iso_code'].includes(f.key) && /[\p{N}〒]/u.test(value)) return '国家 / 地区应填写国家名称或两位代码，不能填写整段地址；请使用带字段名的格式';
    if (f.key === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return '请检查邮箱格式';
    if (['firstName', 'lastName'].includes(f.key) && !/^[\p{L}\p{M}][\p{L}\p{M}'’.\- ]*$/u.test(value)) return `${f.label}请只填写姓名文字`;
    if (f.key === 'accountName' && !/^[A-Za-z][A-Za-z0-9-]{0,39}$/.test(value)) return '云账户名需以字母开头，仅含字母、数字或连字符，最多 40 位';
    if (f.key === 'otp' && !/^\d{6}$/.test(value)) return '验证码应为 6 位数字';
    if (['phone_number', 'phoneNumber'].includes(f.key) && !/^\+?\d{5,16}$/.test(value)) return '请检查手机号码格式';
    if (f.key === 'cc_number' && !/^\d{12,19}$/.test(value)) return '卡号应为 12–19 位数字';
    if (f.key === 'cvv' && !/^\d{3,4}$/.test(value)) return '安全码应为 3–4 位数字';
    if (f.key === 'cc_expiration' && !/^(0[1-9]|1[0-2])\/20\d{2}$/.test(value)) return '有效期请使用 MM/YY 或 MM/YYYY';
    if (/[\r\n\u0000]/.test(value)) return `${f.label}不能包含换行或控制字符`;
    return null;
  }
  function parse(stepId, source) {
    const spec = stepById(stepId);
    if (!spec) throw new Error('未知步骤');
    if (source.length > 20000) throw new Error('内容过长，请只粘贴当前步骤的资料');
    const values = {}, warnings = [];
    const key = x => x.toLowerCase().replace(/[\s_\-（）()]/g, '');
    const names = new Map(spec.fields.flatMap(f => [f.key, f.label, ...(f.aliases || [])].map(n => [key(n), f])));
    const assign = (name, value) => {
      const f = names.get(key(name));
      if (!f) { warnings.push('有未识别的字段，已忽略'); return; }
      if (!['string', 'number'].includes(typeof value)) { warnings.push(`${f.label}需要文本内容`); return; }
      if (typeof value === 'number' && (f.sensitive || f.numeric)) { warnings.push(`${f.label}请使用带引号的文本，避免丢失前导零或精度`); return; }
      const normalized = normalize(f, value);
      if (['country', 'iso_code'].includes(f.key)) {
        const error = validate(f, normalized);
        if (error) throw new Error(error);
      }
      values[f.key] = normalized;
    };
    const text = source.trim();
    if (!text) return { values, warnings };
    // Three-line signup input takes precedence over punctuation inside the password.
    const signupLines = source.split(/\r?\n/);
    while (signupLines.length && !signupLines[0].trim()) signupLines.shift();
    while (signupLines.length > 3 && signupLines.at(-1) === '') signupLines.pop();
    if (stepId === 'signup' && signupLines.length >= 3 && /^[^\s@:：=]+@[^\s@]+\.[^\s@]+$/.test(signupLines[0].trim())) {
      if (signupLines.length !== 3) throw new Error('注册信息请只粘贴三行：邮箱、用户名、密码');
      spec.fields.forEach((f, i) => { values[f.key] = normalize(f, signupLines[i]); });
      return { values, warnings };
    }
    if (text.startsWith('{')) {
      let data; try { data = JSON.parse(text); } catch { throw new Error('JSON 格式有误，请检查引号和逗号'); }
      Object.entries(data).forEach(([name, value]) => assign(name, value));
    } else {
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      const labeled = lines.some(l => /^\s*[^:：=]+[:：=]/.test(l) && names.has(key(l.split(/[:：=]/)[0])));
      if (labeled) {
        for (const line of lines) {
          const m = line.match(/^\s*([^:：=]+)[:：=][ \t]?(.*)$/);
          if (m) assign(m[1].trim(), m[2]); else warnings.push('有一行无法识别，已忽略');
        }
      } else {
        const parts = text.includes('\t') ? text.split(/\t|\r?\n/) : text.includes('----') ? text.split('----') : text.includes('|') ? text.split('|') : lines;
        const isCard = stepId === 'card' || stepId === 'oci-card';
        if (isCard && (parts.length === 4 || parts.length === 5)) {
          const typed = parts.length === 5;
          const [brand, number, month, year, cvv] = typed ? parts.map(v => v.trim()) : ['', ...parts.map(v => v.trim())];
          if (!/^(0?[1-9]|1[0-2])$/.test(month) || !/^(\d{2}|20\d{2})$/.test(year)) throw new Error('卡片格式：卡号|月份|年份|cvv；月份为 1–12，年份为两位或 20xx');
          if (typed) assign('cardType', brand);
          assign('cc_number', number);
          assign('cc_expiration', `${month}/${year}`);
          assign('cvv', cvv);
          for (const f of spec.fields) {
            if (!values[f.key] && !f.optional) throw new Error('卡号、月份、年份和 cvv 都需要填写');
            const error = validate(f, values[f.key]);
            if (error) throw new Error(error);
          }
          return { values, warnings };
        }
        if (isCard && parts.length > 5) throw new Error('卡片格式：卡号|月份|年份|cvv；请一次只粘贴一张卡');
        if (parts.length > spec.fields.length) warnings.push('内容多于本步骤字段数，超出部分已忽略');
        parts.slice(0, spec.fields.length).forEach((v, i) => assign(spec.fields[i].key, v));
      }
    }
    return { values, warnings: [...new Set(warnings)] };
  }
  function splitDrafts(drafts) {
    const saved = {}, transient = {};
    for (const s of allSteps) {
      saved[s.id] = {}; transient[s.id] = {};
      for (const f of s.fields) {
        const value = drafts[s.id]?.[f.key];
        if (typeof value === 'string' && value) (f.sensitive ? transient : saved)[s.id][f.key] = value;
      }
    }
    return { saved, transient };
  }
  const api = { steps, ociSteps, allSteps, platforms, stepsFor, stepById, defaults, settings, normalize, validate, parse, splitDrafts };
  root.LightType = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
