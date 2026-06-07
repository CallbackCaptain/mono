// Background service worker for OmniChat AutoResponder

chrome.runtime.onInstalled.addListener((details) => {
    console.log('OmniChat AutoResponder installed:', details.reason);
    
    if (details.reason === 'install') {
        // Seed only the on/off flag. The full config lives in content.js (single
        // source of truth) and is persisted there on first change — duplicating a
        // partial copy here just drifts out of sync.
        chrome.storage.local.set({
            autoResponseEnabled: true,
            processedAppeals: []
        });
    }
});

// Update badge when on OmniChat
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url?.includes('omnichat.rt.ru')) {
        chrome.action.setBadgeText({ text: '●', tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#28a745', tabId });
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    chrome.action.setBadgeText({ text: '', tabId });
});
