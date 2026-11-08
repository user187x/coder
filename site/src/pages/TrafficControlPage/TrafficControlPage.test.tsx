import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { API } from "#/api/api";
import { PlatformAPI } from "#/api/platform";
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
	latest_build: { ...MockWorkspace.latest_build, status: "running" },
});

const setup = () => {
	const list = vi.spyOn(API, "getWorkspaces").mockResolvedValue({
		workspaces: [workspace("web", "web"), workspace("db", "db")],
		count: 2,
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
	render(<TrafficControlPage />);
	return { list };
};

afterEach(() => {
	auth.admin = false;
	vi.restoreAllMocks();
});

it("draws the workspaces' shared ports and tunnels, source to target", async () => {
	setup();
	const diagram = await screen.findByRole("img", {
		name: /Traffic: .*:3000 public.*web.*Output Ports :5432 tcp.*db/,
	});
	expect(diagram).toHaveAccessibleName(
		"Traffic: Input Ports :3000 public → web → Output Ports :5432 tcp → db",
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
