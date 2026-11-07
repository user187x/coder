import { screen, within } from "@testing-library/react";
import {
	type WorkspaceMigrationSummary,
	WorkspaceMigrationsAPI,
} from "#/api/workspaceMigrations";
import { bytes } from "#/modules/platform/ClusterVisuals";
import { render } from "#/testHelpers/renderHelpers";
import { MigrationsTable } from "./MigrationsTable";

const running: WorkspaceMigrationSummary = {
	id: "m1",
	workspaceId: "11111111-1111-1111-1111-111111111111",
	workspaceName: "dev",
	status: "running",
	phase: "cutover",
	percent: 50,
	cpu: 2,
	memoryBytes: 4 * 1024 ** 3,
	diskBytes: 10 * 1024 ** 3,
	copiedBytes: 5 * 1024 ** 3,
	sourceNode: "worker-01",
	target: "worker-02",
	message: null,
	error: null,
	startedAt: "2026-11-06T10:00:00Z",
	updatedAt: "2026-11-06T10:05:00Z",
};
const done: WorkspaceMigrationSummary = {
	...running,
	id: "m2",
	workspaceName: "prod",
	status: "done",
	phase: "done",
	percent: 100,
};
afterEach(() => vi.restoreAllMocks());

it("shows each migration with an accessible progress bar", async () => {
	vi.spyOn(WorkspaceMigrationsAPI, "list").mockResolvedValue({
		migrations: [running, done],
	});
	render(<MigrationsTable />);
	const bar = await screen.findByRole("progressbar", {
		name: "Migration progress for dev",
	});
	expect(bar).toHaveAttribute("aria-valuenow", "50");
	expect(
		screen.getByRole("progressbar", { name: "Migration progress for prod" }),
	).toHaveAttribute("aria-valuenow", "100");
	const row = screen.getByRole("row", { name: /^dev/ });
	expect(within(row).getByText("worker-01")).toBeInTheDocument();
	expect(within(row).getByText("worker-02")).toBeInTheDocument();
	expect(within(row).getByText("2 cores")).toBeInTheDocument();
	expect(within(row).getByText(bytes(running.memoryBytes))).toBeInTheDocument();
	expect(within(row).getByText(bytes(running.diskBytes))).toBeInTheDocument();
	expect(within(row).getByText("Running")).toBeInTheDocument();
	expect(within(row).getByText(/50% copied, cutover/)).toBeInTheDocument();
});

it("says so when there are no migrations", async () => {
	vi.spyOn(WorkspaceMigrationsAPI, "list").mockResolvedValue({
		migrations: [],
	});
	render(<MigrationsTable />);
	expect(await screen.findByText("No migrations yet.")).toBeInTheDocument();
});
