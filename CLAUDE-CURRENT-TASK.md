=====SUBMITTED RAN OUT OF CREDITS (10/23) ==========

# Workspace Dashboard Updates:
- Replace the 'workspace agent name' span with the "latency" button
- Enclose both the RX/TX agent-network button and "agent network pill" into one single enclosing pill container'
- Remove the 'status' or agent-status (the top left green circle status) from the Workspace Dashboard
- Replace the "workspace-update-button' from the workspace-topbar with the existing animated 'agent-outdated-update' located right of the agent-network-pill

# Workspace Dashboard Bug fixes:
- Ghostty terminal doesn't close correctly - when added to the accordion dropdown panel doesn't this terminal doesn't close on exit. The accordion panel should close cleanly exit. A perfect example of how this works is present in the "DEFAULT" workspace's terminal close event.
- Ghostty mouse clicks don't work. When Ghostty is displaying either within a panel or popped out the terminal doesn't responds to mouse clicks

# Announcement Banner Updates:
- Provide a transparency slider to allow the the announcement banner to be more transparent
- When there are more lines of text in the announcement that are able to viewed due to being to long of a message, a mouse-over event will slowly animated and auto-scroll down for the user to allow the reader to keep reading through the entire message. When the mouse leave it will animated back up the to the beginning of text fast
- Typing 'IP' in announcement banner dropdown menu will display actual IP of the Coder Dashboard

# Inbox Notification Updates:
- Add a notification when a connected shared Cloud Drive file event happens detailing the actions along with username created action, file|directory name file|directory size for the following actions: New File|Directory Added|Removed|Deleted

# Admin Security view Updates:
- Update the Security view to add a "Global Lock Down" card view. This will be used to trap any rouge agents traversing the system or inbetween accounts
- The "Global Lock Down" will display an exposed dropdown panel of all connected users represented by a grid a small grid of green circles in a matrix-style view
 - mouseover event will display username of the represented green dot.
- When Global Lock Down is activated each user represented circle will turn turn red when confirmed their workspaces have been disconnected, affirming the proper disconnection from the service.
- The 'Global Lock Down' card view will be located within the admin Security view at the top of its content view.
- 'Global Lock Down' card-view will display a header and footer hazard strip on the card view.
- 'Global Lock Down' will be activated by "lock" button. This action will be protected by a confirmation prompt requiring admin to type out 'agree' consenting to lock the entire coder platform down.
- All non-admin users' workspaces will disconnect, grayed-out with faint lock glyph overlayed on all of thier workspace dashboards
- All non-admin users' active sessions will be terminated while leaving workspaces active.
- All users will lose access to workspace dashboard until botton admins lift the "Global lock down".
- Chat feature and banner will sill be visible providing communcation channel to user.
- The Announcement banner container will stobe diagnal black and yellow caution stripes while displaying the blinking announcement message "System Lockdown Enabled"

=====NOT SUBMITTED==========

# Template "Source Code" view Updates:
- Add developer mode to workspace-template view to have allow terraform editor.

# Workspace App Bug Fixes:
- Workspaces don't display the correct CPU and Memory available. They display the entire clusters. Fix this

=====CODEX CONTINUATION IN PROGRESS==========

Confirmed scope: complete all items above, including NOT SUBMITTED.

User decisions:
- Global Lock Down blocks workspace access and disconnects workspace sessions. Users stay signed in to Coder and can read announcements and chat with admins.
- Preserve ordinary direct SSH resilience during control connection loss. Add agent-side revocation and require updated agents before reporting confirmed disconnection.
- Cloud Drive filesystem notifications identify the mount/workspace account. Source-folder edits are explicitly labelled as observations by the source workspace account, rather than an exact signed-in actor.
- Parallel coding agents are authorized.

Completed and verified so far:
- Fixed the scrolling announcement prop type to include opacity.
- Moved the dashboard address lookup into a shared React Query definition; uppercase IP is supported in source.
- Added Developer mode navigation to the existing Terraform editor for template editors, including the displayed historical version.
- Live Minikube preview confirmed the inherited dashboard header changes, Ghostty mouse reporting, Ghostty accordion collapse on shell exit, and Developer mode navigation.
- All five active workspaces report workspace CPU/RAM totals separately from host totals in both the database and rendered UI. The reported CPU/RAM bug has not reproduced.
- Deployed the missing platform-service dashboard-address endpoint plus its gateway configuration and narrowly scoped gateway read permission. The announcement command now shows 10.100.63.126 and coder.grey-marshall.com.

Combined Minikube preview:
- Profile/context: coder; namespace: coder.
- Coder deployment image: coder-local:claude-resume-2, version 2.0.0-platform.108-resume.2. Both replicas healthy.
- The server embeds newly built slim agents for all seven supported OS/architecture combinations.
- Platform service image: coder-ui-local:claude-resume-2. The updated pod is healthy.
- Original images retained locally: ghcr.io/user187x/coder-platform:2.0.0-platform.108-airgap and ghcr.io/user187x/coder-ui-updates:code-af032ac7b386.
- Global Lock Down remains disabled. No real workspaces or Cloud Drive mounts have been restarted or migrated.
- Sanitized live preflight found zero configured source-folder drives.

Implemented:
- Workspace-only server access guards, graceful session teardown, replica acknowledgements, and agent-side WireGuard peer enforcement. Agent acknowledgements bind the exact applied policy to the current agent process. Old agents remain explicitly update-required; disconnected agents and unresponsive replicas prevent false confirmation.
- Real-agent race-tested integration proves ordinary detached SSH resilience, lockdown revocation, and preserved owner/server access. Chat and announcements remain outside the workspace gate.
- Per-account Cloud Drive TLS audit gateway and distinct retained viewer claims, durable source observation and Inbox outbox, permission checks, Markdown escaping, size reporting, retries, and explicit observation-gap alerts.
- Audited storage defaults off. Source observations identify the source workspace account and do not claim exact Coder-login attribution.

Verification:
- Final focused frontend: 14 files, 78 tests; earlier broader affected run: 18 files, 92 tests. TypeScript, production build, and changed-file Biome checks passed.
- Final seven-package targeted Go race suite and full agent SDK race suite passed.
- Platform Python: 239 tests passed; source observer: 17 tests passed. Focused database/auth/latest-template-version tests passed.
- Audited Helm rendering, Terraform formatting, Python compilation, shell syntax, and git diff --check passed.
- Live isolated audit probe passed against the configured S3 backend using two synthetic mount accounts and verified loopback TLS. Addition attribution, overwrite suppression, deletion prior bytes, and cleanup passed. No real mounts changed. Log: /tmp/coder-resume-live-audit-probe.log.
- The runtime image has no openssl CLI, so the probe used a locally generated ephemeral test certificate. Audited production certificates are provisioned by Helm.
- Additional localhost Storybook inspection was blocked by browser approval. Earlier confirmation/card screenshots and live editor/Ghostty/IP verification are retained.

Pending disruptive rollout:
- Updated existing workspace agents are required to confirm revocation of their detached direct connections.
- Audited mounts require Helm activation, updated template publication, disposable two-account validation, then approved workspace restarts onto new handles. Existing legacy mounts remain unaudited until migrated.
- No live lockdown activation or real workspace restart has been performed.
- Concrete Cloud Drive rollout and rollback instructions: /tmp/coder-resume-evidence/cloud-drive-audit-migration.md.

Verification evidence is under /tmp/coder-resume-evidence/ and /tmp/coder-*-tests.log.
Inherited broader-check blockers: full frontend lint has existing branch errors; full make gen reaches the unrelated metrics generator and fails because the root aibridge directory is absent. Database query generation and targeted new database/auth tests have passed.

User-approved rollout continuation:
- User approved disposable validation, agent updates/workspace restarts, audited mount migration, and brief lockdown testing with restoration.
- Corrected the leftover agent-card Update control: removed its old tooltip/version components and placed Update in the header Restart slot when an agent or template needs updating. Running workspaces now show Stop / Update / actions. Up-to-date workspaces retain Restart.
- Agent-only and rebuilt-agent differences now participate in header action selection. Existing update-request behavior tests cover all three update reasons; 66 focused tests, TypeScript, and changed-file Biome checks passed.
- Frontend-only image coder-local:claude-resume-3 is deployed with both replicas healthy; backend and agent version remain 2.0.0-platform.108-resume.2 to avoid unnecessary agent version churn.
- Live skibbity verification confirms Stop / Update / actions in the header and no duplicate agent-card control. Evidence: /tmp/coder-resume-evidence/update-relocated.png.
- Published audited-cloud-drive-20261024 to both active templates: default d45ef92e-939b-4776-900b-1e31451b97ab; ubuntu-dataflow 493a0143-4a92-4921-b5e4-5c2b59edcf56. Both imports succeeded. Only the Cloud Drive claim expression in main.tf changed; all other archive files and all 18/19 template variable values were verified unchanged. Private original archives/settings: /tmp/coder-audit-templates/.
- Disposable two-account workspaces are running on audited claims; updated-agent owner/member connectivity and normal control-outage resilience passed live.
- During validation, admin/skibbity and tom/amethyst-sparrow-4 received initiator-triggered updates (admin and tom respectively). The rollout did not restart them again. Both preserve all snapshotted rich parameters, use audited claims, and run connected resume.2 agents. Skibbity retains its existing shared drive through the distinct viewer claim.
- Actual CSI FUSE two-account validation passed additions and shared reads: account A created 15 bytes, B read exact bytes via its shared mount, B created 14 bytes, and both real Inbox API responses attribute the other mount account with correct byte counts. Evidence: /tmp/coder-resume-evidence/live-audit-inbox.json. Overwrite/deletion validation and final migration/cleanup remain in progress.
- Full real-mount validation passed: shared account reads/writes, overwrite suppression, deletion prior byte counts (7 and 15 bytes), stable notification IDs, and correct Inbox mount-account attribution. Test files removed. Evidence: /tmp/coder-resume-evidence/live-audit-inbox-final.json.
- Audit activation is persisted in the existing ignored Minikube deployment values-local.yaml and values-cloud-drive-audit.json. Live resources were selectively patched to preserve preview images and avoid broad Helm hooks. Future Helm upgrades must include those local overlays; release-stored values still reflect the previous false flag.
- Stopped the continuation's temporary Storybook server on port 6011 after live UI verification. The user's existing Storybook tab was left untouched.
- All original five now use audited template versions, audited own/shared claims, and connected resume.2 agents. Rich parameters were verified unchanged. Three received once-only coordinated restarts; two had already been updated by their users and were not restarted again.
- Brief live lockdown confirmed all seven agents enforcing with zero pending. Member workspace access returned 423 while identity, banner, and chat endpoints returned 200; existing workspace watch and detached member peer were revoked while owner/server access remained. Lock was restored off. Reconnect verification and exact-scoped disposable cleanup are finishing. Evidence: /tmp/coder-live-lockdown/live-lockdown-probe.log and /tmp/coder-resume-evidence/live-lockdown-admin.png.
- Post-unlock fresh-process SDK reconnects passed for both disposable users, including owner/member connectivity. The original probe's reused simulated-outage transport stalled its own reconnect; separate clean-process probes verified actual user recovery. No second live lock was needed. The normal announcement returned in the browser, with chat available throughout.
- Follow-up analysis confirmed the immediate post-unlock reconnect failure is a real agent timing race, not solely a probe transport issue: a fresh coordinator NODE can arrive before the agent applies unlock and then be discarded with blocked peers. Fix in progress: retain only fresh non-lost coordinator updates across unlock, continue discarding stale detached peers, and invalidate buffered updates on control loss. This requires refreshed agent bundles and a second necessary agent update after disposable regression verification. Original five remain running/unlocked while the fix is prepared.
- Unlock race fixed: only fresh valid non-lost blocked NODE updates are restored on unlock; stale detached peers remain revoked. LOST, DISCONNECTED, and agent-control loss invalidate buffered promotion. Primitive race tests passed three runs. Real-agent immediate-unlock reconnection passed five race-tested runs; final seven-package targeted race suite passed again. New all-seven-platform agent archive/server version 2.0.0-platform.108-resume.3 built, image coder-local:claude-resume-4 staging.
- User added four frontend follow-ups: center the Template table header; enclose running animation and status text in one topbar pill; keep admin Categories navigation sticky during scroll; make the developer-mode Terraform file sidebar collapsible.
- Corrected server and all-platform agent release 2.0.0-platform.108-resume.3 is deployed as coder-local:claude-resume-4 with both replicas healthy. Disposable immediate-unlock regression and second necessary agent rollout are in progress. Upcoming frontend-only polish image will preserve this backend/agent version.
- Corrected .3 agent passed the unchanged same-process live probe, including immediate reconnect after unlock: /tmp/coder-live-lockdown/live-unlock-regression.log ends with ok=true and lockdown_restored=true. All six agents enforced during the bounded test, communication endpoints remained available, and no delayed clean-process workaround was used. Final original-five .3 updates and single-fixture cleanup are proceeding; no further live lock is needed.
- Final core verification passed: exactly the original five workspace pods are running/ready, all agents resume.3, all own/shared claims audited, every original rich parameter unchanged, lockdown disabled with five agents and zero pending. Old and regression test workspaces/accounts deleted and probe/watchdog processes exited. Private plaintext probe token files removed. Evidence: /tmp/coder-resume-evidence/live-workspace-rollout.json.
- Four UI follow-ups implemented and passed 26 targeted tests, final 21-test editor rerun, TypeScript, Biome and production build. Frontend-only image claude-resume-5 built/loaded but not yet deployed.
- User additionally requested barber-pole animation on the workspace dashboard topbar during startup/shutdown. This fifth UI follow-up is being folded into the final frontend image before deployment, retaining backend/agent resume.3. A disposable admin-owned workspace will validate live transition visuals without another restart of the original five.
- Final frontend image coder-local:claude-resume-6 is deployed with both replicas healthy; backend/agent version stays resume.3. Local deployment values pin this Coder image, platform-service coder-ui-local:claude-resume-2 and publisher CLI, and retain audit activation.
- All five new UI changes verified live: centered Template header, unified Running pill, Categories visible after scrolling, developer sidebar collapsed and keyboard-reopened with editor preserved, and barber-pole transition trim observed during both real Stop and Start of disposable admin/topbar-motion-check. Animation supports reduced motion and animations-off. Evidence screenshots are under /tmp/coder-resume-evidence/ (topbar-starting.png, status-pill.png, template-heading-centered.png, categories-sticky.png, developer-sidebar-collapsed.png). No template content was edited during visual checks.
- Temporary validation browser tab closed; live original workspace tab left open. Motion test workspace and temporary API key cleanup are finishing; no further original workspace restart is needed.
- User refined the visuals: dashboard barber-pole must be identical to main Workspaces rows, and Running pill smaller. Extracted the unchanged original row CSS into shared workspaceBarberPole.css and reused it for the topbar: 45-degree theme-accent 16% stripes, 40px tiles, 1.4s motion and identical accessibility preferences. Removed the alternate edge-strip styling. Reduced status pill padding/gap/font to about 30px height. Final 31 targeted tests, TypeScript/Biome/whitespace and production build pass; frontend-only image claude-resume-7 preparing, same backend/agent resume.3.
- All prior disposable fixture storage, credentials, claims, shares and Inbox rows were removed and verified absent after reconciliation. Read-only investigation confirmed the earlier admin usage change was a recorded administrator deletion of 1,944 bytes, not a legacy/audited mapping difference.
- Final visual refinement deployed as coder-local:claude-resume-7, same backend/agent resume.3. Both replicas healthy. Live Stop and Start verified the exact shared Workspaces barber-pole background on the dashboard topbar; compact Running pill verified on original skibbity. Latest screenshots: /tmp/coder-resume-evidence/topbar-shared-starting.png, topbar-shared-stopping.png, status-pill-compact.png. Earlier yellow edge-strip screenshots are superseded. Final disposable motion workspace cleanup is finishing.

=====FINAL VERIFIED STATUS 2026-10-24=====
All requested implementation and authorized Minikube rollout work is complete. Final Coder image coder-local:claude-resume-7, platform service coder-ui-local:claude-resume-2. Server/agent version 2.0.0-platform.108-resume.3; updated slim bundles cover all seven supported platforms.
Exactly the original five workspaces are running and ready with corrected agents, audited own/shared mounts and preserved parameters. Lockdown is off, five agents, zero pending. Both synthetic-account tests and final admin-owned animation fixtures, home volumes, test notifications/credentials and processes have been cleaned; original Cloud Drive claims were retained. Last evidence: /tmp/coder-resume-evidence/live-workspace-rollout.json.
Latest UI feedback is implemented and live verified: Update placement, centered Template heading, compact status pill, sticky Categories, collapsible developer sidebar, and exact shared main-row/topbar barber-pole animation during startup/shutdown. No further original-workspace restart is pending.
Remaining check limitations are the inherited full-lint/full-make-gen blockers documented above. No live source-backed drives are configured; source observation has automated tests. No PR/commit or remote image publication was requested or performed.

=====FOLLOW-UP REQUESTS IN PROGRESS=====
- User reports File Browser 404. Reproduced: original admin's own three apps return200; Brad/Tom apps return404 in adminsession due owner-only path-app protection. User explicitly authorized deployment admins to access other owners' File Browser apps. Implementing a narrow File Browser deployment-owner exception while retaining standard RBAC/token scopes and restrictions for unrelated users/other apps; no broad path-app sharing flag enabled.
- Ghostty mouse cursor must be pointer in shared terminal wrapper for accordion and standalone tabs; scoped CSS override implemented,5terminaltests passed.
- Center Template cell entries; remove Registry CTA from editor; minimum five-row Versions card; no own scrollbar for Categories (normal page scrolling on short windows); theme-aware QuickMenu settings preview. Implemented with38targetedtests/types/checks passed.
- Compact chat squircle toggle, preserved drafts/unread, slow4px/sec announcement scrolling with pointer-hold pause and outside release. Implemented32tests/types/checks passed.
- User clarified Accounts questionmarkcables are CloudDriveconnections and admins should connect/disconnect those grants; implementation in progress, with admin-only controls and retained prior sharing scope.
- Added Appearance gallery overlap fix: stable adaptive image tiles, separated captions, theme surface;4targetedtests/types/checks passed. Live final validation pending combined rollout.
- Combined follow-up frontend run passed85tests across19files; TypeScript clean, productionfrontend+server build passed. File Browser authorization targeted race tests (including existing token-provider and session guard tests) passed; legacy owner-only app guards/token scopes are retained for non-File-Browser apps.
- Deployed Coder preview coder-local:claude-resume-8 with unchanged agentversion resume.3; service coder-ui-local:claude-resume-3 initially rolled for adminshareendpoint. Finalservice-only legacy-share duplicate normalization fix is packaged as coder-ui-local:claude-resume-4 and rolling next, no furtherfrontend/serverchange.
- Live File Browser checks: allfive originalworkspaces return200 for deploymentowner; brad/code-server stillreturns404. Browser opened Brad's File Browser successfully. Evidence: /tmp/coder-resume-evidence/filebrowser-admin-access.json and filebrowser-admin-brad.png.
- Live chatcompact mode survivesreload and restores originalbar; pointer-hold banner test kept scrollposition unchanged for3000ms then resumed; Gallery shows separated stable captionedtiles without overlap; QuickMenu preview lighttheme verified; Versionsbody minimum208px verified. Ghosttycanvas+input+wrapper computedcursor allpointer. Evidence screenshots/JSON retained in /tmp/coder-resume-evidence/.
- Synthetic Accounts admin-control test passed connect/disconnect200, member403, originalgrant scopepreserved. All syntheticaccounts/tokens/chatmessages/conversations/notifications/volumes/secrets/sharehistory cleaned and absence checked afterreconciliation. Real Brad->Admin connection untouched. Evidence accounts-share-controls-validation.json.

=====FOLLOW-UP FINAL VERIFIED STATUS=====
All follow-up requests are complete and live: Coder image coder-local:claude-resume-8, platform-service coder-ui-local:claude-resume-4. Local deployment overrides preserve these image pins and audit activation. No agent update/workspace restart was needed for this batch.
- Deployment owners can open all five File Browser apps; owner-only access to other apps remains restricted and normal token scopes remain enforced.
- Shared Ghostty component enforces pointer cursor on wrapper/canvas/input, covering accordion and standalone contexts; standalone live computed styles verified pointer.
- Template entries centered; Registry CTA removed; Versions card body minimum208px/five40px rows; Categories intrinsically sized without internal scrollbar, using page scroll on short viewports; QuickMenu settings preview theme-aware.
- Stable adaptive Appearance gallery tiles/captions verified with the real image store; no global image selection/settings changed during QA.
- Chat squircle mode persists across reload and restores on one click while keeping drafts/unread intact. QA restored original bar mode.
- Long announcements auto-scroll at4px/sec, pause while pointer is held and resume after release. Live3000ms hold recorded zero scroll delta, then positive resume.
- Accounts cables now keyboard/pointer management controls. Admin disconnect/reconnect restores existing approved scopes; member requests rejected. Synthetic live grant exercised, then all test accounts/keys/communications/notifications/shares/storage removed and absence verified after reconciliation. Real Brad->Admin grant was not modified.
- Final checks passed:85frontend tests across19files, TypeScript, production build, app authorization/session-guard/token-provider Go race tests,242Python service tests plus final legacy-share regression checks, changed-file Biome/format/whitespace. Inherited broad lint/full-generation blockers remain documented above.
- Live final state: original five workspaces running; lockdown off, five agents, zero pending. Both Coder replicas and platform service ready. Final drivepeers.py source hash matches running image. Temporary QA tabs closed; original workspace left open. Evidence directory /tmp/coder-resume-evidence/.


=====WORKSPACE GRID AND PRIVATE TUNNELS 2026-10-24=====
- User clarified full private TCP and UDP networking, rather than selected TCP forwards. Grid dashboards now share one fit based on visible dashboard heights, keeping iframe scales and dimensions equal.
- Added both-side workspace ports, persisted source/target port sides, existing Cloud Drive cable material/physics including fall/reel release, drag/pan/iframe shielding, keyboard connection management and pending/error/disconnecting states.
- Supplied /home/xxx/Desktop/tunnel.png copied unchanged to site/static/pictures/tunnel.png. Established-only companion button sits immediately right of Cloud Drive with matching icon/button dimensions; query failures hide stale ready indicators.
- Organization-scoped policy API in workspacetunnels.py persists private state atomically, requires current authenticated user and workspace update permission on both endpoints, enforces owner/deployment-admin control, validates current agent identity against matching live pod IP, and allocates stable private /32 addresses. Peer readiness requires both current policy ACKs, fresh helper reports and recent mutual WireGuard handshakes. Deletion remains disconnecting until removal ACKs.
- Added current-build agent-token GET /api/v2/workspaceagents/me/tunnel-identity with Swagger and positive/invalid/user-token/stale-build race coverage.
- New static Go helper cmd/workspace-tunnel/workspaceoverlay, packaged in platform service image; optional workspace sidecar has only NET_ADMIN, readonly root, mounted CA and /run. Authenticated HTTPS policy, ephemeral private keys, exact peer /32 routes, no forwarding, fail-closed normal errors, key rotation and restart recovery. Existing Kubernetes pod networking remains independent of this overlay and Coder Lock Down remains scoped to Coder access/sessions.
- Kernel limitation: SIGKILL can leave kernel WireGuard state until helper restart or pod teardown; if both helpers are killed, no unconditional kernel lease revocation exists. API stops reporting readiness after stale reports and does not falsely confirm disconnection without removal ACKs. Recent handshake is encrypted-connectivity evidence, not TCP service health.
- Checks: 15 tunnel policy tests plus existing242 Python tests; 11 frontend grid/tunnel behavior tests; typecheck, targeted Biome and production builds; Go runtime race/vet and identity race test. Full frontend check/lint retain unrelated inherited failures (formatting, parseInt radix, React refs/fragments) and were not claimed green.
- Live tests on disposable pods and Coder workspaces passed bidirectional TCP/UDP, real handshakes, helper restart/key rotation, active stream disconnect (2.31s including timeout), removal ACKs, and fresh TCP/UDP rejection afterward. Evidence: /tmp/coder-resume-evidence/workspace-overlay-kernel-probe.txt and workspace-overlay-integrated-live.txt.
- Deployment and original workspace rollout are finishing. Preserve user-created original-workspace cords (xxx/skibbity and xrp/skibbity), remove only disposable tunnel-check fixtures and their own test cord. Final status below will supersede this progress entry.

- Final UI QA found and corrected DELETE cross-site rejection: send both JSON Content-Type/CSRF header and an explicit empty JSON body (Axios otherwise removes Content-Type). Added actual Axios request-transform regression. User saw the old-bundle error and was advised to refresh after the fix deployed.
- Corrected overlapping SVG socket hit areas covering attached plugs: final plug interaction layer and target-socket delegation now unplug the existing cord; start drag at pointer position, not the source socket. Added existing-plug and target-socket DELETE-without-CREATE regressions.
- User subsequently requested replacing the supplied globe artwork with a matching existing-aesthetic icon. Supersedes the earlier asset note: use lucide CableIcon at matching14px inside22x20px control with semantic success stroke; remove unused tunnel.png asset. Final icon/drag rollout pending below.


=====FINAL PRIVATE TUNNEL STATUS 2026-10-24=====
- Final live images: coder-local:claude-resume-13 (two healthy Coder replicas), coder-ui-local:claude-resume-6 (one healthy platform replica), server/agentversion remains resume.3. Static helper packaged in service image code-953d910b7d10, bundled archive/pins updated; local deploy overrides pin correct service/helper/CLI images. Both template active versions preserve current sources/variables with only helper-image update: default ca98e6fb-c3dd-4cc7-9b6a-6b29856e2e79, dataflow b16bf0a5-b5ba-4613-9a2b-624b8ba5a5bf.
- User's latest request complete: matching CableIcon hover/focus/click card shows connected workspace names, actual per-peer RX/TX histogram and observed TCP/UDP local/remote ports. Existing NetworkHistogram and Popover primitives reused; missing/stale/partial observations labeled explicitly. UDP is a recent observed flow, not an assertion that a socket remains open. Current counters/histories bounded; epochs reset on peer/interface/key changes without spikes. Authorization HTTP calls moved outside policy file lock to avoid blocking helper syncs.
- Runtime now reports WG peer counters, established TCP sockets, connected UDP sockets and UDP conntrack flows (including sendto), with bounded payloads and availability flag. Conntrack observation uses empty custom chain; it does not ACCEPT or bypass existing filtering. Observation failures do not revoke healthy transport.
- Verified 17 focused frontend tests, clean typecheck/targeted Biome, production frontend/fat builds;22 focused Python tunnel tests including counter epoch/concurrency/limits/scope;263 combined Python tests before final epoch regression; Go runtime race/vet and current-build identity race checks. Full inherited lint/check/gen limitations above remain unchanged.
- Actual Minikube probes and Coder fixtures verified real bidirectionalTCP/UDP, fresh positive RX/TX rates, both endpoint names, activeTCP25431 and UDP25432, histogram samples and both endpoint port direction. Browser native drag unplug succeeded with correct JSON CSRF request, both peer-removal ACKs and link absence. Test traffic/PIDs stopped; both generations of disposable tunnel-check workspaces, pods, PVC/PVs and policy/telemetry fixture records removed. No user-created cord was removed or restored by QA; user independently disconnected their own original cords, so final user link list is empty.
- Original five workspaces running, every Coder agent connected, every helper ready on .6. Lockdown off, five agents, zero pending. Original parameters preserved and external user restarts adopted. Original dashboard tab left open, temporary QA tabs closed; grid selection restored to original three admin workspaces.
- Evidence: /tmp/coder-resume-evidence/workspace-tunnel-hover-active-final.png, workspace-overlay-live-telemetry.json, workspace-overlay-live-telemetry-recovered.json, workspace-overlay-real-ui-unplug.json, workspace-tunnels-final-state.json. Kernel SIGKILL limitation noted above remains; do not claim unconditional kernel lease enforcement.


=====ANNOUNCEMENT LOOP AND TERMINAL CONTEXT COMPLETED 2026-10-24=====
- User requested endless announcement text loop and a toggle, and dashboard accordion prompt position unaffected by announcement. Added independent loopText setting, defaulttrue, persisted/validated in coderd/platformbanner Fields. Compact long text duplicates into an inert/aria-hidden second block, smoothly wraps at exact first-block height at4px/sec. Loop text continuously toggle in Deployment > Announcement > Compose; visual-effect Repeat remains independent. Holdpointerpauses, motionprefs/manualreaderyield retained; loopoffreads once.
- User confirmed dashboardaccordiononly. Read-only evidence found the bottom prompt-like line is tmux pane-border-format term_info, while Bash PS1 is unchanged and standalone prompt starts correctly. Moved managed monitor window borderstatus to top in live skibbity session without workspace/sessionrestart. New default tmux command sets pane-border-status top; migrate only exactpreviousdefault andpreservecustomcommands/enabledflag. Live screenshot terminal-context-top.png / announcement-loop-terminal-final.png.
- Thirty announcement/editor/scroll tests, five terminalsession tests, platformbanner Go-race tests, types/targetedBiome/build pass. Liveeditor toggle off/on changed draft then returned Publishdisabled; nothingpublished. Bannerliveviewport36px/height48px, twocopies/period180px, observedwrap145.31->30.95px, held3sec movementonly0.53px includingpreclicklatencyvs12pxnormal. Terminalcanvasposition/height stable duringbanneractivity. QAstandalone shell exited, temporarytabsclosed. Existingworkspace/announcementcontentpreserved.
- Deployed coder-local:claude-resume-14, bothreplicasready, platformservice/helper .6 unchanged, no original workspace restart needed. Localpinsupdated. FE1-FE10 scopedselfreviewpassed; inheritedbroadchecklimitationsremain.

=====SECURITY BULK POWER AND AVATARS IN PROGRESS=====
- User asks Shut Down and Terminate on right beneath Lock; avatars in userconnectiongrid withlightbottomleft. Clarified Terminate means force-stop retainingdata, neverdeleteworkspaces/storage. Bothactionsallusersincludingadmins; userrequestedUIbuttons, NOT executionagainstoriginal5. Onlydisposablepowerfixture authorizedforQA.
- Frontendagentconnector_reuse_design ownsbuttons/reviewconfirm/progress/avatars. Pythonbackendagentworkspace_grid_sizing ownsorg-scoped workspace-power operations andnarrowKubeRBAC. Runtimeagentworkspace_tunnel_design preparesfixture/gracefulstop/restart/force-stop/restartsentinelpreservation QA andindependentreview.
- Chosen API POST /__coder-ui/api/organizations/{org}/workspace-power {action:shutdown|terminate,workspace_ids:[reviewedUUIDs],confirmation:actionliteral}; GET operation/id. UIenumeratesallvisibledeploymentworkspaceIDs, groupsorgs, confirmsallusers/adminsscope thenfanoutoperations; explicitIDspermitfixture-onlybackendQA. GracefulusesCoderstopbuilds; forceaddsexactUUIDdeploymentreplicas0 andgrace0poddelete whileCoderstopconverges, preservesPVCs/workspaceobjects. Unsupportedcontrollers/providers/nodeunreachable reportunsupported/unverified ratherthanfalseforce success. Tokenmemoryonly; service restart interrupted state, boundedjobs/partialerrors.
- RootSDKGlobalLockdownUser addsavatar_url andservermatrixincludesallactiveaccounts (offlinegrey,connectedgreen,blockedred); regeneratedTS, addedadminavatar/offline visibility test; nonownerprivacyretained. Go -racetestsrunning.


=====FINAL SECURITY BULK POWER AND AVATARS COMPLETED 2026-10-24=====
- Right-side controls are Lock, Shut Down, Terminate. Bothpoweractionsreviewalluser/adminworkspaceIDs acrossorganizations, typedconfirmation, frozenIDsnapshot, systemprebuildsexcluded, up tofourorganizationworkers withserial100-IDbatches. Persistentrealprogress/recenthistory/perworkspacepartialerrors; nooptimisticsuccess. Workspace/PVCretentionexplicit.
- Org-scopedworkspacepower.py usesCodergracefulstopbuilds; forceaddsUID/resourceVersion-fencedDeploymentreplicas0 andUID-preconditionedgrace0podremoval, preservingworkspaceobjects/volumes. Handlespendingbuildcancel races, refusesunsupportedcontrollers/providers, abortsifanotherbuildstarts, retainsexistingparameters/version, scopesallPOST/GETauthorization, tokensonlyinmemory, restartmarksinterrupted. NamespacedDeploymentget/list/patchandReplicaSetget added; nostorage-deletionpermissionadded. Controlplaneremovalreportedseparatelyfromphysicalpoweroff; nodeunreachabilityisnotclaimedverified.
- Usergridnowrendersprofileavatars withbottom-leftgreenconnected/amberdisconnecting/reddisconnected/greyofflinelights. SDKavatar_url andallactiveaccountsallowofflinevisibility; authenticatedrequester explicitlyconnected (liveinspectioncaughttheoldlastSeenlag). Nonowneruser-matrixprivacyretained; Goprivacy/avatar/offline/requester-race tests pass; regeneratedAPItypes/Swagger.
- 286Python tests pass (242platform+22tunnels+22power). FocusedfrontendAPI/UI/query tests, five-orgmax4concurrencyregression, prebuildscope, types, targetedBiome, productionfrontend/serverbuilds pass. Fullrepositorycheck/lint stillreportinheritedparseIntradix, unchangedformatterfilesandReact/unicorn/styleissues; fullmakegenunrelatedaibridgegap previouslydocumented. No hook bypass/configopt-outused.
- LiveQAONLYadmin/power-checkfixture: gracefulShutDownandforceTerminatecompleted, actualMinikubecontainerabsenceverifiedindependently, restartretainedsamehomePVCUID+ownedfilesentinel+workspaceobject, originals5build/PVCUIDsunchanged. LiveUIreviewedbothdialogsandCANCELLED, nooriginalpoweractionperformed. Fixturefullydeleted+ownPod/Deployment/PVC/PVgone, sentinel/processesremoved, exactlytwoQAoperationrecordsatomicallycleaned.
- CoderrollouttemporarilyfenceditsHAleaseunderloadandinterruptedfirstfixturedelete; afternewreplicasstable, logsconfirmedTerraforminterruptionandonescopeddeleteconvergenceretrycompleted. Removed12.8GiBofonlyourintermediatepreviewcache/buildartifacts, retainedactive/rollbackimages. Finaloriginal5allrunning/samebuild/PVCIDs. No new persistent credentials.
- FinalMinikubeimages: coder-local:claude-resume-16 (twohealthyreplicas), coder-ui-local:claude-resume-7 (onehealthyplatformservice), existingprivate-overlayhelpersstay.6. Builtlocalbundleimagecode-d8dde4baf727 andSHA/pinsupdated; localoverridespincorrectCoder/UI/helper/CLIimages. Agent/serverversionresume.3 remainscompatible; nooriginalworkspace restartneededforthisUI/APIfeature.
- Evidence: /tmp/coder-resume-evidence/workspace-power-live.json, workspace-power-final-cleanup.json, security-power-avatars-final.png; previousbannerloop/terminal/tunnel/fullvalidationevidenceabove. Useraskedcommittingandpushingallcompletedtaskchanges: existingbranchclaude-task/origininitiallyalignedat6daa6c5a0a; noPRrequested. Gitdeliveryrequestedtoexistingbranchclaude-task/origin; noPRrequested.

- Final visual follow-up: keep control stack onright withresponsive nonwrappingheader (small screensrightalignedbelowdescription); live requesterpresencegreen, otherofflineavatarsgrey. FinalCoderimagecoder-local:claude-resume-17, twohealthyreplicas, platformservice.7/helper.6unchanged. Allfiveoriginalpods3/3, disposablepowerfixturefullydeletedandQAoperationrecordscleaned. Finalscopeincludesuser-requestedcommit/push; sourcebranchclaude-task. Currenttypedfrontend/bulkAPIreviewsandproductionbuildsvalidated; nooriginalshutdown/terminateexecuted.
