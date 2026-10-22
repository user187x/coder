import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "react-query";
import { MemoryRouter } from "react-router";
import {
	BACKUP_HEAD_BYTES,
	type RestorePlan,
	WorkspaceExtrasAPI,
} from "#/api/workspaceVolumes";
import { MockWorkspace } from "#/testHelpers/entities";
import {
	RestoreWorkspaceDialog,
	restoredName,
	WORKSPACE_NAME_RE,
} from "./RestoreWorkspaceDialog";

const meta = {
	version: 1,
	workspace: "old-one",
	owner: "dev",
	template: { id: "t1", name: "default", displayName: "DEFAULT" },
	templateVersionId: "v1",
	parameters: [
		{ name: "cpu", value: "4" },
		{ name: "memory", value: "8" },
	],
	homeGB: 10,
	takenAt: "2026-10-20T10:00:00Z",
};

const renderDialog = () =>
	render(
		<QueryClientProvider
			client={
				new QueryClient({ defaultOptions: { queries: { retry: false } } })
			}
		>
			<MemoryRouter>
				<RestoreWorkspaceDialog
					workspace={MockWorkspace}
					open
					onClose={() => {}}
				/>
			</MemoryRouter>
		</QueryClientProvider>,
	);

const plan = (allowed: boolean): RestorePlan => ({
	mode: "new",
	meta,
	source: "backup",
	template: { id: "t1", name: "DEFAULT" },
	quota: {
		allowed,
		message: allowed ? "within quota" : "Your workspace quota is reached (CPU)",
	},
});

describe("RestoreWorkspaceDialog", () => {
	beforeEach(() => {
		vi.spyOn(WorkspaceExtrasAPI, "volume").mockResolvedValue({
			volume: null,
			running: true,
			busy: false,
			backups: [],
			disk: [],
			restores: [],
			s3: false,
			keepHours: 24,
			maxGB: 2000,
		});
		vi.spyOn(WorkspaceExtrasAPI, "restoreSources").mockResolvedValue({
			s3: null,
		});
	});
	afterEach(() => vi.restoreAllMocks());

	it("names a restored workspace that fits Coder's names", () => {
		expect(restoredName("x".repeat(40))).toHaveLength(32);
		expect(WORKSPACE_NAME_RE.test(restoredName("x".repeat(40)))).toBe(true);
		expect(restoredName("old-one")).toBe("old-one-restored");
	});

	it("over quota: only the file's first bytes are sent, and nothing more", async () => {
		const inspect = vi
			.spyOn(WorkspaceExtrasAPI, "inspectFile")
			.mockResolvedValue(plan(false));
		const restore = vi.spyOn(WorkspaceExtrasAPI, "restoreFile");
		renderDialog();
		const file = new File([new Uint8Array(BACKUP_HEAD_BYTES * 3)], "b.tar.gz");
		fireEvent.change(await screen.findByTestId("restore-file"), {
			target: { files: [file] },
		});
		await waitFor(() =>
			expect(screen.getByTestId("restore-quota")).toHaveAttribute(
				"data-allowed",
				"false",
			),
		);
		expect(screen.getByTestId("restore-quota")).toHaveTextContent(
			"quota is reached",
		);
		expect(inspect.mock.calls[0][1]).toBe(file);
		expect(screen.getByTestId("restore-start")).toBeDisabled();
		expect(restore).not.toHaveBeenCalled();
	});

	it("within quota: the backup's own name, then created and restored", async () => {
		vi.spyOn(WorkspaceExtrasAPI, "inspectFile").mockResolvedValue(plan(true));
		const restore = vi
			.spyOn(WorkspaceExtrasAPI, "restoreFile")
			.mockResolvedValue({ restore: 1 });
		renderDialog();
		const file = new File([new Uint8Array(10)], "b.tar.gz");
		fireEvent.change(await screen.findByTestId("restore-file"), {
			target: { files: [file] },
		});
		await waitFor(() =>
			expect(screen.getByTestId("restore-name")).toHaveValue(
				"old-one-restored",
			),
		);
		await waitFor(() =>
			expect(screen.getByTestId("restore-start")).toBeEnabled(),
		);
		expect(screen.getByTestId("restore-plan")).toHaveTextContent("cpu 4");
		fireEvent.click(screen.getByTestId("restore-start"));
		await waitFor(() => expect(restore).toHaveBeenCalled());
		expect(restore.mock.calls[0].slice(1, 4)).toEqual([
			file,
			"new",
			"old-one-restored",
		]);
	});
});
