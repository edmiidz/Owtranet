// Background service worker for Intranet Post Creator

// Configuration
const API_CONFIG = {
    baseUrl: 'https://intranet.example.com/api/v1/forum/posts',
    authUrl: 'https://intranet.example.com/api/v1/auth/verify',
    token: null // No default token - users must configure their personal token
};

// Load personal token from storage on startup
chrome.storage.sync.get(['personalApiToken'], (result) => {
    if (result && typeof result.personalApiToken === 'string') {
        API_CONFIG.token = result.personalApiToken;
        console.log('Personal API token loaded from storage');
    } else {
        console.log('No personal API token configured - user needs to set up token in settings');
    }
});

// Install event - set up extension
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        // First time installation
        console.log('Intranet Post Creator installed');
        
        // Set default settings
        chrome.storage.sync.set({
            defaultAuthorName: '',
            notificationsEnabled: true,
            autoOpenPosts: true
        });
        
        // Show welcome notification
        // Optional notification (disabled until icons are present)
        // chrome.notifications.create({
        //     type: 'basic',
        //     iconUrl: 'icons/icon128.png',
        //     title: 'Welcome to Intranet Post Creator!',
        //     message: 'Click the extension icon to start creating posts for your team.'
        // });
    }
});

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Ensure sendResponse gets called even if we throw; set a watchdog
    let responded = false;
    const watchdog = setTimeout(() => {
        if (!responded) {
            try { sendResponse({ success: false, error: 'Background handler timeout' }); } catch (_) {}
        }
    }, 12000);

    switch (request.action) {
        case 'createPost':
            handleCreatePost(request.data, (msg) => { responded = true; clearTimeout(watchdog); sendResponse(msg); });
            return true; // Keep message channel open for async response
            
        case 'getUserInfo':
            handleGetUserInfo((msg) => { responded = true; clearTimeout(watchdog); sendResponse(msg); });
            return true;
            
        case 'testConnection':
            handleTestConnection((msg) => { responded = true; clearTimeout(watchdog); sendResponse(msg); });
            return true;
            
        default:
            responded = true; clearTimeout(watchdog); sendResponse({ success: false, error: 'Unknown action' });
    }
});

// Handle post creation from background context
async function handleCreatePost(postData, sendResponse) {
    try {
        const response = await createPost(postData);
        sendResponse(response);
    } catch (error) {
        console.error('Background post creation error:', error);
        sendResponse({
            success: false,
            error: error.message || 'Failed to create post'
        });
    }
}

// Handle user info request
function handleGetUserInfo(sendResponse) {
    chrome.storage.sync.get(['defaultAuthorName'], (result) => {
        sendResponse({
            success: true,
            data: {
                defaultAuthorName: result.defaultAuthorName || '',
                extensionVersion: chrome.runtime.getManifest().version
            }
        });
    });
}

// Utility: fetch with timeout via AbortController
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        return response;
    } finally {
        clearTimeout(timer);
    }
}

// Handle connection test
async function handleTestConnection(sendResponse) {
    // Try a lightweight probe without custom headers first to avoid preflight
    try {
        const probeResponse = await fetchWithTimeout(API_CONFIG.baseUrl, { method: 'GET' }, 8000);
        const text = await probeResponse.text().catch(() => '');
        if (probeResponse.ok) {
            sendResponse({ success: true, message: 'Connection successful (no auth)', status: probeResponse.status, response: text.slice(0, 5000) });
            return;
        } else {
            sendResponse({ success: true, message: `Reachable (no auth), HTTP ${probeResponse.status}: ${probeResponse.statusText}`, status: probeResponse.status, response: text.slice(0, 5000) });
            return;
        }
    } catch (probeError) {
        // Fall back to authenticated request in case server requires header to respond
        try {
            const authResponse = await fetchWithTimeout(API_CONFIG.baseUrl, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${API_CONFIG.token}` }
            }, 8000);
            const text = await authResponse.text().catch(() => '');
            if (authResponse.ok) {
                sendResponse({ success: true, message: 'Connection successful (with auth header)', status: authResponse.status, response: text.slice(0, 5000) });
            } else {
                sendResponse({ success: true, message: `Reachable (with auth), HTTP ${authResponse.status}: ${authResponse.statusText}`, status: authResponse.status, response: text.slice(0, 5000) });
            }
        } catch (authError) {
            const reason = (probeError && probeError.name === 'AbortError') || (authError && authError.name === 'AbortError') ? 'Timeout' : 'Network error';
            sendResponse({ success: false, error: `${reason}: ${(authError && authError.message) || (probeError && probeError.message) || 'unknown'}` });
        }
    }
}

// Create post via API
async function createPost(postData) {
    if (!API_CONFIG.token) {
        throw new Error('No API token configured. Please set up your personal API token in extension settings.');
    }

    const response = await fetch(API_CONFIG.baseUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_CONFIG.token}`
        },
        body: JSON.stringify(postData)
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 401) {
            throw new Error('Invalid API token. Please check your personal API token in extension settings.');
        }
        throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    return await response.json();
}

// Context menu integration (optional)
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: 'createIntranetPost',
        title: 'Create Intranet Post',
        contexts: ['selection', 'page']
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'createIntranetPost') {
        // Open popup with selected text as content
        if (info.selectionText) {
            chrome.storage.sync.set({
                quickPostData: {
                    content: info.selectionText,
                    sourceUrl: tab.url,
                    sourceTitle: tab.title
                }
            });
        }
        
        // Open popup
        chrome.action.openPopup();
    }
});

// Handle keyboard shortcuts
chrome.commands.onCommand.addListener((command) => {
    if (command === 'create-post') {
        chrome.action.openPopup();
    }
});

// Periodic health check removed - can cause service worker issues

// Handle extension updates
chrome.runtime.onUpdateAvailable.addListener(() => {
    chrome.runtime.reload();
});
