-- A repository's public face (docs/claude-opus/29-settings.md): its website, topics and the
-- social image (an R2 key in beanstalk-media, repos/<id>/social/<hash>). Only adds columns.
ALTER TABLE repositories ADD COLUMN website TEXT NOT NULL DEFAULT '';
ALTER TABLE repositories ADD COLUMN topics_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE repositories ADD COLUMN social_image_key TEXT;
