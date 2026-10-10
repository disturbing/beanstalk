/** What one agent container serves: its slot in a match, and the slot token it never sees. */
export type AgentAssignment = {
  readonly match: string;
  readonly slot: string;
  readonly run: string;
  readonly token: string;
};
