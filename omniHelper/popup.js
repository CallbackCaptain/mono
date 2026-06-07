document.addEventListener('DOMContentLoaded', () => {
    loadState();
    setInterval(loadState, 3000);

    document.getElementById('autoToggle').addEventListener('change', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0]) return;
            chrome.tabs.sendMessage(tabs[0].id, { action: 'toggleAutoResponse' });
        });
    });
});

function loadState() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) return;

        chrome.tabs.sendMessage(tabs[0].id, { action: 'getStats' }, (response) => {
            if (chrome.runtime.lastError || !response?.success) {
                setStatus(false, 'Не на OmniChat');
                return;
            }

            const { autoResponseEnabled, isProcessing } = response.stats;
            document.getElementById('autoToggle').checked = autoResponseEnabled;
            setStatus(
                autoResponseEnabled,
                isProcessing ? 'Обработка...' : autoResponseEnabled ? 'Активен' : 'Выключен'
            );
        });
    });
}

function setStatus(on, text) {
    const dot = document.getElementById('statusDot');
    dot.className = 'status-dot' + (on ? '' : ' off');
    document.getElementById('statusText').textContent = text;
}
