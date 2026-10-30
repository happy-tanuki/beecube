-- Uploads of pictures and 3D models, counted per project since uploads_since (milliseconds),
-- for the limit on how many a project takes in a while.
ALTER TABLE projects ADD COLUMN uploads INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN uploads_since INTEGER NOT NULL DEFAULT 0;
