// Content script for Intranet Post Creator
// This script runs on web pages and provides context-aware functionality

// Configuration
const EXTENSION_CONFIG = {
    name: 'Intranet Post Creator',
    version: '1.0.0'
};

// Initialize content script
(function() {
    'use strict';
    
    console.log(`${EXTENSION_CONFIG.name} v${EXTENSION_CONFIG.version} loaded`);
    
    // Set up message listener for communication with popup
    setupMessageListener();
    
    // Add page context detection
    detectPageContext();
    
    // Floating action button disabled - use pinned extension instead
    // addFloatingActionButton();
    
})();

function setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        switch (request.action) {
            case 'getPageContext':
                sendResponse(getPageContext());
                break;
                
            case 'getSelectedText':
                sendResponse(getSelectedText());
                break;
                
            case 'createQuickPost':
                handleQuickPost(request.data, sendResponse);
                return true; // Keep message channel open
                
            default:
                // Ignore unknown messages
                break;
        }
    });
}

function detectPageContext() {
    // Detect if we're on a monitoring dashboard, CI/CD platform, etc.
    const url = window.location.href;
    const title = document.title;
    
    let context = {
        type: 'general',
        platform: 'unknown',
        hasMetrics: false,
        hasAlerts: false
    };
    
    // Detect monitoring platforms
    if (url.includes('newrelic.com') || title.includes('New Relic')) {
        context.type = 'monitoring';
        context.platform = 'newrelic';
        context.hasMetrics = true;
        context.hasAlerts = true;
    } else if (url.includes('datadoghq.com') || title.includes('Datadog')) {
        context.type = 'monitoring';
        context.platform = 'datadog';
        context.hasMetrics = true;
        context.hasAlerts = true;
    } else if (url.includes('grafana.com') || title.includes('Grafana')) {
        context.type = 'monitoring';
        context.platform = 'grafana';
        context.hasMetrics = true;
        context.hasAlerts = true;
    }
    
    // Detect CI/CD platforms
    if (url.includes('jenkins') || title.includes('Jenkins')) {
        context.type = 'cicd';
        context.platform = 'jenkins';
    } else if (url.includes('github.com') && url.includes('actions')) {
        context.type = 'cicd';
        context.platform = 'github-actions';
    } else if (url.includes('gitlab.com') && url.includes('pipelines')) {
        context.type = 'cicd';
        context.platform = 'gitlab';
    }
    
    // Store context for popup access
    window.owtranetExtensionContext = context;
    
    // Add context indicator to page
    addContextIndicator(context);
}

function addContextIndicator(context) {
    if (context.type === 'monitoring' || context.type === 'cicd') {
        const indicator = document.createElement('div');
        indicator.id = 'owtranet-context-indicator';
        indicator.innerHTML = `
            <div style="
                position: fixed;
                top: 20px;
                right: 20px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 8px 12px;
                border-radius: 20px;
                font-size: 12px;
                font-weight: 500;
                z-index: 10000;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                cursor: pointer;
                transition: all 0.3s ease;
            " title="Click to create intranet post about this ${context.type}">
                🚀 Post to Intranet
            </div>
        `;
        
        indicator.addEventListener('click', () => {
            chrome.runtime.sendMessage({ action: 'openPopup' });
        });
        
        document.body.appendChild(indicator);
    }
}

function addFloatingActionButton() {
    // Add a floating action button for quick access
    const fab = document.createElement('div');
    fab.id = 'owtranet-fab';
    fab.innerHTML = `
        <div style="
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 56px;
            height: 56px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 24px;
            cursor: pointer;
            z-index: 10000;
            box-shadow: 0 4px 20px rgba(0,0,0,0.2);
            transition: all 0.3s ease;
            opacity: 0.8;
        " title="Create Intranet Post" id="owtranet-fab-button">
            📝
        </div>
    `;
    
    fab.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'openPopup' });
    });
    
    // Show/hide on scroll
    let lastScrollTop = 0;
    window.addEventListener('scroll', () => {
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const fabButton = document.getElementById('owtranet-fab-button');
        
        if (fabButton) {
            if (scrollTop > lastScrollTop && scrollTop > 100) {
                // Scrolling down, hide FAB
                fabButton.style.transform = 'translateY(100px)';
                fabButton.style.opacity = '0';
            } else {
                // Scrolling up or at top, show FAB
                fabButton.style.transform = 'translateY(0)';
                fabButton.style.opacity = '0.8';
            }
        }
        
        lastScrollTop = scrollTop;
    });
    
    document.body.appendChild(fab);
}

function getPageContext() {
    const context = window.owtranetExtensionContext || { type: 'general', platform: 'unknown' };
    
    return {
        url: window.location.href,
        title: document.title,
        context: context,
        selectedText: getSelectedText(),
        timestamp: new Date().toISOString()
    };
}

function getSelectedText() {
    const selection = window.getSelection();
    return selection ? selection.toString().trim() : '';
}

function handleQuickPost(data, sendResponse) {
    try {
        // Extract relevant information from the current page
        const pageInfo = getPageContext();
        
        // Create a quick post based on page context
        const quickPost = createQuickPostFromContext(pageInfo, data);
        
        // Send the quick post data back
        sendResponse({
            success: true,
            data: quickPost
        });
        
    } catch (error) {
        console.error('Error creating quick post:', error);
        sendResponse({
            success: false,
            error: error.message
        });
    }
}

function createQuickPostFromContext(pageInfo, userData) {
    const context = pageInfo.context;
    let title = '';
    let content = '';
    let tags = [];
    let priority = 'normal';
    
    if (context.type === 'monitoring') {
        // Create monitoring alert post
        title = `📊 ${context.platform.charAt(0).toUpperCase() + context.platform.slice(1)} Alert - ${pageInfo.title}`;
        content = `Hey Team,\n\n🚨 **Alert from ${context.platform}**\n\n${userData.content || 'Alert detected'}\n\nCheck it out: [${pageInfo.url}](${pageInfo.url})`;
        tags = ['monitoring', context.platform, 'alert'];
        priority = 'high';
        
    } else if (context.type === 'cicd') {
        // Create CI/CD update post
        title = `🚀 ${context.platform.charAt(0).toUpperCase() + context.platform.slice(1)} Update - ${pageInfo.title}`;
        content = `Hey Team,\n\n🚀 **Update from ${context.platform}**\n\n${userData.content || 'Update detected'}\n\nCheck it out: [${pageInfo.url}](${pageInfo.url})`;
        tags = ['cicd', context.platform, 'update'];
        priority = 'normal';
        
    } else {
        // Create general post
        title = `📝 ${pageInfo.title}`;
        content = `Hey Team,\n\n${userData.content || ''}\n\nCheck out: [${pageInfo.url}](${pageInfo.url})`;
        tags = ['update', 'general'];
        priority = 'low';
    }
    
    return {
        title: title,
        content: content,
        tags: tags,
        priority: priority,
        author_name: userData.authorName || undefined
    };
}

// Clean up when page unloads
window.addEventListener('beforeunload', () => {
    // Remove any added elements
    const elements = [
        document.getElementById('owtranet-context-indicator'),
        document.getElementById('owtranet-fab')
    ];
    
    elements.forEach(element => {
        if (element && element.parentNode) {
            element.parentNode.removeChild(element);
        }
    });
});
