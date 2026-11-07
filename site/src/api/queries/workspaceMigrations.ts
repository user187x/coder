import { WorkspaceMigrationsAPI } from "../workspaceMigrations";
export const workspaceMigrationKey = (id: string) =>
	["platform", "workspace-migrations", id] as const;
export const workspaceMigrationPlan = (id: string) => ({
	queryKey: workspaceMigrationKey(id),
	queryFn: () => WorkspaceMigrationsAPI.plan(id),
});
export const migrateWorkspace = (id: string) => ({
	mutationFn: (
		action: { target: string } | { resume: true } | { cancel: true },
	) =>
		"cancel" in action
			? WorkspaceMigrationsAPI.cancel(id)
			: "resume" in action
				? WorkspaceMigrationsAPI.resume(id)
				: WorkspaceMigrationsAPI.start(id, action.target),
});
const workspaceMigrationsKey = ["platform", "workspace-migrations"] as const;
/** Polls every 3 seconds while a migration runs, and every 15 otherwise. */
export const workspaceMigrations = () => ({
	queryKey: workspaceMigrationsKey,
	queryFn: WorkspaceMigrationsAPI.list,
	retry: false,
	refetchInterval: (q: {
		state: { data?: { migrations: { status: string }[] } };
	}) =>
		q.state.data?.migrations.some((m) => m.status === "running")
			? 3_000
			: 15_000,
});
