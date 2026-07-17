ALTER TABLE orders
ADD COLUMN IF NOT EXISTS uploaded_xml_filename TEXT,
ADD COLUMN IF NOT EXISTS uploaded_xml_content TEXT;
