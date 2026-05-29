chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CAPTURE_SCREENSHOT') {
    chrome.tabs.captureVisibleTab(
      sender.tab.windowId,
      { format: 'png', quality: 90 },
      (dataUrl) => {
        sendResponse({ dataUrl });
      }
    );
    return true;
  }
});
