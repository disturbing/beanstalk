-- Automations (docs/claude-opus/25-actions-and-automations.md §7): agent jobs defined by files
-- in `.beanstalk/automations/` on the stalk. They are indexed in `actions_workflows` beside the
-- GitHub workflows (the path tells them apart) and run as Actions runs. A job token minted for
-- an automation's job names the automation: it pushes as `<id>[automation]` and may also push
-- the automation's memory ref, `refs/automations/<id>/memory`, and nothing else beyond beans.
ALTER TABLE actions_job_tokens ADD COLUMN automation_id TEXT;
