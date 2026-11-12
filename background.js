importScripts('core.js');

// Replace the older floating-window action with the native toolbar popup.
void chrome.action.setPopup({ popup: 'panel.html?popup=1' }).catch(() => {});

// Finish saves even when Chrome closes the popup immediately after an edit.
let storageQueue = Promise.resolve();
function enqueue(work) {
  const result = storageQueue.then(work);
  storageQueue = result.catch(() => {});
  return result;
}
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
});
const SUPPORTED_URLS = ['https://login.linode.com/*', 'https://signup.cloud.oracle.com/*', 'https://shop.oracle.com/*'];
const isSupportedUrl = url => /^https:\/\/(login\.linode\.com|signup\.cloud\.oracle\.com|shop\.oracle\.com)\//.test(url || '');
chrome.tabs.onActivated.addListener(async ({ windowId }) => {
  try {
    const tabs = await chrome.tabs.query({ windowId, url: SUPPORTED_URLS });
    await Promise.allSettled(tabs.filter(tab => !tab.active).map(tab =>
      chrome.tabs.sendMessage(tab.id, { type: 'LIGHT_SUSPEND' })
    ));
  } catch { /* The window may already have closed. */ }
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  const fromUI = sender.url?.startsWith(chrome.runtime.getURL(''));
  let work;
  if (message.type === 'LIGHT_SAVE' && fromUI) {
    work = async () => {
      const settings = LightType.settings(message.settings);
      const { saved, transient } = LightType.splitDrafts(message.drafts || {});
      const pastes = {};
      for (const step of LightType.allSteps) {
        const text = message.pastes?.[step.id];
        if (typeof text === 'string') pastes[step.id] = text.slice(0, 20000);
      }
      await chrome.storage.local.set({ settings });
      if (settings.remember) await chrome.storage.local.set({ drafts: saved });
      else await chrome.storage.local.remove('drafts');
      await chrome.storage.session.set({ draftSession: {
        transient, pastes, expires: Date.now() + 15 * 60 * 1000,
        step: message.step, platform: message.platform
      } });
      return { ok: true };
    };
  } else if (message.type === 'LIGHT_LOAD' && fromUI) {
    work = async () => {
      const [local, session] = await Promise.all([
        chrome.storage.local.get(['settings', 'drafts']),
        chrome.storage.session.get(['draftSession', 'activeTask'])
      ]);
      return { ok: true, local, session };
    };
  } else if (message.type === 'LIGHT_STATUS' && sender.tab && isSupportedUrl(sender.url)) {
    work = async () => {
      const status = message.payload;
      if (!status?.runId) return { ok: true };
      const session = await chrome.storage.session.get(['activeTask', 'draftSession']);
      if (status.state === 'done' && session.activeTask?.clearedRun !== status.runId) {
        const draft = session.draftSession;
        if (draft) {
          if (draft.transient) delete draft.transient[status.jobStage];
          if (draft.pastes) delete draft.pastes[status.jobStage];
          await chrome.storage.session.set({ draftSession: draft });
        }
      }
      await chrome.storage.session.set({ activeTask: {
        ...status, tabId: sender.tab.id, windowId: sender.tab.windowId,
        clearedRun: status.state === 'done' ? status.runId : session.activeTask?.clearedRun
      } });
      return { ok: true };
    };
  }
  if (!work) return;
  enqueue(work).then(respond, () => respond({ ok: false, error: '插件资料保存失败，请重新打开弹窗重试' }));
  return true;
});
