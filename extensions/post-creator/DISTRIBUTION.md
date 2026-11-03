# 📦 Distribution Guide for Team Admins

## 🎯 Distribution Methods

### Method 1: ZIP File Distribution (Recommended)
**Pros:** Simple, no external dependencies, works everywhere
**Cons:** Manual updates needed

1. **Create ZIP file:**
   ```bash
   cd extensions
   zip -r owtranet-extension.zip post-creator/ -x "*.DS_Store" "*.git*"
   ```

2. **Distribute via:**
   - Team Slack/Discord
   - Email attachment
   - Shared Google Drive/Dropbox
   - Internal file server
   - Company wiki/intranet

3. **Include:** 
   - `owtranet-extension.zip`
   - `README-TEAM.md` (installation guide)

### Method 2: Git Repository (For Technical Teams)
**Pros:** Easy updates, version control
**Cons:** Requires git knowledge

1. **Create a simple repo:**
   ```bash
   git clone [your-repo-url]
   cd owtranet-extension
   # Users run: git pull
   ```

2. **Share repo URL** with installation instructions

### Method 3: Internal Web Server
**Pros:** Always up-to-date, one-click download
**Cons:** Requires web server setup

1. **Host on intranet server**
2. **Provide download link** 
3. **Auto-update** ZIP file when changes are made

## 🔧 Creating the Distribution Package

Run this to create a clean distribution:

```bash
# Clean build
cd extensions
rm -rf dist/
mkdir dist/
cp -r post-creator/ dist/owtranet-extension/
cd dist/
zip -r owtranet-extension.zip owtranet-extension/ -x "*.DS_Store" "*.git*"
```

## 📋 Team Rollout Checklist

### Before Distribution:
- [ ] Test extension on fresh Chrome profile  
- [ ] Verify API endpoints are accessible from team network
- [ ] Test personal API token generation for team members
- [ ] Create team installation guide
- [ ] Set up support channel (Slack, email, etc.)

### Distribution Message Template:

```
🚀 **New Team Tool: Intranet Post Creator**

Create intranet posts directly from Chrome while browsing any webpage!

**What it does:**
- Instantly create posts from any webpage with one click
- Posts appear under your personal account (not admin)
- Smart templates for alerts, updates, deployments
- Pre-fills content from current page

**Installation:** 5 minutes
Download: [attach owtranet-extension.zip]
Guide: [attach README-TEAM.md]

**Questions?** Contact your intranet admin or ask in #team-tools

Happy posting! 🎉
```

### After Distribution:
- [ ] Monitor for installation issues
- [ ] Help team members with API token setup
- [ ] Gather feedback for improvements
- [ ] Plan update distribution process

## 🔄 Handling Updates

### For ZIP Distribution:
1. **Update extension files**
2. **Update version** in `manifest.json`
3. **Create new ZIP file**
4. **Notify team** to re-download and reload extension

### Update Notification Template:
```
📦 **Extension Update Available**

New features in v1.0.3:
- Improved post formatting
- Bug fixes for token handling

**To update:**
1. Download new owtranet-extension.zip
2. Extract and replace old folder
3. Go to chrome://extensions/ and click refresh icon

Takes 2 minutes! 
```

## 🛠️ Advanced: Auto-Update Setup

For teams that want automatic updates, you can set up:

1. **Extension update manifest** (requires hosted JSON file)
2. **Internal extension store** (more complex setup)
3. **Browser policy deployment** (enterprise Chrome management)

## 📊 Usage Analytics

Track adoption by monitoring:
- API token generation in user profiles
- Post creation via extension API endpoints  
- User feedback in team channels

## 🆘 Support Strategy

Set up support workflow:
1. **Documentation** - README-TEAM.md covers 90% of issues
2. **Team channel** - #owtranet-extension or similar
3. **Direct contact** - Technical lead for complex issues
4. **FAQ document** - Build from common questions

Most common support requests:
- API token setup confusion
- Extension loading issues
- Chrome developer mode questions