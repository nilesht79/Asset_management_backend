-- Query to check products table structure and sample data
SELECT TOP 5 * FROM products;

-- Check if products table has any serial number related columns
SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'products';

-- Check assets table to understand relationship
SELECT TOP 5 id, asset_tag, serial_number, product_id, created_at 
FROM assets;

-- Check assets table columns
SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'assets';
