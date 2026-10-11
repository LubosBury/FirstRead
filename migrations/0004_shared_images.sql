-- The free library: admins share their own pictures with everyone signed in.
-- shared_at: listed in the library now; cleared on unshare.
-- first_shared_at: set on the first share and never cleared, so sheets that
-- already use the picture keep it. Deleting the picture is the takedown.
ALTER TABLE images ADD COLUMN shared_at TEXT;
ALTER TABLE images ADD COLUMN first_shared_at TEXT;
CREATE INDEX images_shared ON images (shared_at DESC) WHERE shared_at IS NOT NULL;
