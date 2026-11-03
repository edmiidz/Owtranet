// Configuration file for Intranet Post Creator Chrome Extension
// Modify these settings as needed for your environment

const CONFIG = {
    // API Configuration
    API: {
        baseUrl: 'https://intranet.example.com/api/v1/forum/posts',
        // No token here: each user pastes their own personal API token in the popup's settings panel.
        timeout: 30000, // 30 seconds
        retryAttempts: 3
    },
    
    // Extension Settings
    EXTENSION: {
        name: 'Intranet Post Creator',
        version: '1.0.0',
        autoSaveInterval: 500, // milliseconds
        maxTitleLength: 200,
        minTitleLength: 5,
        maxContentLength: 10000,
        minContentLength: 10
    },
    
    // UI Settings
    UI: {
        popupWidth: 400,
        popupHeight: 600,
        showCharacterCount: true,
        showTemplates: true,
        showPrioritySelector: true,
        showAuthorField: true
    },
    
    // Templates Configuration
    TEMPLATES: {
        enabled: true,
        defaultPriority: 'normal',
        includeSourceInfo: true,
        addExtensionSignature: true
    },
    
    // Context Detection
    CONTEXT: {
        enabled: true,
        platforms: {
            monitoring: [
                'newrelic.com',
                'datadoghq.com',
                'grafana.com',
                'prometheus.io',
                'pingdom.com'
            ],
            cicd: [
                'jenkins',
                'github.com/actions',
                'gitlab.com/pipelines',
                'circleci.com',
                'azure.com/devops'
            ]
        },
        showIndicator: true,
        showFloatingButton: true
    },
    
    // Storage Settings
    STORAGE: {
        syncUserPreferences: true,
        saveFormData: true,
        maxSavedForms: 10,
        clearOnSubmit: true
    },
    
    // Notifications
    NOTIFICATIONS: {
        enabled: true,
        showSuccess: true,
        showErrors: true,
        autoHideSuccess: 5000, // 5 seconds
        soundEnabled: false
    },
    
    // Development
    DEVELOPMENT: {
        debugMode: false,
        logLevel: 'info', // 'debug', 'info', 'warn', 'error'
        enableConsoleLogging: true,
        mockAPI: false
    }
};

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
} else if (typeof window !== 'undefined') {
    window.OWTRANET_CONFIG = CONFIG;
}
