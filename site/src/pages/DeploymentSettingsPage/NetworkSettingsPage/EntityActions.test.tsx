import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClusterNetworkAPI, type EntityRef } from "#/api/clusterNetwork";
import { WorkspaceMigrationsAPI } from "#/api/workspaceMigrations";
import {
	MockNetworkAnsiPodLogs,
	MockNetworkLogPod,
	MockNetworkPodLogs,
} from "#/testHelpers/clusterNetwork";
import { render } from "#/testHelpers/renderHelpers";
import { MockWorkspaceMigrationPlan } from "#/testHelpers/workspaceMigrations";
import { EntityActionsProvider, EntityContextMenu } from "./EntityActions";

const auth = vi.hoisted(() => ({ admin: true }));
vi.mock("#/hooks/useAuthenticated", () => ({
	useAuthenticated: () => ({
		permissions: { editDeploymentConfig: auth.admin },
	}),
}));

const target: EntityRef = {
	type: "pod",
	name: MockNetworkLogPod.name,
	namespace: MockNetworkLogPod.namespace,
};
const show = () => {
	const details = vi.fn();
	render(
		<EntityActionsProvider onDetails={details} onOpen={vi.fn()}>
			<EntityContextMenu target={target}>
				<button type="button">Coder pod</button>
			</EntityContextMenu>
		</EntityActionsProvider>,
	);
	return details;
};
const menu = async (name: string) => {
	await userEvent.pointer({
		keys: "[MouseRight]",
		target: screen.getByRole("button", { name: "Coder pod" }),
	});
	await userEvent.click(await screen.findByRole("menuitem", { name }));
};

beforeEach(() => {
	auth.admin = false;
	vi.spyOn(ClusterNetworkAPI, "logTargets").mockResolvedValue({
		pods: [MockNetworkLogPod],
	});
	vi.spyOn(ClusterNetworkAPI, "podLogs").mockResolvedValue(MockNetworkPodLogs);
});
afterEach(() => vi.restoreAllMocks());

it("copies readable log text without terminal controls and preserves literal markup", async () => {
	vi.mocked(ClusterNetworkAPI.podLogs).mockResolvedValue(
		MockNetworkAnsiPodLogs,
	);
	const user = userEvent.setup();
	show();
	await menu("View Logs");
	await user.click(
		await screen.findByRole("textbox", { name: "Pod log output" }),
	);
	await user.keyboard("{Control>}a{/Control}");
	const copied = await user.copy();
	expect(copied?.getData("text/plain")).toBe(
		"2026-10-31T17:00:00Z INF server ready\n2026-10-31T17:00:01Z WRN upstream connection delayed: retrying request to http://coder.coder.svc.cluster.local:8080/api/v2/buildinfo after timeout\n2026-10-31T17:00:02Z literal <script>alert('log text')</script>\n",
	);
});

it("loads selected pod logs and changes container and previous instance", async () => {
	show();
	await menu("View Logs");
	await waitFor(() =>
		expect(ClusterNetworkAPI.podLogs).toHaveBeenCalledWith(
			MockNetworkLogPod,
			"coder",
			false,
		),
	);
	await userEvent.selectOptions(
		screen.getByRole("combobox", { name: "Container" }),
		"init",
	);
	await waitFor(() =>
		expect(ClusterNetworkAPI.podLogs).toHaveBeenCalledWith(
			MockNetworkLogPod,
			"init",
			false,
		),
	);
	await userEvent.click(
		screen.getByRole("checkbox", { name: "Previous container" }),
	);
	await waitFor(() =>
		expect(ClusterNetworkAPI.podLogs).toHaveBeenCalledWith(
			MockNetworkLogPod,
			"init",
			true,
		),
	);
});

it("Details uses the existing Kubernetes entity panel", async () => {
	const details = show();
	await menu("Details");
	expect(details).toHaveBeenCalledWith(target);
	expect(ClusterNetworkAPI.logTargets).not.toHaveBeenCalled();
});

it("requires the exact pod name before submitting a UID-bound restart", async () => {
	const restart = vi
		.spyOn(ClusterNetworkAPI, "restartPod")
		.mockResolvedValue({ accepted: true, message: "Restart requested" });
	show();
	await menu("Restart Pod");
	const button = await screen.findByRole("button", { name: "Restart Pod" });
	await userEvent.click(button);
	expect(restart).not.toHaveBeenCalled();
	await userEvent.type(
		screen.getByRole("textbox", { name: "Type the pod name to confirm" }),
		MockNetworkLogPod.name,
	);
	await userEvent.click(button);
	await waitFor(() =>
		expect(restart).toHaveBeenCalledWith(
			MockNetworkLogPod,
			MockNetworkLogPod.name,
		),
	);
});

it("does not send restart requests for unmanaged pods", async () => {
	vi.mocked(ClusterNetworkAPI.logTargets).mockResolvedValue({
		pods: [
			{
				...MockNetworkLogPod,
				restartable: false,
				restartReason: "No controller",
			},
		],
	});
	const restart = vi.spyOn(ClusterNetworkAPI, "restartPod");
	show();
	await menu("Restart Pod");
	await userEvent.click(
		await screen.findByRole("button", { name: "Restart Pod" }),
	);
	expect(restart).not.toHaveBeenCalled();
});

describe("Migrate to node", () => {
	const workspacePod = {
		...MockNetworkLogPod,
		workspaceId: MockWorkspaceMigrationPlan.workspaceId,
		workspaceName: MockWorkspaceMigrationPlan.workspaceName,
	};
	beforeEach(() => {
		auth.admin = true;
	});
	const open = async () => {
		await userEvent.pointer({
			keys: "[MouseRight]",
			target: screen.getByRole("button", { name: "Coder pod" }),
		});
		await screen.findByRole("menuitem", { name: "View Logs" });
	};

	it("opens the migration dialog for a workspace pod, excluding its node", async () => {
		vi.mocked(ClusterNetworkAPI.logTargets).mockResolvedValue({
			pods: [workspacePod],
		});
		const plan = vi
			.spyOn(WorkspaceMigrationsAPI, "plan")
			.mockResolvedValue(MockWorkspaceMigrationPlan);
		show();
		await open();
		await userEvent.click(
			await screen.findByRole("menuitem", { name: "Migrate to node..." }),
		);
		expect(
			await screen.findByRole("button", { name: "Migrate to worker-02" }),
		).toBeInTheDocument();
		expect(plan).toHaveBeenCalledWith(workspacePod.workspaceId);
		expect(
			screen.queryByRole("button", {
				name: `Migrate to ${MockWorkspaceMigrationPlan.sourceNode}`,
			}),
		).not.toBeInTheDocument();
	});

	it("is absent for system pods", async () => {
		const plan = vi.spyOn(WorkspaceMigrationsAPI, "plan");
		show();
		await open();
		await waitFor(() =>
			expect(ClusterNetworkAPI.logTargets).toHaveBeenCalled(),
		);
		expect(
			screen.queryByRole("menuitem", { name: /Migrate to node/ }),
		).not.toBeInTheDocument();
		expect(plan).not.toHaveBeenCalled();
	});

	it("is absent for non-admins", async () => {
		auth.admin = false;
		vi.mocked(ClusterNetworkAPI.logTargets).mockResolvedValue({
			pods: [workspacePod],
		});
		show();
		await open();
		expect(
			screen.queryByRole("menuitem", { name: /Migrate to node/ }),
		).not.toBeInTheDocument();
		expect(ClusterNetworkAPI.logTargets).not.toHaveBeenCalled();
	});

	it("is disabled with the reason for an ineligible workspace", async () => {
		vi.mocked(ClusterNetworkAPI.logTargets).mockResolvedValue({
			pods: [workspacePod],
		});
		vi.spyOn(WorkspaceMigrationsAPI, "plan").mockRejectedValue(
			new Error("This workspace uses another storage type."),
		);
		show();
		await open();
		const item = await screen.findByRole("menuitem", {
			name: /Migrate to node/,
		});
		await waitFor(() => expect(item).toHaveAttribute("aria-disabled", "true"));
		expect(item).toHaveTextContent("This workspace uses another storage type.");
	});
});
