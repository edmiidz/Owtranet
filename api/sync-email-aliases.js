const { exec } = require('child_process');
const path = require('path');

/**
 * Sync email aliases from database to Postfix configuration
 * Call this function when groups are created, updated, or members change
 */
function syncEmailAliases(callback) {
    const scriptPath = path.join(__dirname, '../scripts/sync-email-aliases.sh');

    exec(scriptPath, (error, stdout, stderr) => {
        if (error) {
            console.error('Error syncing email aliases:', error);
            if (callback) callback(error);
            return;
        }

        console.log('Email aliases sync output:', stdout);
        if (stderr) {
            console.error('Email aliases sync stderr:', stderr);
        }

        if (callback) callback(null, stdout);
    });
}

/**
 * Express route handler for manual sync via API
 */
function syncEmailAliasesRoute(req, res) {
    // You might want to add authentication here

    syncEmailAliases((error, output) => {
        if (error) {
            return res.status(500).json({
                success: false,
                message: 'Failed to sync email aliases',
                error: error.message
            });
        }

        res.json({
            success: true,
            message: 'Email aliases synced successfully',
            output: output
        });
    });
}

module.exports = {
    syncEmailAliases,
    syncEmailAliasesRoute
};

// Example usage in your group management code:
//
// After creating/updating a group:
// const { syncEmailAliases } = require('./api/sync-email-aliases');
// syncEmailAliases();
//
// Or add to your Express routes:
// const { syncEmailAliasesRoute } = require('./api/sync-email-aliases');
// app.post('/api/admin/sync-email-aliases', requireAdmin, syncEmailAliasesRoute);