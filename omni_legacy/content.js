// Background service worker for OmniChat AutoResponder

chrome.runtime.onInstalled.addListener((details) => {
    console.log('OmniChat AutoResponder installed:', details.reason);
    
    if (details.reason === 'install') {
        chrome.storage.local.set({
            autoResponseEnabled: true,
            processedAppeals: [],
            config: {
                responseDelay: 2000,
                clickDelay: 500,
                checkInterval: 2000,  // Check for new appeals every 2 seconds
                cooldownPeriod: 7200000,
                templateText: 'Запрос принят в работу',
                templateTitle: '1.1 Приветствие'
            }
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
