import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { ClusterNetworkAPI } from "#/api/clusterNetwork";
import { MockNoPermissions } from "#/testHelpers/entities";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import { server } from "#/testHelpers/server";
import HudTerminalPage from "./HudTerminalPage";
import { parseTerminalCommand } from "./terminalCommands";

afterEach(() => vi.restoreAllMocks());

it.each([
	["ping", { name: "ping" }],
	["pods | database", { name: "pods", argument: "database" }],
	["deploy", { name: "deployments" }],
	["statefulset", { name: "statefulsets" }],
	["ds", { name: "daemonsets" }],
	["issues", { name: "status" }],
	["database health", { name: "database", argument: "health" }],
	[
		"describe : node k3d-server",
		{ name: "resource", resource: "node", target: "k3d-server" },
	],
	[
		"show svc coder/coder",
		{
			name: "resource",
			resource: "service",
			namespace: "coder",
			target: "coder",
		},
	],
	["admins all", { name: "admins", argument: "all" }],
])("parses %s", (command, expected) => {
	expect(parseTerminalCommand(command)).toMatchObject(expected);
});

it.each([
	"show pod ../pod",
	"show svc coder/",
	"ping https://example.com",
	"pods coder extra",
])("rejects invalid parameters in %s", (input) =>
	expect(() => parseTerminalCommand(input)).toThrow(),
);

it("lists deployments and recalls the submitted command", async () => {
	const getWorkloads = vi
		.spyOn(ClusterNetworkAPI, "workloads")
		.mockResolvedValue({
			workloads: [
				{
					name: "coder",
					namespace: "coder",
					desired: 2,
					ready: 1,
					available: 1,
				},
			],
		});
	renderWithAuth(<HudTerminalPage />);
	const user = userEvent.setup();
	const input = await screen.findByRole("textbox", {
		name: "Diagnostic command",
	});
	await user.type(input, "deploy{Enter}");
	expect(
		await within(screen.getByRole("log")).findByText(/coder\/coder/),
	).toBeVisible();
	expect(getWorkloads).toHaveBeenCalledWith("deployments");
	await user.keyboard("{ArrowUp}");
	expect(input).toHaveValue("deploy");
});

it("keeps the terminal gated by deployment access", async () => {
	server.use(
		http.post("/api/v2/authcheck", () => HttpResponse.json(MockNoPermissions)),
	);
	const read = vi.spyOn(ClusterNetworkAPI, "workloads");
	renderWithAuth(<HudTerminalPage />);
	await screen.findByText("The cluster terminal is for administrators.");
	expect(
		screen.queryByRole("textbox", { name: "Diagnostic command" }),
	).toBeNull();
	expect(read).not.toHaveBeenCalled();
});
