@echo off
REM Intranet Post Creator Extension - Windows Install Helper

title Intranet Post Creator - Installation Helper

echo.
echo 🚀 Intranet Post Creator - Installation Helper
echo ==================================================
echo.

REM Check if manifest.json exists
if not exist "manifest.json" (
    echo ❌ manifest.json not found!
    echo.
    echo Please make sure you:
    echo 1. Downloaded the owtranet-extension.zip file
    echo 2. Extracted it completely
    echo 3. Navigate to the extracted folder
    echo 4. Run this script from inside the folder
    echo.
    echo The folder should contain:
    echo - manifest.json
    echo - popup.html  
    echo - background.js
    echo - Other extension files
    echo.
    pause
    exit /b 1
)

echo ✅ Found manifest.json - ready for installation!
echo.
echo 📁 Current directory: %CD%
echo.

REM Ask user if they want to open Chrome extensions
set /p choice="🌐 Open Chrome Extensions page now? (y/n): "
if /i "%choice%"=="y" (
    echo 📂 Opening Chrome Extensions page...
    start chrome.exe chrome://extensions/
    echo ⏱️  Waiting 3 seconds for Chrome to load...
    timeout /t 3 /nobreak >nul
)

echo.
echo 📋 Next steps in Chrome:
echo ========================
echo 1. ✅ Toggle 'Developer Mode' ON (top-right corner)
echo 2. ✅ Click 'Load unpacked' button
echo 3. ✅ Select this folder: %CD%
echo 4. ✅ Click 'Select Folder'
echo 5. ✅ Pin the extension (puzzle piece icon)
echo.
echo 🔐 After installation:
echo ======================
echo 1. Click the extension icon
echo 2. Click '⚙️ Settings'
echo 3. Get your API token from: https://intranet.example.com/profile
echo 4. Paste token and click 'Verify & Save Token'
echo.
echo 🎉 You're done! Start creating posts!
echo.
echo 📞 Need help? Contact your intranet admin or check README-TEAM.md
echo.
pause