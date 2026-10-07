-- Repository-bound session tokens (docs/claude-opus/22-mcp-repository-tools.md): the MCP tool
-- git_credentials mints a session token for one repository. `repository` holds that
-- repository's engine id; the gateway's git proxy opens only that repository with it. Null
-- for every other token (personal tokens and unbound session tokens reach every repository
-- their person may use).

ALTER TABLE user_tokens ADD COLUMN repository TEXT;
