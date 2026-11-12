// Size the native toolbar popup before its first layout, including on non-Linode tabs.
if (new URLSearchParams(location.search).has('popup') || (typeof chrome !== 'undefined' && chrome.extension?.getViews({ type: 'popup' }).includes(window))) document.documentElement.classList.add('popup');
