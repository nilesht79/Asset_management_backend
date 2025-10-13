-- Add tag_no column to assets table
-- Tag No will be auto-generated based on: ASSET_TAG/LOCATION_CODE-SEQUENCE

-- Add the column
ALTER TABLE assets
ADD tag_no VARCHAR(100) NULL;

-- Create index for better performance
CREATE INDEX idx_assets_tag_no ON assets(tag_no);

-- Generate tag_no for existing assets
UPDATE a
SET a.tag_no =
    CASE
        WHEN l.code IS NOT NULL THEN a.asset_tag + '/' + l.code + '-' + RIGHT('000' + CAST(ROW_NUMBER() OVER (PARTITION BY a.location_id ORDER BY a.created_at) AS VARCHAR), 3)
        ELSE a.asset_tag + '/ADM-' + RIGHT('000' + CAST(ROW_NUMBER() OVER (ORDER BY a.created_at) AS VARCHAR), 3)
    END
FROM assets a
LEFT JOIN locations l ON a.location_id = l.id
WHERE a.tag_no IS NULL AND a.is_active = 1;

-- Add unique constraint to ensure tag_no is unique
ALTER TABLE assets
ADD CONSTRAINT uq_assets_tag_no UNIQUE (tag_no);

SELECT 'Successfully added tag_no column and generated tag numbers for existing assets' as Status;
