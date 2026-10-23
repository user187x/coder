# Rolling back from the fork to upstream Coder

The fork can be taken out and pure upstream Coder put in its place, with no change to the database, the workspaces
or their volumes, and back again.

## Why it is safe

* **Same database schema.** The fork adds no migration: its schema is upstream's at its base commit `70bc2e554`
  (migration 000611). Upstream Coder at that commit runs on the fork's database as it is.
* **Nothing of Coder's is stored differently.** The fork writes only two kinds of extra data into Coder's tables, and
  upstream ignores both:
  - the admin quick links, as `user_configs` rows (`preference_admin_quick_links`);
  - SSH keys made from a .p12, into the standard `gitsshkeys` table.

  Everything else the fork adds lives outside Coder's database: in the platform service's own volume and database,
  in ConfigMaps, and in the image builder's registry.
* **Same agent protocol.** The fork only drops the network-telemetry handler, so running workspaces' agents (built
  by the fork) keep working against upstream Coder until their next start, when they get upstream's agent.
* **Same templates.** The workspace template uses only the standard `coder` and `kubernetes` providers, from the
  same provider mirror.

Tested by `development/tools/verify/rollback.sh`:
1. It copies a deployment's database.
2. It runs the rollback image on the copy and checks that it starts, keeps the schema, accepts a password sign-in
   and sees exactly what the fork sees: users, templates and versions, workspaces, builds, apps, SSH keys.
3. It runs the fork on the copy again (roll forward).

It passed on the development cluster's database (2026-10-13, 7/7).

## The rollback image

`ghcr.io/user187x/coder-upstream:2.38.0-main.70bc2e554-airgap` (in the bundle, `images/rollback/`): upstream Coder
built from `70bc2e554` with no change, plus the same Terraform provider mirror as the fork's `-airgap` image.

**Why not a published upstream release?** No published upstream release can take the fork's database: v2.38.0, the
newest when this was written, stops at migration 000605. Coder refuses to run on a database newer than it knows. The
first release with migration 000611 (v2.39.0, expected around November 2026) will work as a rollback target too.

Rebuild the rollback image:
1. Run `scripts/build_platform_image.sh` in a worktree of `70bc2e554`, as `--image ghcr.io/user187x/coder-upstream`
   `--tag 2.38.0-main.70bc2e554`.
2. Run `development/tools/build-airgap-image.sh --upstream 2.38.0-main.70bc2e554`.

## Rolling back

1. **Back up first:** the database (CloudNativePG backup or `pg_dump`) and, if you want, the workspaces' volumes.
2. **Use the upstream image.** Push it to your registry if needed (`./mirror-images.sh push <registry> custom`
   includes it). Then set, in your values or the Argo CD Application:

   ```yaml
   coder:
     coder:
       image:
         repo: ghcr.io/user187x/coder-upstream        # with global.registry: <registry>/user187x/coder-upstream
         tag: 2.38.0-main.70bc2e554-airgap
   ```

   and apply (`helm upgrade`, or sync). Coder restarts on the upstream image. The fork's own environment variables
   (platform service routes, quota and schedule hooks) are not read by upstream Coder, so they do nothing.
3. **What stays and what goes.**
   - Workspaces, templates, users, tokens and audit history stay, and running workspaces keep running.
   - The dashboard is upstream's: none of the fork's views or menus. The platform service, banner and image
     builder can stay deployed, but nothing in upstream's dashboard links to them.
   - Quotas and the workspace scheduler are no longer enforced: they are checks the fork's server asks the platform
     service for.
   - With `global.oidc` set, upstream needs Keycloak reachable at startup. Upstream exits when the issuer can't be
     reached, where the fork starts without it.
4. **Roll forward:** set the image back to `ghcr.io/user187x/coder-platform:<tag>-airgap` and apply.

## When the fork moves to a newer upstream

The rollback target moves with it. Rebuild the rollback image from the new base commit, or use the first upstream
release that contains it (`development/coder-fork/UPSTREAM.md`), and run `rollback.sh` again.
