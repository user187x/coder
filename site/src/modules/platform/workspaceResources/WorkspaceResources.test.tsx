import { screen } from "@testing-library/react";
import { PlatformAPI } from "#/api/platform";
import type { Workspace, WorkspaceAgentMetadata } from "#/api/typesGenerated";
import {
	MockStoppedWorkspace,
	MockWorkspace,
	MockWorkspaceAgent,
} from "#/testHelpers/entities";
import { render } from "#/testHelpers/renderHelpers";
import {
	readingOf,
	resourceBuckets,
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

beforeEach(() => {
	vi.spyOn(PlatformAPI, "getWorkspaceResourceHistory").mockResolvedValue({
		windowSeconds: 300,
		asOf: 300000,
		agents: {},
	});
});

it("places only the trailing five minutes in fixed buckets, averaging within each interval", () => {
	const samples = [
		{ t: -1, share: 100 },
		{ t: 1000, share: 10 },
		{ t: 2000, share: 30 },
		{ t: 300000, share: 60 },
		{ t: 300001, share: 100 },
	];
	const result = resourceBuckets(samples, 300000);
	expect(result).toHaveLength(12);
	expect(result[0]).toBe(20);
	expect(result.slice(1, 11)).toEqual(Array(10).fill(null));
	expect(result[11]).toBe(60);
	expect(resourceBuckets(samples, 900000)).toEqual(Array(12).fill(null));
});

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
		render(<WorkspaceResources workspace={MockStoppedWorkspace} />);
		expect(screen.getByTestId("workspace-resources-none")).toHaveTextContent(
			"—",
		);
	});

	it("loads the continuously sampled history for this workspace", async () => {
		render(<WorkspaceResources workspace={running} />);
		sockets[0].send([metric("0_cpu_usage", "CPU", "0.1/2 cores (6%)")]);
		await vi.waitFor(() =>
			expect(PlatformAPI.getWorkspaceResourceHistory).toHaveBeenCalledWith(
				running.id,
				300,
				12,
			),
		);
	});
});
