#!/bin/bash

# Sync email aliases from intranet database to Postfix
# This script reads group email aliases from the database and updates Postfix virtual aliases

# Configuration
DB_NAME="${DB_NAME:-owtranet}"
VIRTUAL_FILE="/etc/postfix/virtual"
BACKUP_DIR="/etc/postfix/backups"
MYSQL_CMD="mysql -N -B"

# Create backup directory if it doesn't exist
sudo mkdir -p "$BACKUP_DIR"

# Backup current virtual file
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
sudo cp "$VIRTUAL_FILE" "$BACKUP_DIR/virtual.backup.$TIMESTAMP"

# Create temporary file for new virtual aliases
TEMP_FILE="/tmp/virtual_aliases_new.$$"

# Copy existing content up to auto-generated section (preserve manual entries)
# If auto-generated section exists, keep everything before it
if sudo grep -q "^# AUTO-GENERATED GROUP ALIASES" "$VIRTUAL_FILE"; then
    sudo sed '/^# AUTO-GENERATED GROUP ALIASES/,$d' "$VIRTUAL_FILE" | sed '/^[[:space:]]*$/d' > "$TEMP_FILE"
else
    # If no auto-generated section, keep entire file
    sudo cat "$VIRTUAL_FILE" > "$TEMP_FILE"
fi

# Add separator for auto-generated section
echo "" >> "$TEMP_FILE"
echo "# AUTO-GENERATED GROUP ALIASES - DO NOT EDIT BELOW THIS LINE" >> "$TEMP_FILE"
echo "# Generated at: $(date)" >> "$TEMP_FILE"

# Query database for active group aliases and their members
SQL_QUERY="
SELECT
    g.email_alias,
    GROUP_CONCAT(u.email ORDER BY u.email SEPARATOR ', ') as members
FROM \`groups\` g
JOIN group_members gm ON g.id = gm.group_id
JOIN users u ON gm.user_id = u.id
WHERE g.email_alias IS NOT NULL
    AND g.email_alias != ''
    AND g.is_active = 1
    AND (g.type = 'email' OR g.type = 'both')
GROUP BY g.email_alias
ORDER BY g.email_alias;
"

# Execute query and format as Postfix virtual aliases
while IFS=$'\t' read -r alias members; do
    # Ensure proper formatting (align columns)
    printf "%-35s %s\n" "$alias" "$members" >> "$TEMP_FILE"
done < <(sudo $MYSQL_CMD "$DB_NAME" -e "$SQL_QUERY")

echo "# End of auto-generated group aliases" >> "$TEMP_FILE"

# Compare with current file to see if updates are needed
if ! sudo diff -q "$TEMP_FILE" "$VIRTUAL_FILE" > /dev/null 2>&1; then
    echo "Updating Postfix virtual aliases..."

    # Replace the virtual file
    sudo mv "$TEMP_FILE" "$VIRTUAL_FILE"

    # Update Postfix database
    sudo postmap "$VIRTUAL_FILE"

    # Reload Postfix
    sudo systemctl reload postfix

    echo "Postfix virtual aliases updated successfully"

    # Log the update
    logger -t sync-email-aliases "Updated Postfix virtual aliases from intranet database"
else
    echo "No changes needed to Postfix virtual aliases"
    rm -f "$TEMP_FILE"
fi

# Clean up old backups (keep last 30 days)
find "$BACKUP_DIR" -name "virtual.backup.*" -mtime +30 -delete 2>/dev/null || true

echo "Sync completed at $(date)"