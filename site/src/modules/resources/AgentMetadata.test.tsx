import { screen, within } from "@testing-library/react";
import type { WorkspaceAgentMetadata } from "#/api/typesGenerated";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { AgentMetadataView, metricName } from "./AgentMetadata";

const metric = (
	key: string,
	display_name: string,
	value: string,
): WorkspaceAgentMetadata => ({
	description: { key, display_name, script: "", interval: 10, timeout: 1 },
	result: {
		value,
		error: "",
		collected_at: new Date().toISOString(),
		age: 0,
	},
});

// the template before 1.34.1: the workspace's Load Avg before its Disk, and "Load Avg" as the name
const OLD_TEMPLATE = [
	metric("0_cpu_usage", "CPU", "0.6/6 cores (10%)"),
	metric("1_ram_usage", "RAM", "0.5/6.4 GB (7%)"),
	metric("2_load", "Load Avg", "0.13 / 6 cores (2%)"),
	metric("3_home_disk", "Disk", "0.3/20.0 GB (1%)"),
	metric("4_cpu_usage_host", "CPU", "2.8/24 cores (12%)"),
	metric("5_mem_usage_host", "RAM", "19.5/98.6 GB (20%)"),
	metric("6_disk_host", "Disk", "918.7/1003.7 GB (92%)"),
	metric("7_load_host", "Load Avg", "2.10 / 24 cores (9%)"),
];

const names = (group: string) =>
	within(screen.getByTestId(`metrics-group-${group}`))
		.getAllByText(/^(CPU|RAM|Disk|Ø Load|Load Avg)$/)
		.map((el) => el.textContent);

describe("AgentMetadataView: both groups in the same order", () => {
	it("CPU, RAM, Disk, Ø Load in Workspace and in Cluster", () => {
		renderComponent(
			<AgentMetadataView metadata={OLD_TEMPLATE} historyScope="order" />,
		);
		expect(names("workspace")).toEqual(["CPU", "RAM", "Disk", "Ø Load"]);
		expect(names("cluster")).toEqual(["CPU", "RAM", "Disk", "Ø Load"]);
	});

	it("whatever order the template has them in", () => {
		renderComponent(
			<AgentMetadataView
				metadata={[...OLD_TEMPLATE].reverse()}
				historyScope="reversed"
			/>,
		);
		expect(names("workspace")).toEqual(["CPU", "RAM", "Disk", "Ø Load"]);
		expect(names("cluster")).toEqual(["CPU", "RAM", "Disk", "Ø Load"]);
	});

	it("names a load average Ø Load", () => {
		for (const name of [
			"Load Avg",
			"Load Average",
			"Load Average (Host)",
			"Ø Load",
		]) {
			expect(metricName(metric("x", name, "1"))).toBe("Ø Load");
		}
		expect(metricName(metric("x", "CPU Usage (Host)", "1"))).toBe("CPU Usage");
	});
});
