import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "react-query";
import {
	type WorkspaceMigrationPlan,
	WorkspaceMigrationsAPI,
} from "#/api/workspaceMigrations";
import { MockWorkspace } from "#/testHelpers/entities";
import { MockWorkspaceMigrationPlan } from "#/testHelpers/workspaceMigrations";
import { MigrateWorkspaceDialog } from "./MigrateWorkspaceDialog";

const setup = (data: WorkspaceMigrationPlan = MockWorkspaceMigrationPlan) => {
	vi.spyOn(WorkspaceMigrationsAPI, "plan").mockResolvedValue(data);
	render(
		<QueryClientProvider
			client={
				new QueryClient({ defaultOptions: { queries: { retry: false } } })
			}
		>
			<MigrateWorkspaceDialog
				workspace={MockWorkspace}
				open
				onClose={vi.fn()}
			/>
		</QueryClientProvider>,
	);
	return userEvent.setup();
};
afterEach(() => vi.restoreAllMocks());
it("requires a valid destination and confirmation before submitting", async () => {
	const start = vi
		.spyOn(WorkspaceMigrationsAPI, "start")
		.mockImplementation(() => new Promise(() => {}));
	const user = setup();
	await user.click(
		await screen.findByRole("button", { name: "Migrate to worker-03" }),
	);
	await user.click(screen.getByRole("button", { name: "Stop and migrate" }));
	expect(start).not.toHaveBeenCalled();
	await user.click(
		screen.getByRole("button", { name: "Migrate to worker-02" }),
	);
	expect(start).not.toHaveBeenCalled();
	await user.click(screen.getByRole("button", { name: "Stop and migrate" }));
	await waitFor(() =>
		expect(start).toHaveBeenCalledWith(MockWorkspace.id, "worker-02"),
	);
});
it("resumes an interrupted operation without creating a second migration", async () => {
	const resume = vi
		.spyOn(WorkspaceMigrationsAPI, "resume")
		.mockImplementation(() => new Promise(() => {}));
	const start = vi.spyOn(WorkspaceMigrationsAPI, "start");
	const user = setup({
		...MockWorkspaceMigrationPlan,
		operation: {
			id: "migration",
			status: "interrupted",
			phase: "copy",
			sourceNode: "worker-01",
			target: "worker-02",
			message: null,
			error: null,
			retainedVolume: null,
		},
	});
	await user.click(
		await screen.findByRole("button", { name: "Resume migration" }),
	);
	await waitFor(() => expect(resume).toHaveBeenCalledWith(MockWorkspace.id));
	expect(start).not.toHaveBeenCalled();
});

it("disables an ineligible destination with its reason and selects an eligible one", async () => {
	const start = vi
		.spyOn(WorkspaceMigrationsAPI, "start")
		.mockImplementation(() => new Promise(() => {}));
	const user = setup();
	const blocked = await screen.findByRole("button", {
		name: "Migrate to worker-03",
	});
	expect(blocked).toHaveAttribute("aria-disabled", "true");
	expect(blocked).toHaveTextContent("Needs 4 cores, 2.5 free");
	await user.click(blocked);
	expect(blocked).toHaveAttribute("aria-pressed", "false");
	const ready = screen.getByRole("button", { name: "Migrate to worker-02" });
	expect(ready).toHaveAttribute("aria-disabled", "false");
	expect(ready).toHaveTextContent(
		"Needs 4 cores, 8 GiB memory and 10 GiB disk",
	);
	await user.click(ready);
	expect(ready).toHaveAttribute("aria-pressed", "true");
	expect(start).not.toHaveBeenCalled();
});
