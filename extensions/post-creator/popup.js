// Configuration
const API_CONFIG = {
    baseUrl: 'https://intranet.example.com/api/v1/forum/posts',
    authUrl: 'https://intranet.example.com/api/v1/auth/verify',
    token: null
};

// Load personal token from storage for popup requests
chrome.storage.sync.get(['personalApiToken'], (result) => {
    if (result && typeof result.personalApiToken === 'string') {
        API_CONFIG.token = result.personalApiToken;
        console.log('Personal API token loaded from storage');
    } else {
        console.log('No personal API token configured - please set up in settings');
    }
});

// Quick templates for different post types
const TEMPLATES = {
    alert: {
        title: '🚨 Alert - ',
        content: 'Hey Team,\n\n🚨 **Alert**: \n\n**What happened**: \n**Severity**: \n**Action needed**: \n\n**Status**: ',
        tags: 'alert, monitoring',
        priority: 'high'
    },
    update: {
        title: '📢 Update - ',
        content: 'Hey Team,\n\n📢 Quick update:\n\n**What changed**: \n**Impact**: \n**Timeline**: \n\n**Next steps**: ',
        tags: 'update, announcement',
        priority: 'normal'
    },
    deployment: {
        title: '🚀 Deployment - ',
        content: 'Hey Team,\n\n🚀 **Deployment complete**:\n\n**Environment**: \n**Version**: \n**Changes**: \n\n**Status**: ✅ Live',
        tags: 'deployment, release',
        priority: 'normal'
    },
    report: {
        title: '📊 Report - ',
        content: 'Hey Team,\n\n📊 **Report summary**:\n\n**Period**: \n**Key metrics**: \n\n**Highlights**: \n\n**Trends**: ',
        tags: 'report, analytics',
        priority: 'low'
    }
};

// DOM elements
let elements = {};

// Initialize the popup
document.addEventListener('DOMContentLoaded', function() {
    initializeElements();
    setupEventListeners();
    loadUserPreferences();
    updateCharacterCounts();
    captureActivePageContext();
});

function initializeElements() {
    elements = {
        form: document.getElementById('postForm'),
        title: document.getElementById('title'),
        content: document.getElementById('content'),
        tags: document.getElementById('tags'),
        priority: document.getElementById('priority'),
        authorName: document.getElementById('authorName'),
        settingsBtn: document.getElementById('settingsBtn'),
        settingsPanel: document.getElementById('settingsPanel'),
        apiToken: document.getElementById('apiToken'),
        saveTokenBtn: document.getElementById('saveTokenBtn'),
        closeSettingsBtn: document.getElementById('closeSettingsBtn'),
        tokenStatus: document.getElementById('tokenStatus'),
        submitBtn: document.getElementById('submitBtn'),
        clearBtn: document.getElementById('clearBtn'),
        status: document.getElementById('status'),
        titleCount: document.getElementById('titleCount'),
        contentCount: document.getElementById('contentCount')
    };
}

// Attempt to pull the active tab's page URL, title, and selected text via content script
function captureActivePageContext() {
    try {
        // Prefer the focused normal window's active tab
        chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }, (windows) => {
            if (chrome.runtime.lastError) return;
            const normalWindows = windows || [];
            const focusedWin = normalWindows.find(w => w.focused) || normalWindows[0];
            const candidateTab = focusedWin && (focusedWin.tabs || []).find(t => t.active && !t.discarded);

            const useTab = candidateTab;
            if (!useTab || !useTab.id) {
                // Fallback to last focused window's active tab
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    const tab = tabs && tabs[0];
                    if (!tab || !tab.id) return;
                    requestPageContext(tab.id);
                });
                return;
            }

            requestPageContext(useTab.id);
        });
    } catch (_) {
        // Ignore failures silently
    }
}

function requestPageContext(tabId) {
    // If the tab is not a standard http(s), skip messaging
    chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) return;
        const isHttp = tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'));
        if (!isHttp) return;

        chrome.tabs.sendMessage(tabId, { action: 'getPageContext' }, (response) => {
            if (chrome.runtime.lastError || !response) return;
            prefillFromPageContext(response);
        });
    });
}

function prefillFromPageContext(pageInfo) {
    const pageTitle = pageInfo && pageInfo.title ? pageInfo.title.trim() : '';
    const pageUrl = pageInfo && pageInfo.url ? pageInfo.url : '';
    const selectedText = pageInfo && pageInfo.selectedText ? pageInfo.selectedText : '';

    // Always prefill with current page context to avoid stale data
    if (pageTitle) {
        elements.title.value = `📝 ${pageTitle}`;
    }

    let newContent = '';
    if (selectedText) {
        newContent += `${selectedText}\n\n`;
    }
    newContent += `Hey Team,\n\nCheck out: [${pageUrl}](${pageUrl})`;
    elements.content.value = newContent.trim();

    updateCharacterCounts();
    saveFormData();
}

function setupEventListeners() {
    // Form submission
    elements.form.addEventListener('submit', handleFormSubmit);
    
    // Clear form
    elements.clearBtn.addEventListener('click', clearForm);
    
    // Character counting
    elements.title.addEventListener('input', updateCharacterCounts);
    elements.content.addEventListener('input', updateCharacterCounts);
    
    // Template buttons
    document.querySelectorAll('.template-btn').forEach(btn => {
        btn.addEventListener('click', () => applyTemplate(btn.dataset.template));
    });
    
    // Settings panel
    elements.settingsBtn.addEventListener('click', showSettings);
    elements.closeSettingsBtn.addEventListener('click', hideSettings);
    elements.saveTokenBtn.addEventListener('click', saveApiToken);
    
    // Auto-save form data
    elements.title.addEventListener('input', debounce(saveFormData, 500));
    elements.content.addEventListener('input', debounce(saveFormData, 500));
    elements.tags.addEventListener('input', debounce(saveFormData, 500));
    elements.priority.addEventListener('change', saveFormData);
    elements.authorName.addEventListener('input', debounce(saveFormData, 500));
}

function loadUserPreferences() {
    chrome.storage.sync.get(['defaultAuthorName', 'savedFormData'], function(result) {
        if (result.defaultAuthorName) {
            elements.authorName.value = result.defaultAuthorName;
        }
        
        if (result.savedFormData) {
            const data = result.savedFormData;
            elements.title.value = data.title || '';
            elements.content.value = data.content || '';
            elements.tags.value = data.tags || '';
            elements.priority.value = data.priority || 'normal';
            elements.authorName.value = data.authorName || '';
            updateCharacterCounts();
        }
    });
}

function saveFormData() {
    const formData = {
        title: elements.title.value,
        content: elements.content.value,
        tags: elements.tags.value,
        priority: elements.priority.value,
        authorName: elements.authorName.value
    };
    
    chrome.storage.sync.set({ savedFormData: formData });
    
    // Save default author name if provided
    if (elements.authorName.value.trim()) {
        chrome.storage.sync.set({ defaultAuthorName: elements.authorName.value.trim() });
    }
}

function updateCharacterCounts() {
    const suffixLength = 140;
    const maxContentLength = 10000 - suffixLength;
    
    elements.titleCount.textContent = `${elements.title.value.length}/200`;
    elements.contentCount.textContent = `${elements.content.value.length}/${maxContentLength.toLocaleString()}`;
    
    // Update character count colors
    elements.titleCount.style.color = elements.title.value.length > 180 ? '#e74c3c' : '#999';
    elements.contentCount.style.color = elements.content.value.length > (maxContentLength - 1000) ? '#e74c3c' : '#999';
}

function applyTemplate(templateType) {
    const template = TEMPLATES[templateType];
    if (!template) return;
    
    elements.title.value = template.title;
    elements.content.value = template.content;
    elements.tags.value = template.tags;
    elements.priority.value = template.priority;
    
    updateCharacterCounts();
    saveFormData();
    
    // Focus on title for easy editing
    elements.title.focus();
    elements.title.setSelectionRange(template.title.length, template.title.length);
}

function clearForm() {
    elements.form.reset();
    updateCharacterCounts();
    chrome.storage.sync.remove('savedFormData');
    hideStatus();
}

async function handleFormSubmit(event) {
    event.preventDefault();
    
    if (!validateForm()) {
        return;
    }
    
    setLoadingState(true);
    hideStatus();
    
    try {
        const postData = preparePostData();
        const response = await createPost(postData);
        
        if (response.success) {
            showStatus('Post created successfully!', 'success');
            clearForm();
            
            // Open the created post in a new tab
            if (response.data && response.data.url) {
                chrome.tabs.create({ url: response.data.url });
            }
        } else {
            showStatus(`Error: ${response.message || 'Failed to create post'}`, 'error');
        }
    } catch (error) {
        console.error('Error creating post:', error);
        showStatus(`Error: ${error.message || 'Failed to create post'}`, 'error');
    } finally {
        setLoadingState(false);
    }
}

function validateForm() {
    const title = elements.title.value.trim();
    const content = elements.content.value.trim();
    
    // Account for suffix length when validating (approximately 140 characters)
    const suffixLength = 140;
    const maxContentLength = 10000 - suffixLength;
    
    if (title.length < 5) {
        showStatus('Title must be at least 5 characters long', 'error');
        elements.title.focus();
        return false;
    }
    
    if (title.length > 200) {
        showStatus('Title must be 200 characters or less', 'error');
        elements.title.focus();
        return false;
    }
    
    if (content.length < 10) {
        showStatus('Content must be at least 10 characters long', 'error');
        elements.content.focus();
        return false;
    }
    
    if (content.length > maxContentLength) {
        showStatus(`Content must be ${maxContentLength.toLocaleString()} characters or less (accounting for post signature)`, 'error');
        elements.content.focus();
        return false;
    }
    
    return true;
}

function preparePostData() {
    const tags = elements.tags.value.trim()
        .split(',')
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0);
    
    // Add post-creator signature to content
    const originalContent = elements.content.value.trim();
    const contentWithSuffix = originalContent + '\n\n---\nPosted with the [Owtranet Post Creator](https://github.com/edmiidz/Owtranet/tree/main/extensions/post-creator).';
    
    return {
        title: elements.title.value.trim(),
        content: contentWithSuffix,
        tags: tags,
        author_name: elements.authorName.value.trim() || undefined,
        priority: elements.priority.value
    };
}

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

function setLoadingState(loading) {
    const btn = elements.submitBtn;
    if (loading) {
        btn.classList.add('loading');
        btn.disabled = true;
    } else {
        btn.classList.remove('loading');
        btn.disabled = false;
    }
}

function showStatus(message, type = 'info') {
    elements.status.textContent = message;
    elements.status.className = `status ${type}`;
    elements.status.style.display = 'block';
    
    // Auto-hide success messages after 5 seconds
    if (type === 'success') {
        setTimeout(hideStatus, 5000);
    }
}

function hideStatus() {
    elements.status.style.display = 'none';
}

// Utility function for debouncing
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Settings panel functions
function showSettings() {
    elements.settingsPanel.style.display = 'block';
    // Load current token (masked)
    chrome.storage.sync.get(['personalApiToken'], (result) => {
        if (result.personalApiToken) {
            elements.apiToken.value = '••••••••••••••••••••••••••••••••';
            elements.apiToken.dataset.hasToken = 'true';
        } else {
            elements.apiToken.value = '';
            elements.apiToken.dataset.hasToken = 'false';
        }
    });
}

function hideSettings() {
    elements.settingsPanel.style.display = 'none';
    elements.tokenStatus.style.display = 'none';
}

function saveApiToken() {
    const tokenValue = elements.apiToken.value.trim();
    
    if (!tokenValue || tokenValue === '••••••••••••••••••••••••••••••••') {
        showTokenStatus('Please enter a valid API token', 'error');
        return;
    }
    
    // Test the token by calling the verify endpoint
    fetch(API_CONFIG.authUrl, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${tokenValue}`,
            'Content-Type': 'application/json'
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.valid) {
            // Save to storage
            chrome.storage.sync.set({ 'personalApiToken': tokenValue }, () => {
                API_CONFIG.token = tokenValue;
                showTokenStatus(`Token saved! Authenticated as: ${data.user.name} (@${data.user.username})`, 'success');
                setTimeout(hideSettings, 2000);
            });
        } else {
            showTokenStatus('Invalid API token. Please check your token and try again.', 'error');
        }
    })
    .catch(error => {
        console.error('Token verification failed:', error);
        showTokenStatus('Failed to verify token. Please check your connection.', 'error');
    });
}

function showTokenStatus(message, type) {
    elements.tokenStatus.textContent = message;
    elements.tokenStatus.className = `status ${type}`;
    elements.tokenStatus.style.display = 'block';
    
    if (type === 'success') {
        setTimeout(() => {
            elements.tokenStatus.style.display = 'none';
        }, 3000);
    }
}
