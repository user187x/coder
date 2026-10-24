import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "react-query";
import { PlatformAPI, type WorkspaceTunnel } from "#/api/platform";
import { MockWorkspace } from "#/testHelpers/entities";
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
const setup = (tunnels: WorkspaceTunnel[] = [], onDragging = vi.fn()) => {
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
			/>
		</QueryClientProvider>,
	);
	return userEvent.setup();
};
afterEach(() => vi.restoreAllMocks());
it("connects workspaces through keyboard management", async () => {
	const create = vi
		.spyOn(PlatformAPI, "createWorkspaceTunnel")
		.mockResolvedValue({ tunnel: { ...tunnel, status: "pending" } });
	const user = setup();
	screen
		.getByRole("button", { name: "Connect Alpha left tunnel port" })
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
		.getByRole("button", { name: "Connect Alpha right tunnel port" })
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
		name: "Connect Alpha left tunnel port",
	});
	const to = screen.getByRole("button", {
		name: "Connect Beta right tunnel port",
	});
	await user.pointer([
		{ keys: "[MouseLeft>]", target: from, coords: { clientX: 8, clientY: 18 } },
		{ target: to, coords: { clientX: 804, clientY: 18 } },
		{ keys: "[/MouseLeft]", target: to, coords: { clientX: 804, clientY: 18 } },
	]);
	await waitFor(() =>
		expect(create).toHaveBeenCalledWith(
			source.organization_id,
			source.id,
			target.id,
			"left",
			"right",
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
			name: "Connect Alpha left tunnel port",
		}),
		coords: { clientX: 8, clientY: 18 },
	});
	await user.keyboard("{Escape}");
	await user.pointer({
		keys: "[/MouseLeft]",
		target: screen.getByRole("button", {
			name: "Connect Beta right tunnel port",
		}),
		coords: { clientX: 804, clientY: 18 },
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
		name: "Connect Alpha left tunnel port",
	});
	await user.pointer([
		{ keys: "[MouseLeft>]", target: from, coords: { clientX: 8, clientY: 18 } },
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

it.each(["Connect Beta left tunnel port", "Disconnect tunnel Alpha to Beta"])(
	"unplugs an existing tunnel through %s",
	async (name) => {
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
	},
);
