import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "react-query";
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
	MockPodDetails,
} from "#/testHelpers/clusterNetwork";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { MockResizeObserver } from "#/testHelpers/resizeObserver";
import { ClusterMap } from "./ClusterMap";

const renderMap = () =>
	renderComponent(
		<QueryClientProvider
			client={
				new QueryClient({ defaultOptions: { queries: { retry: false } } })
			}
		>
			<ClusterMap />
		</QueryClientProvider>,
	);

describe("ClusterMap", () => {
	let entity: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		MockResizeObserver.reset();
		vi.stubGlobal("ResizeObserver", MockResizeObserver);
		vi.spyOn(PlatformAPI, "getNetworkReport").mockResolvedValue(
			MockClusterNetworkReport,
		);
		vi.spyOn(ClusterNetworkAPI, "mesh").mockResolvedValue(MockMeshReport);
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
		expect(
			within(card).getByTestId("storage-class-local-path"),
		).toHaveTextContent("default");
		expect(within(card).getByTestId("cloud-drive")).toHaveTextContent(
			"coder-safe-u1",
		);
		// the released volume shows once asked for
		expect(within(card).queryByText("coder-safe-u2")).not.toBeInTheDocument();
		fireEvent.click(within(card).getByRole("button", { name: /Show all 2/ }));
		expect(within(card).getByText("coder-safe-u2")).toBeInTheDocument();
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
