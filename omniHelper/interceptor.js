// Runs in the page's MAIN world (see manifest.json) to wrap window.fetch.
// Communicates with content.js via window.postMessage.
(function() {
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const [url] = args;
        const urlStr = typeof url === 'string' ? url : url?.url || '';

        // Catch appealId from URL params
        if (urlStr.includes('appealId=')) {
            const match = urlStr.match(/appealId=(\d+)/);
            if (match) {
                window.postMessage({
                    type: 'omni-appeal-detected',
                    appealId: match[1]
                }, '*');
            }
        }

        // Intercept response to extract appealId + client name mapping
        const response = await originalFetch.apply(this, args);
        try {
            if (urlStr.includes('/appeal') || urlStr.includes('/chat')) {
                const clone = response.clone();
                clone.json().then(data => {
                    const appeals = Array.isArray(data) ? data :
                                    data?.data ? (Array.isArray(data.data) ? data.data : [data.data]) :
                                    data?.result ? (Array.isArray(data.result) ? data.result : [data.result]) :
                                    [data];
                    appeals.forEach(item => {
                        const id = item?.appealId || item?.id || item?.appeal_id;
                        const name = item?.clientName || item?.client_name ||
                                     item?.customer?.name || item?.name;
                        if (id && name) {
                            window.postMessage({
                                type: 'omni-appeal-mapping',
                                appealId: String(id),
                                clientName: name.trim()
                            }, '*');
                        }
                    });
                }).catch(() => {});
            }
        } catch(e) {}
        return response;
    };
})();
