import { parseTerminalCommand } from "./clusterDiagnosticCommands";

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
