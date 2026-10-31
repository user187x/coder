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
