import { screen } from "@testing-library/react";
import type { Workspace, WorkspaceAgentMetadata } from "#/api/typesGenerated";
import {
	MockStoppedWorkspace,
	MockWorkspace,
	MockWorkspaceAgent,
} from "#/testHelpers/entities";
import { renderComponent } from "#/testHelpers/renderHelpers";
import {
	DISK_SEGMENTS,
	readingOf,
	segmentTone,
	WorkspaceResources,
} from "./WorkspaceResources";

const metric = (
	key: string,
	display_name: string,
	value: string,
	collected_at = "2026-10-21T06:00:00Z",
): WorkspaceAgentMetadata => ({
	description: { key, display_name, script: "", interval: 1, timeout: 1 },
	result: { value, error: "", age: 0, collected_at },
});

// the page's socket, as the test's: it hands each listener's message on
const sockets: { send: (data: WorkspaceAgentMetadata[]) => void }[] = [];
vi.mock("#/api/api", async (original) => ({
	...(await original<object>()),
	watchAgentMetadata: () => {
		const listeners: ((e: unknown) => void)[] = [];
		const socket = {
			addEventListener: (type: string, fn: (e: unknown) => void) => {
				if (type === "message") {
					listeners.push(fn);
				}
			},
			close: () => {},
		};
		sockets.push({
			send: (data) => {
				for (const fn of listeners) {
					fn({ parseError: null, parsedMessage: { type: "data", data } });
				}
			},
		});
		return socket;
	},
}));

const running: Workspace = {
	...MockWorkspace,
	latest_build: {
		...MockWorkspace.latest_build,
		status: "running",
		resources: [
			{
				...MockWorkspace.latest_build.resources[0],
				agents: [
					{ ...MockWorkspaceAgent, status: "connected", parent_id: null },
				],
			},
		],
	},
};

describe("WorkspaceResources", () => {
	beforeEach(() => {
		sockets.length = 0;
	});

	it("reads a share from a percentage, else from the fraction", () => {
		expect(readingOf(metric("0_cpu", "CPU", "0.1/2 cores (6%)"))).toEqual({
			share: 6,
			text: "0.1/2 cores",
		});
		expect(readingOf(metric("2_disk", "Disk", "2.5/10.0 GB"))).toEqual({
			share: 25,
			text: "2.5/10.0 GB",
		});
		expect(readingOf(metric("x", "X", "n/a"))).toBeNull();
	});

	it("colours a disk segment by where it sits along the bar, in the theme's colours", () => {
		expect(segmentTone(50)).toBe("bg-content-success");
		expect(segmentTone(80)).toBe("bg-content-warning");
		expect(segmentTone(100)).toBe("bg-content-destructive");
	});

	it("shows a dash for a workspace that is not running", () => {
		renderComponent(<WorkspaceResources workspace={MockStoppedWorkspace} />);
		expect(screen.getByTestId("workspace-resources-none")).toHaveTextContent(
			"—",
		);
	});

	it("draws CPU and RAM as live bars and the disk used of what was given", async () => {
		renderComponent(<WorkspaceResources workspace={running} />);
		expect(sockets).toHaveLength(1);
		const readings = (at: string, cpu: string) => [
			metric("0_cpu_usage", "CPU", cpu, at),
			metric("1_ram_usage", "RAM", "0.3/2.2 GB (15%)", at),
			metric("3_home_disk", "Disk", "0.1/10.0 GB (1%)", at),
			// the cluster's, not the workspace's: left out
			metric("0_cpu_usage_host", "CPU (Host)", "20/24 cores (83%)", at),
		];
		sockets[0].send(readings("2026-10-21T06:00:00Z", "0.1/2 cores (6%)"));
		const cpu = await screen.findByTestId("workspace-resources-cpu");
		expect(cpu).toHaveTextContent("CPU6%");
		expect(screen.getByTestId("workspace-resources-ram")).toHaveTextContent(
			"RAM15%",
		);
		const disk = screen.getByTestId("workspace-resources-disk");
		expect(disk).toHaveTextContent("0.1 / 10.0 GB");
		expect(disk).toHaveAttribute(
			"title",
			"Disk: 0.1 / 10.0 GB (used / allocated)",
		);
		expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "1");
		// a segmented bar: one segment lit for 1 % (anything used shows), the rest empty
		const segments = screen.getAllByTestId("workspace-resources-segment");
		expect(segments).toHaveLength(DISK_SEGMENTS);
		expect(segments.filter((s) => s.dataset.lit)).toHaveLength(1);
		expect(segments[0]).toHaveClass("bg-content-success");
		expect(segments[1]).toHaveClass("bg-surface-tertiary");
		// rounded edges: the disk bar's ends, the graphs' corners (their bars cut to them)
		expect(screen.getByRole("meter")).toHaveClass(
			"rounded-full",
			"overflow-hidden",
		);
		const ground = cpu.querySelector(
			'[data-testid="workspace-resources-ground"]',
		);
		expect(Number(ground?.getAttribute("rx"))).toBeGreaterThanOrEqual(4);
		const clipped = cpu.querySelector("g[clip-path]");
		expect(
			clipped?.querySelector('[data-testid="workspace-resources-bar"]'),
		).not.toBeNull();
		expect(
			cpu.querySelector(
				clipped?.getAttribute("clip-path")?.slice(4, -1) ?? "#none",
			),
		).not.toBeNull();

		// a new reading adds a bar; the same one again does not
		sockets[0].send(readings("2026-10-21T06:00:01Z", "1.2/2 cores (60%)"));
		sockets[0].send(readings("2026-10-21T06:00:01Z", "1.2/2 cores (60%)"));
		expect(await screen.findByText("60%")).toBeInTheDocument();
		expect(
			cpu.querySelectorAll('[data-testid="workspace-resources-bar"]'),
		).toHaveLength(2);
	});
});
