#!/bin/bash

# =====================================================
# PERMISSION SYSTEM MIGRATION RUNNER
# =====================================================
# This script runs the permission system migrations
# using the credentials from your .env file

echo "🚀 Permission System Migration Script"
echo "======================================"
echo ""

# Load environment variables
if [ -f "../../.env" ]; then
    export $(cat ../../.env | grep -v '^#' | xargs)
    echo "✅ Loaded environment variables from .env"
else
    echo "❌ Error: .env file not found!"
    echo "Please ensure you're running this from the database/migrations directory"
    exit 1
fi

# Display connection info
echo ""
echo "Database Connection Info:"
echo "  Server: ${DB_HOST:-localhost}"
echo "  Port: ${DB_PORT:-1433}"
echo "  Database: ${DB_NAME:-asset_management}"
echo "  User: ${DB_USER:-sa}"
echo ""

# Check if sqlcmd is available
if ! command -v sqlcmd &> /dev/null; then
    echo "❌ Error: sqlcmd not found!"
    echo ""
    echo "Please install SQL Server command-line tools:"
    echo "  macOS: brew install mssql-tools"
    echo "  Linux: See https://docs.microsoft.com/en-us/sql/linux/sql-server-linux-setup-tools"
    echo ""
    exit 1
fi

echo "Found sqlcmd: $(which sqlcmd)"
echo ""

# Function to run SQL file
run_migration() {
    local file=$1
    local description=$2

    echo "📝 Running: $description"
    echo "   File: $file"

    sqlcmd -S ${DB_HOST:-localhost},${DB_PORT:-1433} \
           -U ${DB_USER:-sa} \
           -P "${DB_PASSWORD}" \
           -d ${DB_NAME:-asset_management} \
           -i "$file" \
           -b

    if [ $? -eq 0 ]; then
        echo "   ✅ Success!"
    else
        echo "   ❌ Failed!"
        echo ""
        echo "Migration failed. Please check the error above."
        exit 1
    fi
    echo ""
}

# Run migrations in order
echo "Starting migrations..."
echo ""

run_migration "001_permission_system.sql" "Create permission tables"
run_migration "002_permission_seed_data.sql" "Seed initial data"

echo "======================================"
echo "✅ All migrations completed successfully!"
echo ""
echo "Next steps:"
echo "1. Restart your Node.js server: npm run dev"
echo "2. Login as superadmin"
echo "3. Navigate to: Settings → Permission Control"
echo ""
