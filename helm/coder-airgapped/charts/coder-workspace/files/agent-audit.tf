# Agent action monitoring: records what runs inside the workspace — every command/process an LLM agent (or anyone)
# executes, with its full argument list, working directory and parent process — and ships those records off the
# workspace to the coder-ui-updates service, which keeps them in Coder's CloudNativePG database for admins to review
# under Observability > Agent Activity.
#
# What this captures and why it fits an LLM agent: a coding agent acts by RUNNING THINGS — shell commands, git, curl,
# python, package installs, file tools. Process-exec audit records exactly those actions (auditd / snoopy class of
# control, standard in hardened Linux baselines). It is host/runtime audit of program executions, not keystroke
# capture of a person typing. Records leave the workspace immediately, so a process in the workspace cannot rewrite
# its own history after the fact.
#
# Attribution: every exec is stamped with pid/ppid and session id, so the subtree under a known agent process is
# identifiable as that agent's actions. The workspace owner and id come from Coder, and the record is tied to the
# workspace by its Coder agent token (validated by the service against Coder), so records cannot be forged for another
# workspace.
#
# Drop this file next to a template's main.tf. It needs a `coder_agent` named "main"; change agent_id if yours differs.
# Turn it off for a template by removing this file. AGENT_AUDIT_DISABLE=1 in the workspace disables it at runtime.

resource "coder_script" "agent_audit" {
  agent_id           = coder_agent.main.id
  display_name       = "Agent activity monitor"
  icon               = "/icon/lock.svg"
  run_on_start       = true
  start_blocks_login = false # auditing must not keep a user out if the store is briefly unreachable
  script = templatefile("${path.module}/scripts/agent-audit.sh", {
    access_url     = data.coder_workspace.me.access_url
    owner_name     = data.coder_workspace_owner.me.name
    owner_id       = data.coder_workspace_owner.me.id
    workspace_name = data.coder_workspace.me.name
    workspace_id   = data.coder_workspace.me.id
  })
}
