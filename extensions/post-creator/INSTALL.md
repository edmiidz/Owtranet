# 📥 Installation Guide - Owtranet Post Creator

Follow these steps to install and set up the Chrome extension on your browser.

## 🚀 Quick Installation

### Step 1: Download the Extension
1. **Download** this repository to your computer
2. **Extract** the ZIP file to a folder (remember this location)

### Step 2: Open Chrome Extensions
1. **Open Google Chrome**
2. **Navigate to**: `chrome://extensions/`
3. **Enable Developer Mode** (toggle switch in top right corner)

### Step 3: Load the Extension
1. **Click "Load unpacked"** button
2. **Select the folder** containing the extension files
3. **Click "Select Folder"**

### Step 4: Pin the Extension
1. **Click the puzzle piece icon** in Chrome toolbar
2. **Find "Intranet Post Creator"**
3. **Click the pin icon** to keep it visible

## ✅ Verification

After installation, you should see:
- ✅ Extension icon in your Chrome toolbar
- ✅ Extension listed in `chrome://extensions/`
- ✅ No error messages in the extension details

## 🔧 First-Time Setup

### 1. Set Up Your Personal API Token (Required)
Posts will be created under your personal account instead of as admin:

1. **Click** the extension icon
2. **Click "⚙️ Settings"** button
3. **Follow the instructions** to get your personal API token:
   - Go to https://intranet.example.com/profile
   - Scroll to "API Token" section
   - Click "Generate New API Token"  
   - Copy the generated token
4. **Paste your token** into the extension settings
5. **Click "Verify & Save Token"**

### 2. Set Your Default Author Name (Optional)
1. **Enter your name** in the "Author Name" field when creating posts
2. **Your name will be auto-saved** for future posts

## 🧪 Testing the Installation

### Test Basic Functionality
1. **Click** the extension icon
2. **Fill out** a test post form
3. **Submit** the post
4. **Verify** it appears on your intranet

### Test Context Detection
1. **Visit** a monitoring dashboard (New Relic, Datadog, etc.)
2. **Look for** the context indicator (top right)
3. **Click it** to create a context-aware post

## 🚨 Troubleshooting

### Extension Won't Load
- **Check file structure** - ensure all files are in the same folder
- **Verify manifest.json** - should be in the root folder
- **Check Chrome version** - requires Chrome 88+

### API Connection Issues
- **Verify your personal API token** is correct in extension settings
- **Check network access** to `intranet.example.com`
- **Re-generate your API token** if it's not working
- **Ensure you're using your personal token**, not the old admin token

### Extension Not Working
- **Reload extension** in `chrome://extensions/`
- **Check console errors** by right-clicking extension icon → "Inspect popup"
- **Clear browser cache** and cookies

### Permission Issues
- **Check permissions** in `chrome://extensions/`
- **Ensure host permissions** include `https://intranet.example.com/*`
- **Grant storage permissions** if prompted

## 🔄 Updating the Extension

### Manual Update
1. **Download** the latest version
2. **Replace** the old files
3. **Reload** the extension in `chrome://extensions/`

### Automatic Updates
The extension will automatically check for updates and reload when available.

## 📱 Browser Compatibility

- ✅ **Chrome**: 88+ (recommended)
- ✅ **Edge**: 88+ (Chromium-based)
- ⚠️ **Firefox**: Not supported (different extension system)
- ⚠️ **Safari**: Not supported (different extension system)

## 🆘 Need Help?

If you encounter issues:

1. **Check the console** for error messages
2. **Verify your API token** is correct
3. **Test the API endpoint** directly
4. **Contact your admin team** for API issues
5. **Check the README.md** for detailed documentation

---

**🎉 Installation Complete!**

You're now ready to create intranet posts directly from your browser. Click the extension icon to get started!
