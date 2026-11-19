import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "react-query";
import { MemoryRouter } from "react-router";
import {
	ClusterNetworkAPI,
	type EntityDetails,
	type EntityRef,
} from "#/api/clusterNetwork";
import { PlatformAPI } from "#/api/platform";
import {
	MockClusterNetworkReport,
	MockHAStorageReport,
	MockMeshReport,
	MockNetworkLogPod,
	MockNetworkPodLogs,
	MockPodDetails,
} from "#/testHelpers/clusterNetwork";
import { MockPersistenceReportCloud } from "#/testHelpers/platform";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { MockResizeObserver } from "#/testHelpers/resizeObserver";
import { StorageView } from "../StorageSettingsPage";
import { ClusterMap } from "./ClusterMap";

vi.mock("#/hooks/useAuthenticated", () => ({
	useAuthenticated: () => ({ permissions: { editDeploymentConfig: false } }),
}));

const renderMap = (view = <ClusterMap />) =>
	renderComponent(
		<QueryClientProvider
			client={
				new QueryClient({ defaultOptions: { queries: { retry: false } } })
			}
		>
			<MemoryRouter>{view}</MemoryRouter>
		</QueryClientProvider>,
	);

describe("ClusterMap", () => {
	let entity: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		MockResizeObserver.reset();
		vi.stubGlobal("ResizeObserver", MockResizeObserver);
		vi.spyOn(PlatformAPI, "getPersistenceReport").mockRejectedValue(
			new Error("No database fixture"),
		);
		vi.spyOn(PlatformAPI, "getNetworkReport").mockResolvedValue(
			MockClusterNetworkReport,
		);
		vi.spyOn(ClusterNetworkAPI, "mesh").mockResolvedValue(MockMeshReport);
		vi.spyOn(ClusterNetworkAPI, "getCloudDriveCleanup").mockResolvedValue({
			scan: null,
		});
		vi.spyOn(ClusterNetworkAPI, "haAndStorage").mockResolvedValue(
			MockHAStorageReport,
		);
		entity = vi
			.spyOn(ClusterNetworkAPI, "entity")
			.mockImplementation(async (ref: EntityRef): Promise<EntityDetails> => {
				if (ref.type === "link") {
					const e = MockMeshReport.edges.find((x) => x.id === ref.id);
					if (!e) {
						throw new Error("no such connection");
					}
					return {
						...e,
						type: "link",
						from: { id: e.from, kind: "platform", label: "Platform service" },
						to: { id: e.to, kind: "coder", label: "Coder" },
						history: [["2026-09-30T10:04:55Z", e.ms]],
					};
				}
				return MockPodDetails;
			});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it.each(["View Logs", "Restart Pod", "Details"])(
		"opens %s from a service in the services strip",
		async (action) => {
			const targets = vi
				.spyOn(ClusterNetworkAPI, "logTargets")
				.mockResolvedValue({ pods: [MockNetworkLogPod] });
			vi.spyOn(ClusterNetworkAPI, "podLogs").mockResolvedValue(
				MockNetworkPodLogs,
			);
			const user = userEvent.setup();
			renderMap();
			await user.pointer({
				keys: "[MouseRight]",
				target: await screen.findByRole("button", { name: /^coder-db-rw/ }),
			});
			await user.click(await screen.findByRole("menuitem", { name: action }));
			await waitFor(() =>
				expect(action === "Details" ? entity : targets).toHaveBeenCalledWith({
					type: "service",
					namespace: "coder",
					name: "coder-db-rw",
				}),
			);
		},
	);

	it("pans the fullscreen map with the middle button and stops on release", async () => {
		renderMap();
		const map = await screen.findByTestId("cluster-map");
		const capture = vi.fn();
		Object.defineProperty(map, "setPointerCapture", {
			configurable: true,
			value: capture,
		});
		const fullscreen = Object.getOwnPropertyDescriptor(
			document,
			"fullscreenElement",
		);
		Object.defineProperty(document, "fullscreenElement", {
			configurable: true,
			value: map,
		});
		fireEvent(document, new Event("fullscreenchange"));
		const pointer = (type: string, x: number, y: number) => {
			const event = new MouseEvent(type, {
				bubbles: true,
				button: 1,
				clientX: x,
				clientY: y,
			});
			Object.defineProperty(event, "pointerId", { value: 4 });
			fireEvent(map, event);
		};
		pointer("pointerdown", 100, 100);
		pointer("pointermove", 40, 25);
		expect(capture).toHaveBeenCalledWith(4);
		expect([map.scrollLeft, map.scrollTop]).toEqual([60, 75]);
		pointer("pointerup", 40, 25);
		pointer("pointermove", 0, 0);
		expect([map.scrollLeft, map.scrollTop]).toEqual([60, 75]);
		if (fullscreen)
			Object.defineProperty(document, "fullscreenElement", fullscreen);
		else Reflect.deleteProperty(document, "fullscreenElement");
	});

	it("colours every pod and Service by its kind, and names the colours", async () => {
		renderMap();
		const coder = await screen.findByTestId("cluster-map-pod-coder-5d9f7c");
		expect(coder).toHaveAttribute("data-kind", "coder");
		expect(screen.getByTestId("cluster-map-pod-coder-db-1")).toHaveAttribute(
			"data-kind",
			"database",
		);
		const traefik = screen.getByTestId("cluster-map-pod-traefik-6d-x");
		expect(traefik).toHaveAttribute("data-kind", "gateway");
		expect(within(traefik).getByLabelText("not ready")).toBeInTheDocument();
		expect(screen.getByTestId("cluster-map-pod-coder-ws-dev")).toHaveAttribute(
			"data-kind",
			"workspace",
		);
		expect(
			screen.getByTestId("cluster-map-service-traefik-traefik"),
		).toHaveAttribute("data-kind", "gateway");
		const legend = within(screen.getByTestId("cluster-map")).getByLabelText(
			"Colours by kind",
		);
		for (const kind of [
			"gateway",
			"coder",
			"database",
			"workspace",
			"replicator",
		]) {
			expect(
				within(legend).getByTestId(`kind-legend-${kind}`),
			).toBeInTheDocument();
		}
	});

	it("opens entrance route details through the gateway pod", async () => {
		const user = userEvent.setup();
		renderMap();
		await user.click(
			await screen.findByRole("button", {
				name: "Entrance route → traefik/traefik-6d-x (endpoint unhealthy)",
			}),
		);
		await waitFor(() =>
			expect(entity).toHaveBeenCalledWith({
				type: "link",
				id: "gateway-coder",
			}),
		);
	});

	it("requests native fullscreen for the cluster map", async () => {
		const user = userEvent.setup();
		renderMap();
		const map = await screen.findByRole("region", { name: "Cluster map" });
		const requestFullscreen = vi.fn().mockResolvedValue(undefined);
		Object.assign(map, { requestFullscreen });
		await user.click(
			await within(map).findByRole("button", { name: "Fullscreen" }),
		);
		expect(requestFullscreen).toHaveBeenCalledOnce();
	});

	it("opens a pod's details from the map", async () => {
		renderMap();
		fireEvent.click(await screen.findByTestId("cluster-map-pod-coder-5d9f7c"));
		const panel = await screen.findByTestId("entity-details-pod");
		expect(entity).toHaveBeenCalledWith({
			type: "pod",
			namespace: "coder",
			name: "coder-5d9f7c",
		});
		expect(within(panel).getByText(/OOMKilled/)).toBeInTheDocument();
		expect(within(panel).getByText(/Deployment coder/)).toBeInTheDocument();
		// a link inside the panel opens the next entity, and Back returns
		fireEvent.click(within(panel).getByRole("button", { name: "node-a" }));
		await waitFor(() =>
			expect(entity).toHaveBeenLastCalledWith({ type: "node", name: "node-a" }),
		);
		expect(screen.getByTestId("entity-back")).toBeInTheDocument();
	});

	it("labels each connection of the mesh with its measurement, or says why there is none", async () => {
		renderMap();
		const card = await screen.findByTestId("cluster-mesh-card");
		expect(
			await within(card).findByTestId("mesh-edge-label-gateway-coder"),
		).toHaveTextContent("0.44 ms");
		expect(
			within(card).getByTestId("mesh-edge-workspaces-code-server"),
		).toHaveAttribute("data-measured", "no");
		expect(
			within(card).getByTestId("mesh-edge-label-platform-replicas"),
		).toHaveTextContent("failed");
		expect(
			within(card).getByTestId("mesh-edge-workspaces-code-server"),
		).toHaveAccessibleName(/why workspaces-code-server has no number/);
		fireEvent.click(within(card).getByTestId("mesh-edge-platform-coder"));
		const panel = await screen.findByTestId("entity-details-link");
		expect(within(panel).getByTestId("link-latency")).toHaveTextContent(
			"1.5 ms",
		);
		expect(
			within(panel).getByText(/coder-0 10.42.0.10:8080/),
		).toBeInTheDocument();
	});

	it("sorts recent hand-offs by timestamp in both directions", async () => {
		const ha = MockHAStorageReport.codeServerHA;
		vi.mocked(ClusterNetworkAPI.haAndStorage).mockResolvedValue({
			...MockHAStorageReport,
			codeServerHA: {
				...ha,
				events: [
					...ha.events,
					{
						at: "2026-10-01T10:00:00Z",
						workspaceId: null,
						cluster: null,
						event: "start",
						detail: "Newer hand-off",
					},
				],
			},
		});
		const user = userEvent.setup();
		renderMap();
		const recent = within(await screen.findByTestId("ha-events"));
		expect(recent.getAllByRole("listitem")[0]).toHaveTextContent(
			"Newer hand-off",
		);
		await user.click(recent.getByRole("button", { name: "Newest first" }));
		expect(recent.getAllByRole("listitem")[1]).toHaveTextContent(
			"Newer hand-off",
		);
		await user.click(recent.getByRole("button", { name: "Oldest first" }));
		expect(recent.getAllByRole("listitem")[0]).toHaveTextContent(
			"Newer hand-off",
		);
	});

	it("shows code-server HA as it is: who holds the lock, each instance and its relay", async () => {
		renderMap();
		const card = await screen.findByTestId("cluster-ha-card");
		const reps = await within(card).findByTestId("ha-replicators");
		expect(
			within(reps).getByTestId(
				"ha-replicator-coder-code-server-replicator-7f-a",
			),
		).toHaveTextContent("holds the lock");
		expect(
			within(reps).getByTestId(
				"ha-replicator-coder-code-server-replicator-7f-b",
			),
		).toHaveTextContent("waits (standby)");
		const row = within(card).getByTestId(
			"ha-instance-11111111-2222-3333-4444-555555555555",
		);
		expect(row).toHaveTextContent("gen 3");
		expect(row).toHaveTextContent("gen 2: relays on until fenced");
		expect(row).toHaveTextContent("4 files");
		expect(within(card).queryByTestId("cloud-drive")).not.toBeInTheDocument();
	});

	it("shows Storage classes and Cloud Drive volumes in Storage", async () => {
		renderMap(<StorageView />);
		expect(
			await screen.findByTestId("storage-class-local-path"),
		).toHaveTextContent("default");
		const drive = await screen.findByTestId("cloud-drive");
		expect(drive).toHaveTextContent("coder-safe-u1");
		expect(within(drive).queryByText("coder-safe-u2")).not.toBeInTheDocument();
		fireEvent.click(within(drive).getByRole("button", { name: /Show all 2/ }));
		expect(within(drive).getByText("coder-safe-u2")).toBeInTheDocument();
	});

	it("connects a claim to its backing volume and keeps database operations in Storage", async () => {
		const user = userEvent.setup();
		vi.mocked(PlatformAPI.getPersistenceReport).mockResolvedValue(
			MockPersistenceReportCloud,
		);
		renderMap(<StorageView />);
		expect(
			await screen.findByRole("heading", { name: "Database map" }),
		).toBeVisible();
		expect(
			await screen.findByRole("heading", { name: "Disaster recovery" }),
		).toBeVisible();
		await user.click(await screen.findByRole("button", { name: "Pending 1" }));
		expect(screen.getByText("other/data")).toBeVisible();
		expect(screen.queryByText("coder/data")).not.toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "All resources" }));
		await user.click(
			screen.getByRole("button", { name: "Inspect binding to pv-data" }),
		);
		const binding = screen.getByRole("region", { name: "Volume binding" });
		expect(within(binding).getByText("coder/data")).toBeVisible();
		expect(within(binding).getByText("db-1")).toBeVisible();
		expect(screen.queryByText("other/data")).not.toBeInTheDocument();
		await user.click(
			within(binding).getByRole("button", { name: "Clear binding" }),
		);
		expect(screen.getByText("other/data")).toBeVisible();
		expect(PlatformAPI.getPersistenceReport).toHaveBeenCalledWith(true);
	});

	it("reviews a cleanup scan and dismisses all flagged volumes without deleting them", async () => {
		const user = userEvent.setup();
		const start = vi
			.spyOn(ClusterNetworkAPI, "startCloudDriveCleanup")
			.mockResolvedValue({
				scan: {
					id: "scan",
					status: "ready",
					candidates: [{ name: "coder-safe-u2", account: "removed" }],
				},
			});
		const review = vi
			.spyOn(ClusterNetworkAPI, "reviewCloudDriveCleanup")
			.mockResolvedValue({
				scan: { id: "scan", status: "complete", kept: 1 },
			});
		const remove = vi.spyOn(ClusterNetworkAPI, "deleteCloudDriveVolumes");
		renderMap(<StorageView />);
		await user.click(await screen.findByRole("button", { name: "Clean Up" }));
		expect(start).toHaveBeenCalledOnce();
		await user.click(
			await screen.findByRole("button", { name: "Review cleanup" }),
		);
		const dialog = await screen.findByRole("dialog", {
			name: "Review Cloud Drive cleanup",
		});
		await user.click(
			within(dialog).getByRole("button", { name: "Keep all and dismiss" }),
		);
		expect(review).toHaveBeenCalledExactlyOnceWith({ id: "scan", names: [] });
		expect(remove).not.toHaveBeenCalled();
		await screen.findByRole("button", { name: "Clean Up" });
	});

	it("deletes an unmounted Cloud Drive volume after confirming, never a mounted one", async () => {
		const remove = vi
			.spyOn(ClusterNetworkAPI, "deleteCloudDriveVolumes")
			.mockResolvedValue({ deleted: ["coder-safe-u2"], skipped: [] });
		renderMap(<StorageView />);
		const drive = await screen.findByTestId("cloud-drive");
		expect(
			within(drive).getByRole("button", {
				name: "Delete volume coder-safe-u1",
			}),
		).toBeDisabled();
		fireEvent.click(
			within(drive).getByRole("button", {
				name: "Delete unmounted volumes (1)",
			}),
		);
		const dialog = await screen.findByRole("dialog");
		fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
		await waitFor(() =>
			expect(remove).toHaveBeenCalledExactlyOnceWith(["coder-safe-u2"]),
		);
	});

	it("deletes the ticked Cloud Drive volumes in bulk, never a mounted one", async () => {
		const remove = vi
			.spyOn(ClusterNetworkAPI, "deleteCloudDriveVolumes")
			.mockResolvedValue({ deleted: ["coder-safe-u2"], skipped: [] });
		renderMap(<StorageView />);
		const drive = await screen.findByTestId("cloud-drive");
		// the unmounted one is Released, listed once every volume is shown
		fireEvent.click(within(drive).getByRole("button", { name: /Show all 2/ }));
		expect(
			within(drive).getByRole("checkbox", {
				name: "Select volume coder-safe-u1",
			}),
		).toBeDisabled();
		fireEvent.click(
			within(drive).getByRole("checkbox", {
				name: "Select every unmounted volume shown",
			}),
		);
		fireEvent.click(
			within(drive).getByRole("button", { name: "Delete selected (1)" }),
		);
		const dialog = await screen.findByRole("dialog");
		fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
		await waitFor(() =>
			expect(remove).toHaveBeenCalledExactlyOnceWith(["coder-safe-u2"]),
		);
	});

	it("places every component in the node it runs on", async () => {
		renderMap();
		const card = await screen.findByTestId("cluster-nodes-card");
		const a = within(card).getByTestId("topology-node-node-a");
		const b = within(card).getByTestId("topology-node-node-b");
		expect(within(a).getByTestId("topology-pod-coder-5d9f7c")).toHaveAttribute(
			"data-kind",
			"coder",
		);
		expect(
			within(a).getByTestId("topology-pod-traefik-6d-x"),
		).toBeInTheDocument();
		expect(
			within(b).getByTestId("topology-pod-coder-db-1"),
		).toBeInTheDocument();
		expect(
			within(b).getByTestId("topology-pod-coder-ws-dev"),
		).toBeInTheDocument();
		expect(within(card).getByTestId("topology-spread")).toBeInTheDocument();
	});
});
