#!/bin/bash

# Intranet Post Creator Extension - Quick Install Script
# This script helps with the installation process

echo "🚀 Intranet Post Creator - Installation Helper"
echo "=================================================="

# Check if running on macOS/Linux
if [[ "$OSTYPE" == "darwin"* ]] || [[ "$OSTYPE" == "linux"* ]]; then
    echo "✅ Running on compatible system"
else
    echo "⚠️  This script is for macOS/Linux. Windows users should follow the manual steps."
    exit 1
fi

# Function to open Chrome extensions page
open_chrome_extensions() {
    echo ""
    echo "📂 Opening Chrome Extensions page..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        open -a "Google Chrome" "chrome://extensions/"
    else
        # Linux
        google-chrome "chrome://extensions/" 2>/dev/null || chromium-browser "chrome://extensions/" 2>/dev/null || echo "Please open Chrome and go to chrome://extensions/"
    fi
}

# Function to show installation steps
show_steps() {
    echo ""
    echo "📋 Next steps in Chrome:"
    echo "========================"
    echo "1. ✅ Toggle 'Developer Mode' ON (top-right corner)"
    echo "2. ✅ Click 'Load unpacked' button"  
    echo "3. ✅ Select this folder: $(pwd)"
    echo "4. ✅ Click 'Select Folder'"
    echo "5. ✅ Pin the extension (puzzle piece icon)"
    echo ""
    echo "🔐 After installation:"
    echo "======================"
    echo "1. Click the extension icon"
    echo "2. Click '⚙️ Settings'"
    echo "3. Get your API token from: https://intranet.example.com/profile"
    echo "4. Paste token and click 'Verify & Save Token'"
    echo ""
    echo "🎉 You're done! Start creating posts!"
}

# Main installation process
echo ""
echo "📁 Current directory: $(pwd)"
echo ""

# Check if manifest.json exists
if [[ -f "manifest.json" ]]; then
    echo "✅ Found manifest.json - ready for installation!"
    
    # Ask user if they want to open Chrome extensions
    echo ""
    read -p "🌐 Open Chrome Extensions page now? (y/n): " -n 1 -r
    echo ""
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        open_chrome_extensions
        echo "⏱️  Waiting 3 seconds for Chrome to load..."
        sleep 3
    fi
    
    show_steps
    
else
    echo "❌ manifest.json not found!"
    echo ""
    echo "Please make sure you:"
    echo "1. Downloaded the owtranet-extension.zip file"
    echo "2. Extracted it completely"  
    echo "3. Navigate to the extracted folder"
    echo "4. Run this script from inside the folder"
    echo ""
    echo "The folder should contain:"
    echo "- manifest.json"
    echo "- popup.html"
    echo "- background.js"
    echo "- Other extension files"
    exit 1
fi

echo ""
echo "📞 Need help? Contact your intranet admin or check README-TEAM.md"
echo ""