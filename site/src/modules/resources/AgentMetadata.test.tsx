import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WorkspaceAgentMetadata } from "#/api/typesGenerated";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { MockWorkspaceInfrastructureMetrics } from "#/testHelpers/workspaceMetrics";
import { AgentMetadataView, metricName } from "./AgentMetadata";
import { groupMetadata } from "./metadataGroups";
import * as graphSettings from "./metricGraphSettings";

const metric = (
	key: string,
	display_name: string,
	value: string,
): WorkspaceAgentMetadata => ({
	description: { key, display_name, script: "", interval: 10, timeout: 1 },
	result: { value, error: "", collected_at: "2026-10-24T12:00:00Z", age: 0 },
});
const metadata = [
	metric("0_cpu_usage", "CPU", "0.6/6 cores (10%)"),
	metric("1_ram_usage", "RAM", "0.5/6.4 GB (7%)"),
	metric("2_load", "Load Avg", "0.13 / 6 cores (2%)"),
	metric("3_home_disk", "Disk", "0.3/20 GB (1%)"),
	metric("4_cpu_usage_host", "CPU", "2.8/24 cores (12%)"),
	metric("5_mem_usage_host", "RAM", "19.5/98.6 GB (20%)"),
	metric("6_disk_host", "Disk", "918.7/1003.7 GB (92%)"),
	metric("7_load_host", "Load Avg", "2.10/24 cores (9%)"),
];
it("orders CPU, RAM, Disk and load consistently in workspace and host groups", () => {
	for (const items of [metadata, [...metadata].reverse()])
		expect(groupMetadata(items).map((g) => g.items.map(metricName))).toEqual([
			["CPU", "RAM", "Disk", "Ø Load"],
			["CPU", "RAM", "Disk", "Ø Load"],
		]);
});
it("normalizes legacy host and load metric names", () => {
	for (const name of [
		"Load Avg",
		"Load Average",
		"Load Average (Host)",
		"Ø Load",
	])
		expect(metricName(metric("x", name, "1"))).toBe("Ø Load");
	expect(metricName(metric("x", "CPU Usage (Host)", "1"))).toBe("CPU Usage");
});
it("requests aggregate metrics when the node/cluster switch is activated", async () => {
	const onScopeChange = vi.fn();
	renderComponent(
		<AgentMetadataView
			metadata={metadata}
			workspaceName="my-workspace"
			infrastructure={MockWorkspaceInfrastructureMetrics}
			pausedAt={Date.parse(MockWorkspaceInfrastructureMetrics.generatedAt)}
			onScopeChange={onScopeChange}
		/>,
	);
	await userEvent.click(
		screen.getByRole("switch", { name: "Show cluster metrics" }),
	);
	expect(onScopeChange).toHaveBeenCalledExactlyOnceWith("cluster");
});

it("publishes only workspace metric intervals when infrastructure is restricted", () => {
	const publish = vi.spyOn(graphSettings, "publishIntervals");
	renderComponent(
		<AgentMetadataView
			metadata={metadata}
			workspaceName="private-workspace"
			infrastructure={{
				...MockWorkspaceInfrastructureMetrics,
				infrastructureRestricted: true,
			}}
			historyScope="restricted-intervals"
			pausedAt={Date.parse(MockWorkspaceInfrastructureMetrics.generatedAt)}
		/>,
	);
	expect(publish).toHaveBeenCalledWith("restricted-intervals", [
		{ name: "Workspace CPU", s: 10 },
		{ name: "Workspace RAM", s: 10 },
		{ name: "Workspace Ø Load", s: 10 },
		{ name: "Workspace Disk", s: 10 },
	]);
	publish.mockRestore();
});
