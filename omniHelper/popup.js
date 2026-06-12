const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', () => {
    $('version').textContent = 'v' + chrome.runtime.getManifest().version;

    loadState();
    setInterval(loadState, 2000);

    $('autoToggle').addEventListener('change', () => {
        sendToActiveTab({ action: 'toggleAutoResponse' }, (response) => {
            if (response?.success) {
                applyEnabled(response.enabled);
            } else {
                loadState(); // не достучались — вернуть фактическое состояние
            }
        });
    });
});

function loadState() {
    sendToActiveTab({ action: 'getStats' }, (response) => {
        if (!response?.success) {
            setOffline();
            return;
        }

        const s = response.stats;
        applyEnabled(s.autoResponseEnabled, s.isProcessing);

        $('autoToggle').disabled = false;
        $('statsGrid').classList.remove('offline');
        $('statToday').textContent = s.processedToday ?? '—';
        $('statTotal').textContent = s.processedAppeals ?? '—';
        $('statQueue').textContent = s.queueLength ?? '—';
        $('statExtra').textContent = s.extraTimeSent ?? '—';
    });
}

function sendToActiveTab(message, callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) return callback(null);
        chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
            callback(chrome.runtime.lastError ? null : response);
        });
    });
}

function applyEnabled(enabled, isProcessing = false) {
    $('autoToggle').checked = enabled;
    const dot = $('statusDot');
    dot.className = 'status-dot' + (isProcessing ? ' busy' : enabled ? '' : ' off');
    $('statusText').textContent = isProcessing ? 'Обработка...' : enabled ? 'Активен' : 'Выключен';
}

function setOffline() {
    const toggle = $('autoToggle');
    toggle.checked = false;
    toggle.disabled = true;
    $('statusDot').className = 'status-dot off';
    $('statusText').textContent = 'Не на OmniChat';
    $('statsGrid').classList.add('offline');
    for (const id of ['statToday', 'statTotal', 'statQueue', 'statExtra']) {
        $(id).textContent = '—';
    }
}
