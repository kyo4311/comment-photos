const APP_URL = chrome.runtime.getURL('app/index.html');

chrome.action.onClicked.addListener(async (tab) => {
  const existing = await findAppTab();
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    if (tab && typeof tab.windowId === 'number') {
      try {
        await chrome.windows.update(tab.windowId, { focused: true });
      } catch (e) {}
    }
  } else {
    await chrome.tabs.create({ url: APP_URL });
  }
});

async function findAppTab() {
  const tabs = await chrome.tabs.query({ url: APP_URL });
  return tabs[0] || null;
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('本地图片点评管理器已安装');
});