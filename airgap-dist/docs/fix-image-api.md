# Fix image: proposed API (for review, not implemented)

The Fix image page (Templates › Images › an image › Fix image, from the list's **Fix CVEs** or **View fix →**) is
built on what the image builder already has:

- **Per-CVE fix versions:** the scan report's findings (`vulnerabilities.top`: package, installed and fixed version,
  how it was found).
- **Fixable counts and projected grade:** `report_summary`'s `fixableCounts`, `projectedGrade` and `needsFixing`.
- **The build trigger:** an installation step saved in the image's spec, then `POST /images/<id>/build`. A build
  scans the new version.
- **The pit stop (implemented):** `POST /images/<id>/pit` (`keys`, `libraries`, `level`, `maxLevel`, `laps`) starts
  Copa on the image; `GET /images/<id>/pit` and the image's detail (`pit`) follow it. It is a build of the patched
  image (`/images/<target>/builds/<n>`), so it is cancelled like one.

The design asks for three more things that have no backend. Their controls are on the page but off; each says it
waits for this API. Nothing below exists yet: it is the contract to agree on before building it.

All routes are under `/__coder-ui/api/images/<id>`. They have the image builder's rules:
- **Sign-in:** a Coder session.
- **Writes:** editing roles (owner, template admin), and the `X-Requested-With: coder-ui` header.
- **Errors:** `{error}` with 400, 403, 404 or 409.

## 1. Accepted risks

A finding with no fix (or one not to fix now) is accepted with a reason. It stays visible and counted on the grade
until a fix ships; the page shows it as accepted, with who accepted it, why, and until when.

```
GET    /fix/risks                      -> {risks: [Risk]}
POST   /fix/risks {id, pkg, reason, until?}   -> {risk: Risk}     409: already accepted
POST   /fix/risks/<risk>/revoke        -> {ok: true}
Risk = {id: "CVE-…", pkg, reason (1–500 chars), by, at, until (ISO date | null), revokedBy?, revokedAt?}
```

- **Storage:** the image builder's store, beside the image (a table `image_risks`). It is deleted with the image.
- **Expiry:** a risk lapses at `until`. A rescan drops a risk whose finding is gone.
- **Grade:** unchanged on purpose (the design: "they stay visible on the score").

## 2. Pull requests ("Open as a pull request instead of committing")

Today the fix is saved in the image's spec, a commit in the builder's own sense. A pull request needs the image's
build files in a Git repository and a Git host to open it on. The platform has neither: images are built from specs
in the builder's store. Proposal:

```
GET  /images/settings  ->  … gitRemote: {url, branch, provider: "github"|"gitlab"|"gitea", tokenSecret} | null
POST /images/<id>/fix/pull-request {findings: [key], title?, body?}  -> {url, branch, number}
```

- **Files:** the spec renders to the build context (`Dockerfile`, `installs/`), as the review step already shows.
- **Branch:** `fix/<image>-<date>`.
- **Result:** the change is the new installation step. A merge does not build by itself: a webhook or the next
  **Rebuild** does.
- **Air-gapped:** this needs an in-cluster Git host (Gitea), a bundle part to agree on separately.

## 3. Agent runs ("Hand to an agent", the list's "Agent patching · 2/4", the Activity feed)

An agent run applies the selected fixes through the same pipeline: Plan → Patch → Rebuild → Rescan → Promote. It may
retry, choose rebase over upgrade, or stop and report, within the permissions given. Every step is logged.
**Promote waits for an admin's approval** unless the run was allowed to promote.

```
GET  /fix/agents                       -> {agents: [{id, name, kind: "runner"|"mcp"|"webhook", ready, detail}]}
POST /fix/runs {agent, findings: [key], allow: {edit, build, pullRequest, promote}, instructions}
                                       -> {run: Run}          409: a run is active for this image
GET  /fix/runs                         -> {runs: [Run]}       (newest first; the page's Activity)
GET  /fix/runs/<run>?log=400           -> {run: Run, log: [line]}
POST /fix/runs/<run>/cancel            -> {ok: true}
POST /fix/runs/<run>/approve           -> {ok: true}          (Promote, when not allowed to promote itself)
Run  = {id, image, agent, by, at, status: "queued"|"running"|"waiting-approval"|"done"|"failed"|"cancelled",
        step: "plan"|"patch"|"rebuild"|"rescan"|"promote", stepIndex: 1–5, steps: [Step], findings: [key],
        build?: {id, version}, result?: {grade, counts}, error?}
Step = {key, label, state: "done"|"active"|"pending"|"failed", startedAt?, finishedAt?, detail?}
```

- **The list row:** the Images list gets `fixRun: {id, status, step, stepIndex}` on an image with an active run, which
  draws "Agent patching · 2/4", "Rebuild queued" and **View run**.
- **Runner:** a Job in `coder` per run, with the agent's image, given:
  - the scan report, the spec (or the copy's) and the selected findings;
  - a token scoped to this image's `fix/runs/<run>/report` (its steps and log) and, when allowed, to save the spec
    and start a build.
  It never gets a Coder session.
- **Agents:** configured by admins in Images › Settings.
  - **runner:** an image that reads the run's input and posts steps.
  - **mcp:** an MCP endpoint given the same tools.
  - **webhook:** a URL that is posted the run and answers through the run's token.
- **Questions for review:**
  - Which agents does this deployment allow?
  - May a runner reach a model endpoint from an air-gapped cluster?
  - Who may approve Promote: the same editing roles, or owners only?
