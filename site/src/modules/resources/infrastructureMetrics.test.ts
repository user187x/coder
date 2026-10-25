import {
	MockWorkspaceInfrastructureMetrics,
	MockWorkspaceMetricMetadata,
} from "#/testHelpers/workspaceMetrics";
import {
	infrastructureMaximum,
	infrastructureMetadata,
	loadReading,
	metricCapacity,
	workspaceMaximum,
} from "./infrastructureMetrics";

const now = Date.parse(MockWorkspaceInfrastructureMetrics.generatedAt);
it("reports load itself rather than inventing a maximum or showing only its percentage", () => {
	const item = MockWorkspaceMetricMetadata.find((item) =>
		item.description.key.includes("load"),
	);
	if (!item) throw new Error("Load metadata fixture is required");
	expect(
		loadReading({
			...item,
			result: { ...item.result, value: "0.42 / 4 cores (11%)", error: "" },
		})?.text,
	).toBe("0.4");
	expect(
		loadReading({ ...item, result: { ...item.result, error: "Unavailable" } }),
	).toBeNull();
});
it("uses actual node observations, units and collection timestamps", () => {
	const metrics = infrastructureMetadata(
		MockWorkspaceInfrastructureMetrics.node,
		"node",
		"worker-node-2",
		now + 1000,
	);
	expect(metrics[0]?.result).toEqual({
		value: "1 / 4 cores (25%)",
		error: "",
		collected_at: MockWorkspaceInfrastructureMetrics.node.cpu.collectedAt,
		age: 1,
	});
	expect(
		infrastructureMetadata(
			MockWorkspaceInfrastructureMetrics.node,
			"node",
			"worker-node-2",
			now + 91000,
		)[0]?.result.age,
	).toBe(91);
	expect(metrics[1]?.result.value).toBe("2 / 8 GiB (25%)");
	expect(metrics[3]?.result.error).toBe(
		"Load averages are not exposed by the Kubernetes node API",
	);
	expect(metrics[3]?.result.value).toBe("Unavailable");
});
it("normalizes observed load against CPU cores without presenting a load maximum", () => {
	const metrics = infrastructureMetadata(
		{
			...MockWorkspaceInfrastructureMetrics.node,
			load: {
				...MockWorkspaceInfrastructureMetrics.node.load,
				used: 1.25,
				total: 4,
				error: null,
				collectedAt: MockWorkspaceInfrastructureMetrics.node.cpu.collectedAt,
			},
		},
		"node",
		"worker-node-2",
		now,
	);
	expect(metrics[3]?.result.value).toBe("1.25 / 4 cores (31.25%)");
});
it("isolates aggregate history from node history and rescheduled nodes", () => {
	const node = infrastructureMetadata(
		MockWorkspaceInfrastructureMetrics.node,
		"node",
		"worker-node-2",
		now,
	);
	const other = infrastructureMetadata(
		MockWorkspaceInfrastructureMetrics.node,
		"node",
		"worker-node-3",
		now,
	);
	const cluster = infrastructureMetadata(
		MockWorkspaceInfrastructureMetrics.cluster,
		"cluster",
		null,
		now,
	);
	expect(node[0]?.description.key).not.toBe(cluster[0]?.description.key);
	expect(node[0]?.description.key).not.toBe(other[0]?.description.key);
	expect(cluster[0]?.result.value).toBe("4 / 16 cores (25%)");
});
it("keeps missing infrastructure readings unavailable instead of fabricating zero", () => {
	const data = {
		...MockWorkspaceInfrastructureMetrics.node,
		cpu: {
			...MockWorkspaceInfrastructureMetrics.node.cpu,
			used: null,
			error: "Metrics server unavailable",
		},
	};
	const result = infrastructureMetadata(data, "node", "worker-node-2", now);
	expect(result[0]?.result.error).toBe("Metrics server unavailable");
	expect(result[0]?.result.value).toBe("Unavailable / 4 cores");
});
it.each([
	["0.1/0.25 cores (40%)", "0.3", "Assigned maximum: 0.25 cores"],
	["2.2/8.0 GiB (28%)", "8", "Assigned maximum: 8 GiB"],
	["0/30 GB (0%)", "30", "Assigned maximum: 30 GB"],
])("extracts a reported maximum from %s", (value, text, label) => {
	expect(metricCapacity(value)).toEqual({ text, label });
});
it("does not invent a maximum for raw readings or errors", () => {
	expect(metricCapacity("0.12")).toBeNull();
	expect(metricCapacity("no reading")).toBeNull();
});

it("uses actual container fractional limits and refuses a host filesystem fallback for assigned disk", () => {
	const item = {
		description: {
			key: "cpu",
			display_name: "CPU",
			script: "",
			interval: 10,
			timeout: 1,
		},
		result: {
			value: "1/24 cores (4%)",
			error: "",
			collected_at: "2026-10-24T12:00:00Z",
			age: 0,
		},
	};
	expect(
		workspaceMaximum(item, {
			...MockWorkspaceInfrastructureMetrics.allocation,
			cpu: 0.25,
			memory: null,
			disk: null,
			diskEnforced: null,
			source: { cpu: "container-limit", memory: "unknown", disk: "unknown" },
		}),
	).toEqual({ text: "0.3", label: "Assigned maximum: 0.25 cores" });
	const disk = {
		...item,
		description: { ...item.description, key: "disk", display_name: "Disk" },
		result: { ...item.result, value: "1/1000 GiB (0.1%)" },
	};
	expect(workspaceMaximum(disk, undefined)).toBeNull();
	expect(
		workspaceMaximum(disk, MockWorkspaceInfrastructureMetrics.allocation)?.text,
	).toBe("10.7GB");
	expect(
		workspaceMaximum(disk, MockWorkspaceInfrastructureMetrics.allocation)
			?.label,
	).toContain("not filesystem-enforced");
});
it("labels infrastructure as capacity instead of assigned workspace limits", () => {
	expect(infrastructureMaximum(0.25, "cores")).toEqual({
		text: "0.3",
		label: "Capacity: 0.25 cores",
	});
});

it.each([
	[0.25, "0.3"],
	[7.5, "7.5"],
	[4.125, "4.1"],
])("formats CPU capacity %s to at most one decimal", (value, text) => {
	expect(infrastructureMaximum(value, "cores")?.text).toBe(text);
});
it("keeps RAM compact while retaining exact byte quantity", () => {
	const value = 20171026432;
	const badge = infrastructureMaximum(value, "bytes");
	expect(badge?.text).toBe("18.8");
	expect(badge?.label).toContain("20,171,026,432 bytes");
});
it.each([
	[20000000000, "20GB"],
	[1003736440832, "1TB"],
])("uses compact SI disk units for %s bytes", (value, text) => {
	const badge = infrastructureMaximum(value, "bytes", "Capacity", "disk");
	expect(badge?.text).toBe(text);
	expect(badge?.label).toContain(value.toLocaleString("en-US"));
});

it("distinguishes assigned VM memory from guest reserve and application usable memory", () => {
	const ram = MockWorkspaceMetricMetadata.find((m) =>
		/ram|mem/i.test(m.description.key),
	);
	if (!ram) throw new Error("RAM fixture missing");
	const badge = workspaceMaximum(ram, {
		...MockWorkspaceInfrastructureMetrics.allocation,
		memory: 2147483648,
		memoryReserved: 268435456,
		memoryUsable: 1879048192,
		source: {
			cpu: "vm-topology",
			memory: "vm-memory",
			disk: "guest-block-capacity",
		},
	});
	expect(badge).toEqual({
		text: "2",
		label:
			"Assigned VM memory: 2 GiB (2,147,483,648 bytes); guest OS reserve: 268,435,456 bytes; workspace application maximum: 1,879,048,192 bytes",
	});
});
