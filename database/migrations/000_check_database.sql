-- =====================================================
-- DATABASE CHECK SCRIPT
-- Run this first to find your database name
-- =====================================================

-- List all databases
SELECT name as database_name
FROM sys.databases
WHERE name NOT IN ('master', 'tempdb', 'model', 'msdb')
ORDER BY name;

-- Check current database
SELECT DB_NAME() as current_database;

-- Check if permission tables exist
SELECT TABLE_NAME
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_NAME LIKE 'PERMISSION%'
ORDER BY TABLE_NAME;
