// ===== OMNICHAT AUTO-RESPONDER v5.0 =====
// Simplified and reliable auto-response system

class OmniChatAutoResponder {
    constructor() {
        // Core state
        this.processedAppeals = new Map(); // appealId → timestamp
        this.appealQueue = [];
        this.isProcessing = false;
        this.autoResponseEnabled = true;
        this.knownAppealIds = new Map(); // name → Set of real appealIds from network
        
        // Extra-time tracking (persisted in chrome.storage)
        this.extraTimeSent = new Map(); // appealId → last send timestamp

        // Configuration
        this.config = {
            responseDelay: 2000,
            clickDelay: 500,
            checkInterval: 2000,       // Check for new appeals every 2 seconds
            cooldownPeriod: 2 * 60 * 60 * 1000,  // 2 hours cooldown
            templateText: 'Запрос принят в работу',
            templateTitle: '1.1 Приветствие',
            extraTimeThreshold: 720,   // seconds on badge timer (send when ≤12 min remain)
            extraTimeMinAge: 3 * 60 * 1000, // min 3 minutes after greeting before extra-time
            extraTimeTemplateText: 'Мне нужно немного времени для решения вашего запроса. Пожалуйста, оставайтесь в чате.',
            extraTimeTemplateTitle: '2.2 Ожидание общее',
            extraTimeRepeatInterval: 3 * 60 * 1000  // repeat every 3 min while timer < threshold
        };
        
        this.init();
    }

    init() {
        console.log('🚀 OmniChat AutoResponder v5.0');
        this.loadState();
        this.injectInterceptor();
        this.setupObserver();
        this.startPeriodicCheck();
        this.exposeAPI();

        // Initial check after page load
        setTimeout(() => this.checkForAppeals(), 3000);
    }

    // ===== STATE MANAGEMENT =====
    
    isChromeValid() {
        try {
            return !!(chrome && chrome.runtime && chrome.runtime.id);
        } catch (e) {
            return false;
        }
    }

    loadState() {
        if (!this.isChromeValid()) return;
        try {
            chrome.storage.local.get(['processedAppeals', 'autoResponseEnabled', 'config', 'extraTimeSent'], (result) => {
                if (chrome.runtime.lastError) return;
                if (result.autoResponseEnabled !== undefined) {
                    this.autoResponseEnabled = result.autoResponseEnabled;
                }

                if (result.processedAppeals) {
                    const now = Date.now();
                    result.processedAppeals.forEach(item => {
                        if (now - item.timestamp < this.config.cooldownPeriod) {
                            this.processedAppeals.set(item.appealId, item.timestamp);
                        }
                    });
                    console.log(`📥 Loaded ${this.processedAppeals.size} processed appeals`);
                }

                if (result.extraTimeSent) {
                    result.extraTimeSent.forEach(item => {
                        if (typeof item === 'string') {
                            // Legacy format (Set) — ignore, will re-send
                        } else {
                            this.extraTimeSent.set(item.id, item.timestamp);
                        }
                    });
                    console.log(`📥 Loaded ${this.extraTimeSent.size} extra-time records`);
                }

                if (result.config) {
                    Object.assign(this.config, result.config);
                }
            });
        } catch (e) {
            console.warn('⚠️ Chrome API unavailable in loadState');
        }
    }

    saveProcessedAppeal(appealId) {
        this.processedAppeals.set(appealId, Date.now());

        if (!this.isChromeValid()) return;
        try {
            chrome.storage.local.get(['processedAppeals'], (result) => {
                if (chrome.runtime.lastError) return;
                const processed = result.processedAppeals || [];

                processed.push({
                    appealId: appealId,
                    timestamp: Date.now()
                });

                const now = Date.now();
                const filtered = processed
                    .filter(item => now - item.timestamp < this.config.cooldownPeriod)
                    .slice(-100);

                chrome.storage.local.set({ processedAppeals: filtered });
            });
        } catch (e) {
            console.warn('⚠️ Chrome API unavailable in saveProcessedAppeal');
        }
    }

    saveExtraTimeSent() {
        if (!this.isChromeValid()) return;
        try {
            const data = [...this.extraTimeSent.entries()]
                .map(([id, timestamp]) => ({ id, timestamp }))
                .slice(-100);
            chrome.storage.local.set({ extraTimeSent: data });
        } catch (e) {}
    }

    // ===== APPEAL DETECTION =====
    
    checkForAppeals() {
        if (!this.autoResponseEnabled) return;

        const appeals = this.findAppealsInSidebar();

        appeals.forEach(appeal => {
            if (this.shouldProcess(appeal.id)) {
                this.addToQueue(appeal);
            } else if (appeal.isNameBased && this.processedAppeals.has(appeal.id)) {
                // Повторное обращение от того же клиента
                const processedAt = this.processedAppeals.get(appeal.id);
                const elapsed = Date.now() - processedAt;
                const timer = this.getBadgeTimer(appeal.element);

                // 10+ минут с обработки И badge таймер ≤ 60 сек (свежее обращение)
                if (elapsed > 2 * 60 * 1000 && timer !== null && timer <= 60) {
                    const reappealId = `${appeal.id}_re_${Date.now()}`;
                    console.log('🔄 Re-appeal detected:', appeal.name, `(timer: ${timer}s)`);
                    this.addToQueue({ ...appeal, id: reappealId });
                    // Prevent extra-time from also firing for this appeal
                    this.extraTimeSent.set(appeal.id, Date.now());
                    this.saveExtraTimeSent();
                }
            }
        });

        // Check for extra-time notifications
        this.checkExtraTime();
    }

    checkExtraTime() {
        const now = Date.now();
        const elements = document.querySelectorAll('[data-testid="appeal-preview"]');
        elements.forEach(element => {
            const appealData = this.extractAppealData(element);
            if (!appealData) return;
            const timer = this.getBadgeTimer(element);
            if (timer === null || timer > this.config.extraTimeThreshold) return;
            if (!this.processedAppeals.has(appealData.id)) return;

            const processedAt = this.processedAppeals.get(appealData.id);
            const age = now - processedAt;
            if (age < this.config.extraTimeMinAge) return;

            // Skip if a greeting/re-appeal is pending in queue for this appeal
            const hasPendingGreeting = this.appealQueue.some(a =>
                a.name === appealData.name && a.type !== 'extraTime'
            );
            if (hasPendingGreeting) return;

            // Skip if already queued for extra-time
            const hasQueuedExtraTime = this.appealQueue.some(a =>
                a.originalId === appealData.id && a.type === 'extraTime'
            );
            if (hasQueuedExtraTime) return;

            // Check repeat interval — allow resending after cooldown
            const lastSent = this.extraTimeSent.get(appealData.id);
            if (lastSent && (now - lastSent) < this.config.extraTimeRepeatInterval) return;

            console.log('⏰ Extra-time needed:', appealData.name, `(timer: ${timer}s, repeat: ${lastSent ? 'yes' : 'first'})`);
            const extraTimeId = `${appealData.id}_extraTime_${now}`;
            this.appealQueue.push({
                ...appealData,
                id: extraTimeId,
                originalId: appealData.id,
                type: 'extraTime',
                addedAt: now
            });
            this.extraTimeSent.set(appealData.id, now);
            this.saveExtraTimeSent();
            if (!this.isProcessing) {
                this.processQueue();
            }
        });
    }

    findAppealsInSidebar() {
        const appeals = [];
        const elements = document.querySelectorAll('[data-testid="appeal-preview"]');

        elements.forEach(element => {
            const appealData = this.extractAppealData(element);
            if (appealData && this.isNewAppeal(element)) {
                appeals.push(appealData);
            }
        });

        // Для name-based ID: если несколько обращений от одного клиента,
        // добавить индекс чтобы каждое получило уникальный ID
        const nameCount = {};
        appeals.forEach(appeal => {
            if (appeal.isNameBased) {
                nameCount[appeal.id] = (nameCount[appeal.id] || 0) + 1;
            }
        });

        const nameIndex = {};
        appeals.forEach(appeal => {
            if (appeal.isNameBased && nameCount[appeal.id] > 1) {
                nameIndex[appeal.id] = (nameIndex[appeal.id] || 0) + 1;
                appeal.id = `${appeal.id}_slot_${nameIndex[appeal.id]}`;
            }
        });

        return appeals;
    }

    extractAppealData(element) {
        const nameEl = element.querySelector('[title], .sc-eFzpJt');
        const name = nameEl?.getAttribute('title') || nameEl?.textContent?.trim();

        if (!name) return null;

        // Priority 1: real appealId from element attributes
        const realId = element.getAttribute('data-id') ||
                       element.getAttribute('data-appeal-id') ||
                       element.closest('[data-id]')?.getAttribute('data-id');

        // Priority 2: appealId from network mapping (name → appealId)
        let networkId = null;
        const knownIds = this.knownAppealIds.get(name);
        if (knownIds) {
            // Find an appealId for this name that hasn't been processed yet
            for (const aid of knownIds) {
                if (!this.processedAppeals.has(aid)) {
                    networkId = aid;
                    break;
                }
            }
            // If all are processed, use the last one (won't pass shouldProcess anyway)
            if (!networkId) {
                networkId = [...knownIds].pop();
            }
        }

        // Priority 3: fall back to name (stable but can collide for same-name clients)
        const nameId = name.replace(/\s+/g, '_').replace(/[^\wа-яА-Я_-]/gi, '').substring(0, 50);
        const id = realId || networkId || nameId;

        return {
            id: id,
            name: name,
            element: element,
            isNameBased: !realId && !networkId
        };
    }

    isNewAppeal(element) {
        // Check for badge/dot indicator (new message)
        const badge = element.querySelector('[data-testid="badge"], [data-testid="dot"]');
        if (badge) return true;
        
        // Check for unread class
        const classList = element.className || '';
        if (classList.includes('unread') || classList.includes('new')) return true;
        
        return false;
    }

    getBadgeTimer(element) {
        const badge = element.querySelector('[data-testid="badge"]');
        if (!badge) return null;
        const span = badge.querySelector('span');
        if (!span) return null;
        const match = span.textContent.match(/(\d+)/);
        return match ? parseInt(match[1]) : null;
    }

    shouldProcess(appealId) {
        if (!appealId) return false;
        if (this.processedAppeals.has(appealId)) return false;
        if (this.appealQueue.some(a => a.id === appealId)) return false;
        if (this.currentAppealId === appealId) return false;
        
        return true;
    }

    // ===== QUEUE MANAGEMENT =====
    
    addToQueue(appeal) {
        if (!this.shouldProcess(appeal.id)) return false;
        
        console.log('➕ Adding to queue:', appeal.id);
        this.appealQueue.push({
            ...appeal,
            addedAt: Date.now()
        });
        
        if (!this.isProcessing) {
            this.processQueue();
        }
        
        return true;
    }

    async processQueue() {
        if (this.appealQueue.length === 0) {
            this.isProcessing = false;
            return;
        }

        this.isProcessing = true;
        const appeal = this.appealQueue.shift();
        this.currentAppealId = appeal.id;
        
        console.log('⚙️ Processing:', appeal.id);
        
        try {
            if (appeal.type === 'extraTime') {
                await this.sendTemplate(appeal, this.config.extraTimeTemplateTitle, this.config.extraTimeTemplateText);
                console.log('✅ Extra-time sent:', appeal.id);
            } else {
                await this.sendTemplate(appeal, this.config.templateTitle, this.config.templateText);
                this.saveProcessedAppeal(appeal.id);
                console.log('✅ Processed:', appeal.id);
            }
        } catch (error) {
            console.error('❌ Failed:', appeal.id, error.message);
            if (appeal.type !== 'extraTime') {
                // Mark as processed anyway to prevent spam
                this.saveProcessedAppeal(appeal.id);
            }
        }
        
        this.currentAppealId = null;
        
        // Process next with delay
        await this.wait(this.config.responseDelay);
        this.processQueue();
    }

    // ===== AUTO-RESPONSE =====

    async flushCurrentInput() {
        const input = document.querySelector('textarea, [contenteditable="true"], [data-testid="message-input"]');
        if (!input) return;

        const text = (input.value || input.textContent || '').trim();
        if (!text) return;

        console.log('📤 Flushing current input before switching chat:', text.substring(0, 60));
        await this.clickSendButton();
        await this.wait(this.config.clickDelay);
    }

    async sendTemplate(appeal, templateTitle, templateText) {
        // Flush any text in the current chat input before switching
        await this.flushCurrentInput();

        // Step 1: Click on appeal to select it
        let el = appeal.element;
        if (!el || !document.contains(el)) {
            // Re-find the element if it's detached from DOM
            const all = document.querySelectorAll('[data-testid="appeal-preview"]');
            for (const candidate of all) {
                const nameEl = candidate.querySelector('[title], .sc-eFzpJt');
                const name = nameEl?.getAttribute('title') || nameEl?.textContent?.trim();
                if (name === appeal.name) {
                    el = candidate;
                    break;
                }
            }
        }
        if (el && document.contains(el)) {
            this.simulateClick(el);
            await this.wait(this.config.clickDelay);
        }

        // Safety: check if this template was already sent in this chat
        const chatMessages = document.querySelectorAll(
            '[data-testid="message"], .message-content, .chat-message'
        );
        for (const msg of chatMessages) {
            if (msg.textContent?.includes(templateText)) {
                console.log('⚠️ Template already present in chat, skipping:', appeal.id);
                return;
            }
        }

        // Step 2: Open template selector with retry
        const templateBtn = await this.waitForElement('button[data-testid="choose-templates"]');
        if (!templateBtn) throw new Error('Template button not found');

        const findModal = (parent) => parent.querySelector('div[data-testid="modal"]') ||
            parent.querySelector('[role="dialog"]') ||
            parent.querySelector('[class*="modal" i][class*="template" i]') ||
            parent.querySelector('[class*="Modal"]');

        // Try up to 3 times to open the modal
        let modal = null;
        for (let attempt = 1; attempt <= 3 && !modal; attempt++) {
            console.log(`📋 Template button click attempt ${attempt}`);
            this.simulateClick(templateBtn);
            modal = await this.waitForElement(findModal, document, 3000);
        }
        if (!modal) throw new Error('Template modal not found');
        
        // Wait for templates to load inside modal
        await this.waitForElement('div[data-testid="reply-template"]', modal, 5000);
        const templates = modal.querySelectorAll('div[data-testid="reply-template"]');
        console.log(`📋 Found ${templates.length} templates in modal`);

        if (templates.length === 0) {
            // Try broader selectors
            const allClickable = modal.querySelectorAll('[class*="template" i], [class*="Template"], li, [role="option"], [role="listitem"]');
            console.log(`📋 Fallback: found ${allClickable.length} clickable items`);
            allClickable.forEach((el, i) => console.log(`  [${i}]`, el.textContent?.substring(0, 60)));
        }

        let targetTemplate = this.findTargetTemplate(templates, templateTitle, templateText);

        if (!targetTemplate && templates.length > 0) {
            targetTemplate = templates[0];
        }

        if (!targetTemplate) throw new Error('No templates available');

        console.log('📋 Clicking template:', targetTemplate.textContent?.substring(0, 60));
        // Click the inner title element for better React event propagation
        const clickTarget = targetTemplate.querySelector('span[data-testid="reply-title"]') ||
                           targetTemplate.querySelector('[data-testid="collapsable-text"]') ||
                           targetTemplate;
        this.simulateClick(clickTarget);
        await this.wait(1000);

        // If template text didn't appear, try clicking the outer container
        const inputCheck = document.querySelector('textarea, [contenteditable="true"], [data-testid="message-input"]');
        const inputCheckText = inputCheck?.value || inputCheck?.textContent || '';
        if (!inputCheckText.includes(templateText)) {
            console.log('📋 Retrying click on template container');
            this.simulateClick(targetTemplate);
            await this.wait(1000);
        }

        // Verify template was inserted into input
        const input = document.querySelector('textarea, [contenteditable="true"], [data-testid="message-input"]');
        const inputText = input?.value || input?.textContent || '';
        console.log('📋 Input after template click:', inputText.substring(0, 60) || '(empty)');
        
        // Step 4: Send message
        await this.clickSendButton();
    }

    findTargetTemplate(templates, templateTitle, templateText) {
        for (const template of templates) {
            const title = template.querySelector('span[data-testid="reply-title"]')?.textContent || '';
            const text = template.querySelector('div[data-testid="collapsable-text"]')?.textContent || '';

            if (title.includes(templateTitle) ||
                text.includes(templateText)) {
                return template;
            }
        }
        return null;
    }

    async clickSendButton() {
        const selectors = [
            'button[title="Отправить"]',
            'button[title*="Отправить"]',
            'button[aria-label*="Отправить"]',
            'button[data-testid="send-message"]'
        ];
        
        for (const selector of selectors) {
            const btn = document.querySelector(selector);
            if (btn && !btn.disabled) {
                this.simulateClick(btn);
                return;
            }
        }
        
        // Fallback: press Enter
        const input = document.querySelector('textarea, [contenteditable="true"]');
        if (input) {
            input.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
            }));
        }
    }

    // ===== OBSERVERS =====
    
    setupObserver() {
        const observer = new MutationObserver(() => {
            // Debounce checks
            clearTimeout(this.checkTimeout);
            this.checkTimeout = setTimeout(() => this.checkForAppeals(), 1000);
        });
        
        // Observe sidebar for new appeals
        const observeTarget = () => {
            const sidebar = document.querySelector('#scroll-box-root, .appeals-list, .chat-list');
            if (sidebar) {
                observer.observe(sidebar, { childList: true, subtree: true });
                console.log('👁️ Observing sidebar');
            } else {
                setTimeout(observeTarget, 2000);
            }
        };
        
        observeTarget();
    }

    startPeriodicCheck() {
        setInterval(() => {
            if (!this.autoResponseEnabled) return;
            if (!this.isProcessing) {
                this.checkForAppeals();
            } else {
                // Extra-time checks must run even while processing queue
                this.checkExtraTime();
            }
        }, this.config.checkInterval);
    }

    // ===== NETWORK INTERCEPTOR =====
    
    injectInterceptor() {
        const script = document.createElement('script');
        script.textContent = `
            (function() {
                const originalFetch = window.fetch;
                window.fetch = async function(...args) {
                    const [url] = args;
                    const urlStr = typeof url === 'string' ? url : url?.url || '';

                    // Catch appealId from URL params
                    if (urlStr.includes('appealId=')) {
                        const match = urlStr.match(/appealId=(\\d+)/);
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
        `;
        document.head.appendChild(script);
        script.remove();
        
        window.addEventListener('message', (event) => {
            if (event.data?.type === 'omni-appeal-detected') {
                setTimeout(() => this.checkForAppeals(), 1000);
            }
            if (event.data?.type === 'omni-appeal-mapping') {
                const { appealId, clientName } = event.data;
                if (!this.knownAppealIds.has(clientName)) {
                    this.knownAppealIds.set(clientName, new Set());
                }
                this.knownAppealIds.get(clientName).add(appealId);
                console.log(`🗺️ Mapping: "${clientName}" → appealId ${appealId}`);
            }
        });
    }

    // ===== UTILITIES =====

    chromeSafeSet(data) {
        if (!this.isChromeValid()) return;
        try { chrome.storage.local.set(data); } catch (e) {}
    }

    chromeSafeRemove(keys) {
        if (!this.isChromeValid()) return;
        try { chrome.storage.local.remove(keys); } catch (e) {}
    }

    wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async waitForElement(selector, parent = document, timeout = 5000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const el = typeof selector === 'function' ? selector(parent) : parent.querySelector(selector);
            if (el) return el;
            await this.wait(200);
        }
        return null;
    }

    simulateClick(el) {
        const rect = el.getBoundingClientRect();
        const opts = { bubbles: true, cancelable: true, view: window, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 };
        el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerId: 1 }));
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerId: 1 }));
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        el.dispatchEvent(new MouseEvent('click', opts));
    }

    // ===== PUBLIC API =====
    
    exposeAPI() {
        window.omniResponder = {
            // Status
            getStats: () => ({
                autoEnabled: this.autoResponseEnabled,
                queueLength: this.appealQueue.length,
                processedCount: this.processedAppeals.size,
                isProcessing: this.isProcessing
            }),
            
            // Controls
            toggle: () => {
                this.autoResponseEnabled = !this.autoResponseEnabled;
                this.chromeSafeSet({ autoResponseEnabled: this.autoResponseEnabled });
                console.log('Auto-response:', this.autoResponseEnabled ? 'ON' : 'OFF');
                return this.autoResponseEnabled;
            },

            enable: () => {
                this.autoResponseEnabled = true;
                this.chromeSafeSet({ autoResponseEnabled: true });
                return true;
            },

            disable: () => {
                this.autoResponseEnabled = false;
                this.chromeSafeSet({ autoResponseEnabled: false });
                return false;
            },
            
            // Manual actions
            check: () => {
                this.checkForAppeals();
                return 'Checking for appeals...';
            },
            
            processManual: (appealId) => {
                if (!appealId) return 'Please provide appealId';
                this.addToQueue({ id: appealId, manual: true });
                return 'Added to queue: ' + appealId;
            },
            
            clearQueue: () => {
                this.appealQueue = [];
                this.isProcessing = false;
                return 'Queue cleared';
            },
            
            clearHistory: () => {
                this.processedAppeals.clear();
                this.extraTimeSent.clear();
                this.chromeSafeRemove(['processedAppeals', 'extraTimeSent']);
                return 'History cleared';
            },
            
            // Config
            getConfig: () => this.config,
            
            setConfig: (newConfig) => {
                Object.assign(this.config, newConfig);
                this.chromeSafeSet({ config: this.config });
                return 'Config updated';
            },
            
            // Debug
            findAppeals: () => this.findAppealsInSidebar(),
            
            test: async () => {
                console.log('🧪 Testing template flow...');
                const btn = document.querySelector('button[data-testid="choose-templates"]');
                if (!btn) return 'Template button not found';
                
                btn.click();
                await this.wait(1000);
                
                const templates = document.querySelectorAll('div[data-testid="reply-template"]');
                console.log(`Found ${templates.length} templates`);
                
                return `Modal opened, ${templates.length} templates found`;
            },
            
            help: () => {
                console.log(`
🤖 OmniChat AutoResponder v5.0

STATUS:
  omniResponder.getStats()     - Current status

CONTROLS:
  omniResponder.toggle()       - Toggle auto-response
  omniResponder.enable()       - Enable
  omniResponder.disable()      - Disable

ACTIONS:
  omniResponder.check()        - Check for new appeals
  omniResponder.processManual(id) - Process specific appeal
  omniResponder.clearQueue()   - Clear queue
  omniResponder.clearHistory() - Clear processed history

CONFIG:
  omniResponder.getConfig()    - Get config
  omniResponder.setConfig({})  - Update config

DEBUG:
  omniResponder.findAppeals()  - List detected appeals
  omniResponder.test()         - Test template modal
                `);
            }
        };
        
        console.log('💡 API available: omniResponder.help()');
    }
}

// ===== MESSAGE HANDLER =====

try {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        const responder = window.omniResponderInstance;
        if (!responder) {
            sendResponse({ success: false, error: 'Not initialized' });
            return true;
        }

        switch (request.action) {
            case 'getStats':
                sendResponse({
                    success: true,
                    stats: {
                        autoResponseEnabled: responder.autoResponseEnabled,
                        queueLength: responder.appealQueue.length,
                        processedAppeals: responder.processedAppeals.size,
                        isProcessing: responder.isProcessing,
                        currentUrl: window.location.href
                    }
                });
                break;

            case 'toggleAutoResponse':
                responder.autoResponseEnabled = !responder.autoResponseEnabled;
                responder.chromeSafeSet({ autoResponseEnabled: responder.autoResponseEnabled });
                sendResponse({ success: true, enabled: responder.autoResponseEnabled });
                break;

            case 'checkAppeals':
                responder.checkForAppeals();
                sendResponse({ success: true, count: responder.appealQueue.length });
                break;

            case 'getQueue':
                sendResponse({
                    success: true,
                    queue: responder.appealQueue.map(a => ({
                        appealId: a.id,
                        timestamp: a.addedAt
                    }))
                });
                break;

            case 'clearQueue':
                responder.appealQueue = [];
                responder.isProcessing = false;
                sendResponse({ success: true });
                break;

            case 'clearData':
                responder.appealQueue = [];
                responder.processedAppeals.clear();
                responder.extraTimeSent.clear();
                responder.isProcessing = false;
                responder.chromeSafeRemove(['processedAppeals', 'extraTimeSent']);
                sendResponse({ success: true });
                break;

            case 'processManual':
                if (request.appealId) {
                    responder.addToQueue({ id: request.appealId, manual: true });
                    sendResponse({ success: true });
                } else {
                    sendResponse({ success: false, error: 'No appealId' });
                }
                break;

            case 'updateTemplateConfig':
                Object.assign(responder.config, request.config);
                responder.chromeSafeSet({ config: responder.config });
                sendResponse({ success: true });
                break;

            case 'testAutoResponse':
                responder.checkForAppeals();
                sendResponse({ success: true });
                break;

            default:
                sendResponse({ success: false, error: 'Unknown action' });
        }

        return true;
    });
} catch (e) {
    console.warn('⚠️ Could not register message listener — extension context invalidated');
}

// ===== INITIALIZATION =====

window.omniResponderInstance = new OmniChatAutoResponder();

console.log(`
✅ OmniChat AutoResponder v5.0 loaded
🤖 Auto-response: ${window.omniResponderInstance.autoResponseEnabled ? 'ENABLED' : 'DISABLED'}
💡 Commands: omniResponder.help()
`);
