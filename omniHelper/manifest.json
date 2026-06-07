{
  "manifest_version": 3,
  "name": "OmniChat AutoResponder",
  "version": "5.0.0",
  "description": "Автоматический ответ на обращения в OmniChat",
  "permissions": [
    "activeTab",
    "storage",
    "tabs"
  ],
  "host_permissions": [
    "*://omnichat.rt.ru/*",
    "*://*.omnichat.rt.ru/*"
  ],
  "action": {
    "default_popup": "popup.html",
    "default_title": "OmniChat AutoResponder",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": [
        "*://omnichat.rt.ru/*",
        "*://*.omnichat.rt.ru/*"
      ],
      "js": ["content.js"],
      "run_at": "document_idle",
      "all_frames": false
    }
  ],
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
