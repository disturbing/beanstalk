-- Owner's decision 2026-10-09 (docs/claude-opus/28-organizations.md §6.1): members of an org
-- reach no repository they are not invited to. New orgs are created with base permission
-- 'none' (org-admin.ts sets it; 0004's column default stays 'read' because SQLite cannot
-- change a default without rebuilding the table). Orgs still on the old default move to none.
UPDATE orgs SET base_permission = 'none', updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE base_permission = 'read';
