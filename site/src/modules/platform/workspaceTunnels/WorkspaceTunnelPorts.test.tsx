import {
	act,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "react-query";
import { PlatformAPI, type WorkspaceTunnel } from "#/api/platform";
import { workspaceTunnels } from "#/api/queries/workspaceTunnels";
import { MockWorkspace } from "#/testHelpers/entities";
import { MockResizeObserver } from "#/testHelpers/resizeObserver";
import { MockWorkspaceTunnel } from "#/testHelpers/workspaceTunnels";
import { WorkspaceTunnelPorts } from "./WorkspaceTunnelPorts";

const source = {
	...MockWorkspace,
	id: "source",
	name: "Alpha",
	latest_build: { ...MockWorkspace.latest_build, status: "running" as const },
};
const target = { ...source, id: "target", name: "Beta" };
const tunnel: WorkspaceTunnel = {
	...MockWorkspaceTunnel,
	source_workspace_id: source.id,
	target_workspace_id: target.id,
};
const setup = (
	tunnels: WorkspaceTunnel[] = [],
	onDragging = vi.fn(),
	options: Partial<React.ComponentProps<typeof WorkspaceTunnelPorts>> = {},
) => {
	vi.spyOn(PlatformAPI, "getWorkspaceTunnels").mockResolvedValue({ tunnels });
	render(
		<QueryClientProvider
			client={
				new QueryClient({ defaultOptions: { queries: { retry: false } } })
			}
		>
			<WorkspaceTunnelPorts
				shown={[source, target]}
				cols={2}
				cellW={400}
				cellH={300}
				gap={12}
				onDragging={onDragging}
				{...options}
			/>
		</QueryClientProvider>,
	);
	return userEvent.setup();
};
beforeEach(() => {
	MockResizeObserver.reset();
	vi.stubGlobal("ResizeObserver", MockResizeObserver);
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
it("connects workspaces through keyboard management", async () => {
	const create = vi
		.spyOn(PlatformAPI, "createWorkspaceTunnel")
		.mockResolvedValue({ tunnel: { ...tunnel, status: "pending" } });
	const user = setup();
	screen
		.getByRole("button", { name: "Connect Alpha right output tunnel port" })
		.focus();
	await user.keyboard("{Enter}");
	await user.click(await screen.findByRole("button", { name: "Connect" }));
	await waitFor(() =>
		expect(create).toHaveBeenCalledWith(
			source.organization_id,
			source.id,
			target.id,
			"right",
			"left",
		),
	);
});
it("disconnects the persisted tunnel", async () => {
	const remove = vi
		.spyOn(PlatformAPI, "deleteWorkspaceTunnel")
		.mockResolvedValue({ tunnel: { ...tunnel, status: "disconnecting" } });
	const user = setup([tunnel]);
	screen
		.getByRole("button", { name: "Connect Alpha right output tunnel port" })
		.focus();
	await user.keyboard("{Enter}");
	await user.click(await screen.findByRole("button", { name: "Disconnect" }));
	await waitFor(() =>
		expect(remove).toHaveBeenCalledWith(source.organization_id, tunnel.id),
	);
});

it("keeps the selected port sides when connecting by dragging", async () => {
	const create = vi
		.spyOn(PlatformAPI, "createWorkspaceTunnel")
		.mockResolvedValue({
			tunnel: {
				...tunnel,
				status: "pending",
				source_side: "left",
				target_side: "right",
			},
		});
	const user = setup();
	await waitFor(() =>
		expect(PlatformAPI.getWorkspaceTunnels).toHaveBeenCalled(),
	);
	const from = screen.getByRole("button", {
		name: "Connect Beta left input tunnel port",
	});
	const to = screen.getByRole("button", {
		name: "Connect Alpha right output tunnel port",
	});
	await user.pointer([
		{
			keys: "[MouseLeft>]",
			target: from,
			coords: { clientX: 420, clientY: 138 },
		},
		{ target: to, coords: { clientX: 392, clientY: 162 } },
		{
			keys: "[/MouseLeft]",
			target: to,
			coords: { clientX: 392, clientY: 162 },
		},
	]);
	await waitFor(() =>
		expect(create).toHaveBeenCalledWith(
			source.organization_id,
			source.id,
			target.id,
			"right",
			"left",
		),
	);
});

it("cancels a dragged connection with Escape", async () => {
	const create = vi
		.spyOn(PlatformAPI, "createWorkspaceTunnel")
		.mockResolvedValue({ tunnel });
	const user = setup();
	await user.pointer({
		keys: "[MouseLeft>]",
		target: screen.getByRole("button", {
			name: "Connect Alpha right output tunnel port",
		}),
		coords: { clientX: 392, clientY: 162 },
	});
	await user.keyboard("{Escape}");
	await user.pointer({
		keys: "[/MouseLeft]",
		target: screen.getByRole("button", {
			name: "Connect Beta left input tunnel port",
		}),
		coords: { clientX: 420, clientY: 138 },
	});
	expect(create).not.toHaveBeenCalled();
});

it("releases an unconnected cable without creating a tunnel", async () => {
	const create = vi
		.spyOn(PlatformAPI, "createWorkspaceTunnel")
		.mockResolvedValue({ tunnel });
	const onDragging = vi.fn();
	const user = setup([], onDragging);
	const from = screen.getByRole("button", {
		name: "Connect Alpha right input tunnel port",
	});
	await user.pointer([
		{
			keys: "[MouseLeft>]",
			target: from,
			coords: { clientX: 392, clientY: 138 },
		},
		{ target: from, coords: { clientX: 200, clientY: 150 } },
		{
			keys: "[/MouseLeft]",
			target: from,
			coords: { clientX: 200, clientY: 150 },
		},
	]);
	expect(create).not.toHaveBeenCalled();
	expect(onDragging).toHaveBeenLastCalledWith(false);
});

it.each([
	"Disconnect tunnel Alpha to Beta",
	"Disconnect tunnel Alpha to Beta source plug",
])("unplugs an existing tunnel through %s", async (name) => {
	const create = vi
		.spyOn(PlatformAPI, "createWorkspaceTunnel")
		.mockResolvedValue({ tunnel });
	const remove = vi
		.spyOn(PlatformAPI, "deleteWorkspaceTunnel")
		.mockResolvedValue({ tunnel: { ...tunnel, status: "disconnecting" } });
	const user = setup([tunnel]);
	await screen.findByRole("button", {
		name: "Disconnect tunnel Alpha to Beta",
	});
	const plug = screen.getByRole("button", { name });
	await user.pointer([
		{
			keys: "[MouseLeft>]",
			target: plug,
			coords: { clientX: 420, clientY: 18 },
		},
		{ target: plug, coords: { clientX: 600, clientY: 150 } },
		{
			keys: "[/MouseLeft]",
			target: document.body,
			coords: { clientX: 600, clientY: 150 },
		},
	]);
	await waitFor(() =>
		expect(remove).toHaveBeenCalledWith(source.organization_id, tunnel.id),
	);
	expect(create).not.toHaveBeenCalled();
});

it("connects table row sockets on the left side", async () => {
	const create = vi
		.spyOn(PlatformAPI, "createWorkspaceTunnel")
		.mockResolvedValue({ tunnel });
	const user = setup([], vi.fn(), {
		tableAnchors: [
			{ workspaceId: source.id, x: 40, y: 40 },
			{ workspaceId: target.id, x: 40, y: 120 },
		],
	});
	screen
		.getByRole("button", { name: "Connect Alpha output tunnel port" })
		.focus();
	await user.keyboard("{Enter}");
	await user.click(await screen.findByRole("button", { name: "Connect" }));
	await waitFor(() =>
		expect(create).toHaveBeenCalledWith(
			source.organization_id,
			source.id,
			target.id,
			"left",
			"left",
		),
	);
});
it.each([false, true])(
	"keeps non-admin connections read only (table: %s)",
	async (table) => {
		const create = vi
			.spyOn(PlatformAPI, "createWorkspaceTunnel")
			.mockResolvedValue({ tunnel });
		const remove = vi
			.spyOn(PlatformAPI, "deleteWorkspaceTunnel")
			.mockResolvedValue({ tunnel });
		const user = setup([tunnel], vi.fn(), {
			canManage: false,
			tableAnchors: table
				? [
						{ workspaceId: source.id, x: 40, y: 40 },
						{ workspaceId: target.id, x: 40, y: 120 },
					]
				: undefined,
		});
		screen
			.getByRole("button", {
				name: table
					? "Connect Alpha output tunnel port"
					: "Connect Alpha right output tunnel port",
			})
			.focus();
		await user.keyboard("{Enter}");
		await user.click(await screen.findByRole("button", { name: "Disconnect" }));
		expect(create).not.toHaveBeenCalled();
		expect(remove).not.toHaveBeenCalled();
	},
);
it.each([false, true])(
	"keeps the original cord until its replacement is ready (source plug: %s)",
	async (sourcePlug) => {
		const third = { ...source, id: "third", name: "Gamma" };
		const replacement = {
			...tunnel,
			id: "replacement",
			source_workspace_id: sourcePlug ? third.id : source.id,
			target_workspace_id: sourcePlug ? target.id : third.id,
			status: "pending" as const,
			source_side: "left" as const,
			target_side: "left" as const,
		};
		const get = vi
			.spyOn(PlatformAPI, "getWorkspaceTunnels")
			.mockResolvedValue({ tunnels: [tunnel] });
		const create = vi
			.spyOn(PlatformAPI, "createWorkspaceTunnel")
			.mockImplementation(async () => {
				get.mockResolvedValue({ tunnels: [tunnel, replacement] });
				return { tunnel: replacement };
			});
		const remove = vi
			.spyOn(PlatformAPI, "deleteWorkspaceTunnel")
			.mockResolvedValue({ tunnel: { ...tunnel, status: "disconnecting" } });
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		render(
			<QueryClientProvider client={client}>
				<WorkspaceTunnelPorts
					shown={[source, target, third]}
					cols={1}
					cellW={0}
					cellH={0}
					gap={0}
					tableAnchors={[
						{ workspaceId: source.id, x: 40, y: 40 },
						{ workspaceId: target.id, x: 40, y: 120 },
						{ workspaceId: third.id, x: 40, y: 200 },
					]}
					onDragging={vi.fn()}
				/>
			</QueryClientProvider>,
		);
		const plug = await screen.findByRole("button", {
			name: `Disconnect tunnel Alpha to Beta${sourcePlug ? " source plug" : ""}`,
		});
		const user = userEvent.setup();
		await user.pointer([
			{
				keys: "[MouseLeft>]",
				target: plug,
				coords: { clientX: 40, clientY: sourcePlug ? 40 : 120 },
			},
			{ target: document.body, coords: { clientX: 40, clientY: 200 } },
			{
				keys: "[/MouseLeft]",
				target: document.body,
				coords: { clientX: 40, clientY: 200 },
			},
		]);
		await waitFor(() =>
			expect(create).toHaveBeenCalledWith(
				source.organization_id,
				sourcePlug ? third.id : source.id,
				sourcePlug ? target.id : third.id,
				"left",
				"left",
			),
		);
		expect(remove).not.toHaveBeenCalled();
		await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
		act(() =>
			client.setQueryData(workspaceTunnels(source.organization_id).queryKey, {
				tunnels: [tunnel, { ...replacement, status: "ready" }],
			}),
		);
		await waitFor(() =>
			expect(remove).toHaveBeenCalledExactlyOnceWith(
				source.organization_id,
				tunnel.id,
			),
		);
	},
);

it("disconnects an established peer outside the visible table page", async () => {
	const offpage = {
		...tunnel,
		target_workspace_id: "off-page",
		target_workspace_name: "Remote workspace",
	};
	const remove = vi
		.spyOn(PlatformAPI, "deleteWorkspaceTunnel")
		.mockResolvedValue({ tunnel: { ...offpage, status: "disconnecting" } });
	const user = setup([offpage]);
	screen
		.getByRole("button", { name: "Connect Alpha right output tunnel port" })
		.focus();
	await user.keyboard("{Enter}");
	await user.click(await screen.findByRole("button", { name: "Disconnect" }));
	await waitFor(() =>
		expect(remove).toHaveBeenCalledWith(source.organization_id, offpage.id),
	);
});

it("connects an input terminal from the chosen peer output", async () => {
	const create = vi
		.spyOn(PlatformAPI, "createWorkspaceTunnel")
		.mockResolvedValue({ tunnel });
	const user = setup([], vi.fn(), {
		tableAnchors: [
			{ workspaceId: source.id, x: 40, y: 40 },
			{ workspaceId: target.id, x: 40, y: 120 },
		],
	});
	screen
		.getByRole("button", { name: "Connect Alpha input tunnel port" })
		.focus();
	await user.keyboard("{Enter}");
	await user.click(await screen.findByRole("button", { name: "Connect" }));
	await waitFor(() =>
		expect(create).toHaveBeenCalledWith(
			source.organization_id,
			target.id,
			source.id,
			"left",
			"left",
		),
	);
});


it("adds another connection from an occupied output without removing the first", async () => {
	const third = { ...source, id: "third", name: "Gamma" };
	const create = vi
		.spyOn(PlatformAPI, "createWorkspaceTunnel")
		.mockResolvedValue({
			tunnel: { ...tunnel, id: "next", target_workspace_id: third.id },
		});
	const remove = vi
		.spyOn(PlatformAPI, "deleteWorkspaceTunnel")
		.mockResolvedValue({ tunnel });
	const user = setup([tunnel], vi.fn(), {
		shown: [source, target, third],
		tableAnchors: [
			{ workspaceId: source.id, x: 40, y: 40 },
			{ workspaceId: target.id, x: 40, y: 120 },
			{ workspaceId: third.id, x: 40, y: 200 },
		],
	});
	await user.click(
		screen.getByRole("button", { name: "Connect Alpha output tunnel port" }),
	);
	await user.click(await screen.findByRole("button", { name: "Connect" }));
	await waitFor(() =>
		expect(create).toHaveBeenCalledWith(
			source.organization_id,
			source.id,
			third.id,
			"left",
			"left",
		),
	);
	expect(remove).not.toHaveBeenCalled();
});

it("keeps old outer-side connections manageable in a single-column inset gutter", async () => {
	const existing = {
		...tunnel,
		source_side: "right" as const,
		target_side: "right" as const,
	};
	const create = vi
		.spyOn(PlatformAPI, "createWorkspaceTunnel")
		.mockResolvedValue({ tunnel });
	const remove = vi
		.spyOn(PlatformAPI, "deleteWorkspaceTunnel")
		.mockResolvedValue({ tunnel });
	const user = setup([existing], vi.fn(), { cols: 1, cellW: 180 });
	await user.hover(
		await screen.findByRole("button", {
			name: "Disconnect tunnel Alpha to Beta source plug",
		}),
	);
	await user.click(
		await screen.findByRole("button", {
			name: "Manage tunnel Alpha to Beta: ready",
		}),
	);
	expect(create).not.toHaveBeenCalled();
	expect(remove).not.toHaveBeenCalled();
	await user.click(screen.getByRole("button", { name: "Disconnect" }));
	await waitFor(() =>
		expect(remove).toHaveBeenCalledWith(source.organization_id, existing.id),
	);
});
it.each([false, true])(
	"lets a member connect their own workspaces (table: %s)",
	async (table) => {
		const create = vi
			.spyOn(PlatformAPI, "createWorkspaceTunnel")
			.mockResolvedValue({ tunnel });
		const user = setup([], vi.fn(), {
			canManage: false,
			actorId: source.owner_id,
			tableAnchors: table
				? [
						{ workspaceId: source.id, x: 40, y: 40 },
						{ workspaceId: target.id, x: 40, y: 120 },
					]
				: undefined,
		});
		await user.click(
			screen.getByRole("button", {
				name: table
					? "Connect Alpha output tunnel port"
					: "Connect Alpha right output tunnel port",
			}),
		);
		await user.click(await screen.findByRole("button", { name: "Connect" }));
		await waitFor(() =>
			expect(create).toHaveBeenCalledWith(
				source.organization_id,
				source.id,
				target.id,
				table ? "left" : "right",
				"left",
			),
		);
	},
);
it.each(["other-owner", "other-organization"])(
	"prevents a member connecting to %s",
	async (restriction) => {
		const create = vi
			.spyOn(PlatformAPI, "createWorkspaceTunnel")
			.mockResolvedValue({ tunnel });
		const other = {
			...target,
			owner_id:
				restriction === "other-owner" ? "someone-else" : source.owner_id,
			organization_id:
				restriction === "other-organization"
					? "another-org"
					: source.organization_id,
		};
		const user = setup([], vi.fn(), {
			canManage: false,
			actorId: source.owner_id,
			shown: [source, other],
		});
		await user.click(
			screen.getByRole("button", {
				name: "Connect Alpha right output tunnel port",
			}),
		);
		if (restriction === "other-owner")
			await user.click(await screen.findByRole("button", { name: "Connect" }));
		expect(create).not.toHaveBeenCalled();
	},
);
it("lets a member disconnect only a tunnel whose two workspaces they own", async () => {
	const remove = vi
		.spyOn(PlatformAPI, "deleteWorkspaceTunnel")
		.mockResolvedValue({ tunnel });
	const user = setup([tunnel], vi.fn(), {
		canManage: false,
		actorId: source.owner_id,
	});
	await user.click(
		screen.getByRole("button", {
			name: "Connect Alpha right output tunnel port",
		}),
	);
	await user.click(await screen.findByRole("button", { name: "Disconnect" }));
	await waitFor(() =>
		expect(remove).toHaveBeenCalledWith(source.organization_id, tunnel.id),
	);
});
it("does not let a member detach a shared peer owned by someone else", async () => {
	const remove = vi
		.spyOn(PlatformAPI, "deleteWorkspaceTunnel")
		.mockResolvedValue({ tunnel });
	const user = setup([tunnel], vi.fn(), {
		canManage: false,
		actorId: source.owner_id,
		shown: [source, { ...target, owner_id: "another-owner" }],
	});
	await user.click(
		screen.getByRole("button", {
			name: "Connect Alpha right output tunnel port",
		}),
	);
	await user.click(await screen.findByRole("button", { name: "Disconnect" }));
	expect(remove).not.toHaveBeenCalled();
});

it("list remaps persisted endpoints to right ports without rewriting the connection", async () => {
	const create = vi.spyOn(PlatformAPI, "createWorkspaceTunnel");
	const remove = vi
		.spyOn(PlatformAPI, "deleteWorkspaceTunnel")
		.mockResolvedValue({ tunnel });
	const user = setup(
		[{ ...tunnel, source_side: "left", target_side: "left" }],
		vi.fn(),
		{ cols: 1, listMode: true },
	);
	await user.click(
		screen.getByRole("button", {
			name: "Connect Alpha right output tunnel port",
		}),
	);
	expect(create).not.toHaveBeenCalled();
	expect(remove).not.toHaveBeenCalled();
	await user.click(await screen.findByRole("button", { name: "Disconnect" }));
	await waitFor(() =>
		expect(remove).toHaveBeenCalledWith(source.organization_id, tunnel.id),
	);
});
it("creates a list connection from the visible right-side terminals", async () => {
	const create = vi
		.spyOn(PlatformAPI, "createWorkspaceTunnel")
		.mockResolvedValue({ tunnel });
	const user = setup([], vi.fn(), { cols: 1, listMode: true });
	await user.click(
		screen.getByRole("button", {
			name: "Connect Alpha right output tunnel port",
		}),
	);
	await user.click(await screen.findByRole("button", { name: "Connect" }));
	await waitFor(() =>
		expect(create).toHaveBeenCalledWith(
			source.organization_id,
			source.id,
			target.id,
			"right",
			"right",
		),
	);
});

it("deletes the selected connection through its context menu", async () => {
	const remove = vi
		.spyOn(PlatformAPI, "deleteWorkspaceTunnel")
		.mockResolvedValue({ tunnel: { ...tunnel, status: "disconnecting" } });
	const user = setup([tunnel]);
	await user.pointer({
		target: await screen.findByRole("button", {
			name: "Manage tunnel Alpha to Beta: ready",
		}),
		keys: "[MouseRight]",
	});
	await user.click(screen.getByRole("menuitem", { name: "Delete connection" }));
	await waitFor(() =>
		expect(remove).toHaveBeenCalledWith(source.organization_id, tunnel.id),
	);
});
it("does not allow another owner's connection to be deleted from the context menu", async () => {
	const remove = vi.spyOn(PlatformAPI, "deleteWorkspaceTunnel");
	const user = setup([tunnel], vi.fn(), {
		canManage: false,
		actorId: "another-user",
	});
	await user.pointer({
		target: await screen.findByRole("button", {
			name: "Manage tunnel Alpha to Beta: ready",
		}),
		keys: "[MouseRight]",
	});
	await user.click(screen.getByRole("menuitem", { name: "Delete connection" }));
	expect(remove).not.toHaveBeenCalled();
});

it("does not pull a cord out of an idle female output", async () => {
	const dragging = vi.fn();
	const create = vi
		.spyOn(PlatformAPI, "createWorkspaceTunnel")
		.mockResolvedValue({ tunnel });
	const user = setup([], dragging);
	await user.pointer([
		{
			keys: "[MouseLeft>]",
			target: screen.getByRole("button", {
				name: "Connect Alpha right output tunnel port",
			}),
			coords: { clientX: 392, clientY: 162 },
		},
		{ target: document.body, coords: { clientX: 500, clientY: 200 } },
		{ keys: "[/MouseLeft]", target: document.body },
	]);
	expect(dragging).not.toHaveBeenCalledWith(true);
	expect(create).not.toHaveBeenCalled();
});

it("disconnects a tunnel whose peer is filtered out via its visible marker", async () => {
	const remove = vi
		.spyOn(PlatformAPI, "deleteWorkspaceTunnel")
		.mockResolvedValue({ tunnel: { ...tunnel, status: "disconnecting" } });
	const user = setup([tunnel], vi.fn(), { shown: [source], cols: 1 });
	await user.hover(await screen.findByRole("button", { name: /Move cable head:/ }));
	await user.click(
		await screen.findByRole("button", {
			name: /Manage tunnel to .* outside this view/,
		}),
	);

	await user.click(await screen.findByRole("button", { name: "Disconnect" }));
	await waitFor(() =>
		expect(remove).toHaveBeenCalledWith(source.organization_id, tunnel.id),
	);
});

it("resets every saved shape setting for a tunnel", async () => {
	const key = "coder-tunnel-layout-v1:reset-test:grid";
	localStorage.setItem(
		key,
		JSON.stringify({
			routes: {
				[tunnel.id]: {
					points: [{ id: "bend", x: 30, y: 40 }],
					orthogonal: true,
				},
			},
			heads: { [tunnel.id]: { x: -60, y: 30 } },
			arcs: { [tunnel.id]: 80 },
			stubs: { [tunnel.id]: { length: 100, bend: 30 } },
		}),
	);
	const user = setup([tunnel], vi.fn(), {
		shown: [source],
		actorId: "reset-test",
	});
	await user.pointer({
		keys: "[MouseRight]",
		target: await screen.findByRole("button", { name: /Move cable head:/ }),
	});
	await user.click(
		screen.getByRole("menuitem", { name: "Reset cable routing" }),
	);
	await waitFor(() =>
		expect(JSON.parse(localStorage.getItem(key) ?? "null")).toEqual({
			routes: {},
			heads: {},
			arcs: {},
			stubs: {},
		}),
	);
	localStorage.removeItem(key);
});
