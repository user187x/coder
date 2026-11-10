import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { API } from "#/api/api";
import { PlatformAPI, PlatformError } from "#/api/platform";
import type { Workspace } from "#/api/typesGenerated";
import { MockUserMember, MockWorkspace } from "#/testHelpers/entities";
import { render } from "#/testHelpers/renderHelpers";
import TrafficControlPage from "./TrafficControlPage";

const auth = vi.hoisted(() => ({ admin: false }));
vi.mock("#/hooks/useAuthenticated", () => ({
	useAuthenticated: () => ({
		user: MockUserMember,
		permissions: { viewDeploymentConfig: auth.admin },
	}),
}));

const workspace = (id: string, name: string): Workspace => ({
	...MockWorkspace,
	id,
	name,
	latest_build: {
		...MockWorkspace.latest_build,
		status: "running",
		resources: [
			{
				...MockWorkspace.latest_build.resources[0],
				agents: [
					{
						...(MockWorkspace.latest_build.resources[0].agents ?? [])[0],
						id: `${id}-agent`,
					},
				],
			},
		],
	},
});

const setup = (
	workspaces: Workspace[] = [workspace("web", "web"), workspace("db", "db")],
) => {
	const list = vi.spyOn(API, "getWorkspaces").mockResolvedValue({
		workspaces,
		count: workspaces.length,
	});
	vi.spyOn(PlatformAPI, "getWorkspaceTunnels").mockResolvedValue({
		tunnels: [
			{
				id: "t1",
				organization_id: MockWorkspace.organization_id,
				source_workspace_id: "web",
				target_workspace_id: "db",
				status: "ready",
				ports: [{ protocol: "tcp", port: 5432 }],
			},
		],
	});
	vi.spyOn(API, "getWorkspaceAgentSharedPorts").mockImplementation(
		async (id) => ({
			shares:
				id === "web"
					? [
							{
								workspace_id: "web",
								agent_name: "main",
								port: 3000,
								share_level: "public",
								protocol: "http",
							},
						]
					: [],
		}),
	);
	const { router } = render(<TrafficControlPage />);
	return { list, router };
};

afterEach(() => {
	auth.admin = false;
	vi.restoreAllMocks();
});

it("draws the workspaces' shared ports and tunnels, source to target", async () => {
	setup();
	const diagram = await screen.findByRole("group", {
		name: /Traffic: .*:3000 public.*web.*Tunnel Ports :5432 tcp.*db/,
	});
	expect(diagram).toHaveAccessibleName(
		"Traffic: Input Ports :3000 public → web → Tunnel Ports :5432 tcp → db",
	);
	expect(screen.getByRole("region", { name: "web → db" })).toHaveTextContent(
		"1 of 1 tunnel connected",
	);
});

it("shows members their own workspaces, with no cluster switch", async () => {
	const { list } = setup();
	await screen.findByRole("region", { name: "web → db" });
	expect(list).toHaveBeenCalledWith({ q: "owner:me" });
	expect(screen.queryByRole("group", { name: "Show traffic of" })).toBeNull();
});

it("lets an admin switch to every workspace in the cluster", async () => {
	auth.admin = true;
	const { list } = setup();
	const user = userEvent.setup();
	await screen.findByRole("region", { name: "web → db" });
	await user.click(screen.getByRole("button", { name: "Whole cluster" }));
	await waitFor(() => expect(list).toHaveBeenCalledWith({ q: "" }));
});

it("counts the open ports of the workspace clicked on", async () => {
	setup();
	vi.spyOn(API, "getAgentListeningPorts").mockResolvedValue({
		ports: [
			{ process_name: "node", network: "tcp", port: 3000 },
			{ process_name: "node", network: "tcp", port: 3000 },
			{ process_name: "sshd", network: "tcp", port: 22 },
		],
	});
	const user = userEvent.setup();
	// once the tunnels are in: until then web is drawn among the standalone workspaces
	const chain = await screen.findByRole("region", { name: "web → db" });
	await user.click(
		within(chain).getByRole("button", { name: "web: show its open ports" }),
	);
	expect(
		await screen.findByRole("status", { name: "web: 2 open ports" }),
	).toHaveTextContent("web · 2 open ports");
});

it("stops sharing an input port, or narrows it, from its menu", async () => {
	setup();
	const remove = vi
		.spyOn(API, "deleteWorkspaceAgentSharedPort")
		.mockResolvedValue({ shares: [] });
	const upsert = vi
		.spyOn(API, "upsertWorkspaceAgentSharedPort")
		.mockResolvedValue({ shares: [] });
	const user = userEvent.setup();
	const diagram = await screen.findByRole("group", { name: /:3000 public/ });
	const orb = within(diagram).getByText(":3000");
	fireEvent.contextMenu(orb);
	await user.click(await screen.findByRole("menuitem", { name: /Terminate/ }));
	await waitFor(() =>
		expect(remove).toHaveBeenCalledWith("web", {
			agent_name: "main",
			port: 3000,
		}),
	);
	fireEvent.contextMenu(orb);
	await user.click(
		await screen.findByRole("menuitem", { name: "Restrict to owner only" }),
	);
	await waitFor(() =>
		expect(upsert).toHaveBeenCalledWith("web", {
			agent_name: "main",
			port: 3000,
			protocol: "http",
			share_level: "owner",
		}),
	);
});

it("opens a workspace from its menu", async () => {
	const { router } = setup();
	const user = userEvent.setup();
	const chain = await screen.findByRole("region", { name: "web → db" });
	fireEvent.contextMenu(
		within(chain).getByRole("button", { name: "db: show its open ports" }),
	);
	await user.click(
		await screen.findByRole("menuitem", { name: "Open workspace" }),
	);
	await waitFor(() =>
		expect(router.state.location.pathname).toBe(
			`/@${MockWorkspace.owner_name}/db`,
		),
	);
});

it("marks a connected workspace that went down: grey, with a dead face", async () => {
	const db = workspace("db", "db");
	setup([
		workspace("web", "web"),
		{ ...db, latest_build: { ...db.latest_build, status: "stopped" } },
	]);
	await screen.findByRole("group", { name: /Traffic:/ });
	expect(screen.getAllByTestId("dead-workspace-face")).toHaveLength(1);
});

it("maps a tunnel's input port to another output port from its badge", async () => {
	const user = userEvent.setup();
	setup();
	vi.mocked(PlatformAPI.getWorkspaceTunnels).mockResolvedValue({
		tunnels: [
			{
				id: "t1",
				organization_id: MockWorkspace.organization_id,
				source_workspace_id: "web",
				target_workspace_id: "db",
				source_workspace_name: "web",
				target_workspace_name: "db",
				status: "ready",
				revision: 3,
				port_mapping_supported: true,
				ports: [{ protocol: "tcp", port: 5432 }],
			},
		],
	});
	const save = vi
		.spyOn(PlatformAPI, "updateWorkspaceTunnelPorts")
		.mockResolvedValue({ tunnel: {} as never });
	const [badge] = await screen.findAllByRole("button", {
		name: "Tunnel ports",
	});
	await user.click(badge);
	const dialog = await screen.findByRole("dialog", {
		name: /Tunnel ports: web → db/,
	});
	const output = within(dialog).getByRole("spinbutton", {
		name: "Mapping 1 output port",
	});
	await user.clear(output);
	await user.type(output, "6543");
	await user.click(within(dialog).getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith(MockWorkspace.organization_id, "t1", 3, [
			{ protocol: "tcp", port: 5432, target_port: 6543 },
		]),
	);
});

it("listens on a workspace's port through its terminal where it has no tunnel helper", async () => {
	const user = userEvent.setup();
	const sockets: FakeSocket[] = [];
	class FakeSocket extends EventTarget {
		readyState = 1;
		binaryType = "blob";
		constructor(readonly url: string) {
			super();
			sockets.push(this);
		}
		send() {}
		close() {}
	}
	vi.stubGlobal("WebSocket", Object.assign(FakeSocket, { OPEN: 1 }));
	vi.spyOn(PlatformAPI, "startTrafficTest").mockRejectedValue(
		new PlatformError("no tunnel helper", 404),
	);
	setup();
	const chain = await screen.findByRole("region", { name: "web → db" });
	fireEvent.contextMenu(
		within(chain).getByRole("button", { name: "db: show its open ports" }),
	);
	await user.click(
		await screen.findByRole("menuitem", { name: "Test Listen…" }),
	);
	const dialog = await screen.findByRole("dialog", { name: /Test Listen: db/ });
	await user.type(
		within(dialog).getByRole("spinbutton", { name: "Port" }),
		"7777",
	);
	await user.click(
		within(dialog).getByRole("button", { name: "Start listening" }),
	);
	await waitFor(() => expect(sockets).toHaveLength(1));
	expect(decodeURIComponent(sockets[0].url)).toContain("7777");
	sockets[0].dispatchEvent(
		new MessageEvent("message", {
			data: "LISTEN 7777\r\nRECV 10.253.0.35\r\n",
		}),
	);
	expect(await screen.findByTestId("ack-ripple")).toBeTruthy();
	vi.unstubAllGlobals();
});

it("listens in the workspace's tunnel helper and ripples its orb at each ACK it counts", async () => {
	const user = userEvent.setup();
	const start = vi
		.spyOn(PlatformAPI, "startTrafficTest")
		.mockImplementation(async (_org, _ws, kind, port) => ({
			test: {
				kind,
				port,
				sent: 0,
				failed: 0,
				received: 0,
				listening: true,
				running: true,
				error: null,
			},
		}));
	vi.spyOn(PlatformAPI, "getTrafficTests").mockImplementation(
		async (_org, [id]) => ({
			tests: {
				[id]: {
					listen: {
						kind: "listen",
						port: 8888,
						sent: 0,
						failed: 0,
						received: 2,
						listening: true,
						running: true,
						error: null,
					},
				},
			},
		}),
	);
	setup();
	const chain = await screen.findByRole("region", { name: "web → db" });
	const orb = within(chain).getByRole("button", {
		name: "db: show its open ports",
	});
	fireEvent.contextMenu(orb);
	// A listener the previous test left running (the tests' store outlives a render) is stopped first.
	const stopIt = screen.queryByRole("menuitem", { name: /Stop test listen/ });
	if (stopIt) {
		await user.click(stopIt);
		fireEvent.contextMenu(orb);
	}
	await user.click(
		await screen.findByRole("menuitem", { name: "Test Listen…" }),
	);
	const dialog = await screen.findByRole("dialog", { name: /Test Listen: db/ });
	await user.type(
		within(dialog).getByRole("spinbutton", { name: "Port" }),
		"8888",
	);
	await user.click(
		within(dialog).getByRole("button", { name: "Start listening" }),
	);
	await waitFor(() =>
		expect(start).toHaveBeenCalledWith(
			expect.any(String),
			expect.any(String),
			"listen",
			8888,
			[],
		),
	);
	expect(
		await screen.findByTestId("ack-ripple", {}, { timeout: 3000 }),
	).toBeTruthy();
});
