import type { QueryClient } from "react-query";
import { API } from "#/api/api";
import {
	clusterEntity,
	clusterHA,
	networkNodePods,
	networkWorkloads,
	type WorkloadKind,
} from "#/api/clusterNetwork";
import { health } from "#/api/queries/debug";
import {
	coderHeartbeat,
	hud,
	networkReport,
	onlineUsers,
	persistenceReport,
} from "#/api/queries/platform";
import { users } from "#/api/queries/users";
import type { User } from "#/api/typesGenerated";
import { humanDuration } from "#/utils/time";

const commandHelp = [
	["ping", "Measure the HTTPS round trip to Coder"],
	["nodes", "List cluster nodes"],
	["pods [workspace|database|coder]", "List pods, optionally filtered by role"],
	["services / svc", "List Kubernetes services"],
	["deployments / deploy", "List Kubernetes deployments"],
	["statefulsets / sts", "List Kubernetes StatefulSets"],
	["daemonsets / ds", "List Kubernetes DaemonSets"],
	["pvc / pv", "List persistent volume claims or volumes"],
	["database [pods|health|details]", "Inspect Coder's database"],
	["describe node NAME", "Inspect a node"],
	["describe pod NAMESPACE/NAME", "Inspect a pod"],
	[
		"show node|pod|svc [NAME]",
		"List or inspect a resource. Use NAMESPACE/NAME for pods and services",
	],
	["users / admins [online|all]", "List users or administrators"],
	["version [server|agents|workspaces]", "Show versions and workspace images"],
	["uptime", "Show Coder's uptime"],
	["issues / status", "Show deployment health checks"],
	["fullscreen", "Toggle terminal fullscreen"],
] as const;

const commandOptions = {
	ping: [],
	nodes: [],
	pods: ["workspace", "database", "coder"],
	services: [],
	deployments: [],
	statefulsets: [],
	daemonsets: [],
	pvc: [],
	pv: [],
	database: ["pods", "health", "details"],
	users: ["online", "all"],
	admins: ["online", "all"],
	version: ["server", "agents", "workspaces"],
	uptime: [],
	status: [],
	fullscreen: [],
} as const;

const aliases: Readonly<Partial<Record<string, keyof typeof commandOptions>>> =
	{
		svc: "services",
		deploy: "deployments",
		statefulset: "statefulsets",
		sts: "statefulsets",
		daemonset: "daemonsets",
		ds: "daemonsets",
		issues: "status",
	};
export const diagnosticCommandNames = [
	...Object.keys(commandOptions),
	...Object.keys(aliases),
	"show",
	"describe",
];

export const diagnosticCommandHelp = () =>
	table(["COMMAND", "DESCRIPTION"], commandHelp);

const resourceName = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;

type Resource = "node" | "pod" | "service";
type Command =
	| { name: keyof typeof commandOptions; argument?: string }
	| {
			name: "resource";
			resource: Resource;
			namespace?: string;
			target?: string;
	  };

function isCommandName(name: string): name is keyof typeof commandOptions {
	return Object.hasOwn(commandOptions, name);
}

export function parseTerminalCommand(input: string): Command {
	const [word = "", ...args] = input.trim().split(/\s+/);
	const [argument, subject, ...rest] =
		args[0] === "|" || args[0] === ":" ? args.slice(1) : args;
	const name = word.toLowerCase();
	if (name === "show" || name === "describe") {
		const resource = argument === "svc" ? "service" : argument;
		if (
			(resource !== "node" && resource !== "pod" && resource !== "service") ||
			rest.length ||
			(name === "describe" && !subject)
		) {
			throw new Error(
				"Use show node, show pod, or show svc. For details, add a resource name.",
			);
		}
		if (!subject) return { name: "resource", resource };
		const parts = subject.split("/");
		if (
			parts.some((part) => !resourceName.test(part)) ||
			parts.length !== (resource === "node" ? 1 : 2)
		) {
			throw new Error(
				resource === "node"
					? "Enter a node name."
					: "Enter the resource as NAMESPACE/NAME.",
			);
		}
		return {
			name: "resource",
			resource,
			namespace: parts.length === 2 ? parts[0] : undefined,
			target: parts.at(-1),
		};
	}
	const resolved = aliases[name] ?? name;
	if (!isCommandName(resolved))
		throw new Error("Unknown command. Enter help for available commands.");
	const options: readonly string[] = commandOptions[resolved];
	if (subject || (argument && !options.includes(argument))) {
		throw new Error(
			options.length
				? `Use ${resolved} [${options.join("|")}].`
				: `${resolved} takes no arguments.`,
		);
	}
	return { name: resolved, argument };
}

type Cell = string | number | null | undefined;
type Row = readonly Cell[];

function table(headers: readonly string[], rows: readonly Row[]) {
	if (!rows.length) return "No matching results.";
	const values = rows.map((row) =>
		row.map((cell) => String(cell ?? "Unavailable").replace(/[\r\n\t]/g, " ")),
	);
	const widths = headers.map((header, index) =>
		values.reduce(
			(width, row) => Math.max(width, row[index]?.length ?? 0),
			header.length,
		),
	);
	return [headers, ...values]
		.map((row) =>
			row
				.map((value, index) =>
					index === headers.length - 1
						? value
						: value.padEnd(widths[index] ?? 0),
				)
				.join("  "),
		)
		.join("\n");
}

function details(fields: Readonly<Record<string, Cell>>) {
	return Object.entries(fields)
		.map(([key, value]) => `${key.padEnd(20)} ${value ?? "Unavailable"}`)
		.join("\n");
}

async function listNodes(client: QueryClient) {
	const report = await client.fetchQuery(networkReport(true));
	return table(
		["NODE", "STATUS", "ROLES", "INTERNAL IP", "PODS", "KUBELET"],
		report.nodes.map((node) => [
			node.name,
			node.ready ? "Ready" : "Not ready",
			node.roles.join(", "),
			node.addresses.InternalIP?.join(", "),
			node.podCount,
			node.kubelet,
		]),
	);
}

async function listPods(client: QueryClient, role?: string) {
	const { pods } = await client.fetchQuery(networkNodePods());
	return table(
		["POD", "STATUS", "READY", "RESTARTS", "NODE"],
		pods
			.filter((pod) => !role || pod.kind === role)
			.map((pod) => [
				`${pod.namespace}/${pod.name}`,
				pod.status,
				`${pod.readyContainers}/${pod.containers}`,
				pod.restarts,
				pod.node,
			]),
	);
}

async function listServices(client: QueryClient) {
	const report = await client.fetchQuery(networkReport(true));
	if (!report.services)
		throw new Error(
			report.servicesError ?? "Service inventory is unavailable.",
		);
	return table(
		["SERVICE", "TYPE", "CLUSTER IP", "PORTS", "READY ENDPOINTS"],
		report.services.map((service) => [
			`${service.namespace}/${service.name}`,
			service.type,
			service.clusterIP,
			service.ports.join(", "),
			service.ready,
		]),
	);
}

async function listWorkloads(client: QueryClient, kind: WorkloadKind) {
	const report = await client.fetchQuery(networkWorkloads(kind));
	return table(
		["WORKLOAD", "READY", "DESIRED", "AVAILABLE"],
		report.workloads.map((workload) => [
			`${workload.namespace}/${workload.name}`,
			workload.ready,
			workload.desired,
			workload.available,
		]),
	);
}

async function inspectResource(
	client: QueryClient,
	resource: Resource,
	target?: string,
	namespace?: string,
) {
	if (!target) {
		switch (resource) {
			case "node":
				return listNodes(client);
			case "pod":
				return listPods(client);
			case "service":
				return listServices(client);
		}
	}
	const result = await client.fetchQuery(
		clusterEntity(
			resource === "node"
				? { type: "node", name: target }
				: { type: resource, name: target, namespace: namespace ?? "" },
		),
	);
	switch (result.type) {
		case "node":
			return details({
				Node: result.name,
				Addresses: result.addresses
					.map(({ type, address }) => `${type} ${address}`)
					.join(", "),
				Schedulable: result.unschedulable ? "No" : "Yes",
				CPU: result.allocatable.cpu,
				Memory: result.allocatable.memory,
				Pods: result.podCount,
				Conditions: result.conditions
					.map((condition) => `${condition.type}=${condition.status}`)
					.join(", "),
			});
		case "pod":
			return details({
				Pod: `${result.namespace}/${result.name}`,
				Status: result.phase,
				Reason: result.reason,
				Node: result.node,
				IP: result.podIP,
				Restarts: result.restarts,
				Images: result.containers
					.map((container) => container.image)
					.join(", "),
			});
		case "service":
			return details({
				Service: `${result.namespace}/${result.name}`,
				DNS: result.dns,
				Type: result.serviceType,
				"Cluster IPs": result.clusterIPs.join(", "),
				Ports: result.ports
					.map((port) => `${port.port}/${port.protocol}`)
					.join(", "),
				"Ready endpoints": result.endpoints?.filter(
					(endpoint) => endpoint.ready,
				).length,
			});
		default:
			throw new Error("Resource details are unavailable.");
	}
}

async function storage(client: QueryClient, claims: boolean) {
	const report = await client.fetchQuery(clusterHA(true));
	const inventory = claims ? report.storage?.claims : report.storage?.volumes;
	if (!inventory)
		throw new Error(report.storageError ?? "Storage inventory is unavailable.");
	return table(
		["NAME", "STATUS", "STORAGE CLASS", "CAPACITY", "BOUND TO"],
		inventory.map((volume) => [
			"namespace" in volume
				? `${volume.namespace}/${volume.name}`
				: volume.name,
			volume.phase,
			volume.storageClass,
			volume.capacity,
			"volume" in volume ? volume.volume : volume.claim,
		]),
	);
}

async function database(client: QueryClient, argument?: string) {
	if (argument === "pods") return listPods(client, "database");
	if (argument === "details") {
		const { facts } = await client.fetchQuery(persistenceReport(true));
		return `${details({
			Provider: facts.provider,
			"PostgreSQL version": facts.database?.version,
			Connections: facts.database?.connections,
			"Maximum connections": facts.database?.maxConnections,
			Instances: facts.instances.length,
		})}\n\n${table(
			["INSTANCE", "ROLE", "NODE", "STATUS"],
			facts.instances.map((instance) => [
				instance.name,
				instance.role,
				instance.node,
				instance.phase,
			]),
		)}`;
	}
	const { database } = await client.fetchQuery(health());
	return details({
		Severity: database.severity,
		Reachable: database.reachable ? "Yes" : "No",
		Latency: database.latency,
		Warning:
			database.error ??
			database.warnings.map(({ message }) => message).join(", "),
	});
}

async function listAccounts(client: QueryClient, admin: boolean, all: boolean) {
	const presence = await client.fetchQuery(onlineUsers());
	if (!all) {
		return table(
			["USER", "PRESENCE", "TABS"],
			presence.online
				.filter((user) => !admin || user.admin)
				.map((user) => [user.username, user.status, user.tabs]),
		);
	}
	const online = new Map(presence.online.map((user) => [user.id, user.status]));
	const knownAdmins = new Set(
		[...presence.online, ...presence.recent]
			.filter((user) => user.admin)
			.map((user) => user.id),
	);
	const accounts: User[] = [];
	const limit = 100;
	for (let offset = 0; ; offset += limit) {
		const page = await client.fetchQuery(users({ limit, offset }));
		accounts.push(...page.users);
		if (accounts.length >= page.count || page.users.length < limit) break;
	}
	return table(
		["USER", "PRESENCE", "ACCOUNT", "ROLES"],
		accounts
			.filter(
				(user) =>
					!admin ||
					knownAdmins.has(user.id) ||
					user.roles.some((role) => role.name === "owner"),
			)
			.map((user) => [
				user.username,
				online.get(user.id) ?? "offline",
				user.status,
				user.roles.map(({ name }) => name).join(", "),
			]),
	);
}

async function versions(client: QueryClient, argument?: string) {
	if (!argument || argument === "server") {
		const info = await API.getBuildInfo();
		return details({
			Coder: info.version,
			"Agent API": info.agent_api_version,
			"Built at": info.build_time,
		});
	}
	if (argument === "agents") {
		const report = await client.fetchQuery(networkReport(true));
		return table(
			["WORKSPACE", "AGENT", "VERSION", "STATUS"],
			[...report.workspaces, ...report.unplaced].flatMap((workspace) =>
				workspace.agents.map((agent) => [
					`${workspace.owner}/${workspace.name}`,
					agent.name,
					agent.version,
					agent.status,
				]),
			),
		);
	}
	const { pods } = await client.fetchQuery(networkNodePods());
	return table(
		["WORKSPACE POD", "IMAGE"],
		pods
			.filter((pod) => pod.kind === "workspace")
			.flatMap((pod) =>
				(pod.images ?? []).map((image) => [
					`${pod.namespace}/${pod.name}`,
					image,
				]),
			),
	);
}

async function clusterStatus(client: QueryClient) {
	const report = await client.fetchQuery(health());
	return details({
		Coder: report.severity,
		Database: report.database.severity,
		"Access URL": report.access_url.severity,
		WebSocket: report.websocket.severity,
		DERP: report.derp.severity,
		"Workspace proxies": report.workspace_proxy.severity,
		Provisioners: report.provisioner_daemons.severity,
	});
}

export async function runTerminalCommand(
	client: QueryClient,
	command: Command,
	terminal: HTMLElement,
) {
	if (command.name === "resource") {
		return inspectResource(
			client,
			command.resource,
			command.target,
			command.namespace,
		);
	}
	const { name, argument } = command;
	switch (name) {
		case "ping":
			return `Coder HTTPS round trip: ${(await client.fetchQuery(coderHeartbeat())).latency} ms`;
		case "nodes":
			return listNodes(client);
		case "pods":
			return listPods(client, argument);
		case "services":
			return listServices(client);
		case "deployments":
		case "statefulsets":
		case "daemonsets":
			return listWorkloads(client, name);
		case "pvc":
		case "pv":
			return storage(client, name === "pvc");
		case "database":
			return database(client, argument);
		case "users":
		case "admins":
			return listAccounts(client, name === "admins", argument === "all");
		case "version":
			return versions(client, argument);
		case "uptime": {
			const report = await client.fetchQuery(hud());
			const since = report.uptime?.since;
			return since
				? details({
						Uptime: humanDuration(Date.now() - new Date(since).getTime()),
						"Started at": since,
						Replicas: report.uptime?.replicas,
					})
				: "Coder uptime is unavailable.";
		}
		case "status":
			return clusterStatus(client);
		case "fullscreen":
			if (document.fullscreenElement === terminal) {
				await document.exitFullscreen();
				return "Exited fullscreen.";
			}
			await terminal.requestFullscreen();
			return "Fullscreen enabled. Press Escape to exit.";
	}
}
