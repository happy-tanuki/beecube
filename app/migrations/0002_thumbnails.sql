-- Whether a link-preview picture is stored in R2 under thumbnails/<id>.jpg.
ALTER TABLE projects ADD COLUMN has_thumbnail INTEGER NOT NULL DEFAULT 0;
