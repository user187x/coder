import { fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "react-query";
import {
	PlatformAPI,
	type ProvisionersReport,
	type TerraformProcess,
} from "#/api/platform";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { formatAge, ProvisionerRekick } from "./ProvisionerRekick";

const apply: TerraformProcess = {
	pid: 12,
	state: "S",
	defunct: false,
	ageSeconds: 3690,
	command: "apply",
	args: "terraform apply",
};

const report: ProvisionersReport = {
	stuckAfterSeconds: 600,
	stuck: 1,
	daemons: [],
	jobs: [
		{
			id: "stuck-job",
			organization: "coder",
			status: "running",
			type: "workspace_build",
			startedAt: null,
			createdAt: null,
			ageSeconds: 3700,
			stuck: true,
			workerId: null,
			workspace: "ws1",
			template: "ubuntu",
		},
		{
			id: "fresh-job",
			organization: "coder",
			status: "running",
			type: "workspace_build",
			startedAt: null,
			createdAt: null,
			ageSeconds: 40,
			stuck: false,
			workerId: null,
			workspace: "ws2",
			template: "ubuntu",
		},
	],
	pods: {
		"coder-abc": [apply],
	},
};

describe("ProvisionerRekick", () => {
	afterEach(() => vi.restoreAllMocks());

	it("formats how long a job has run", () => {
		expect(formatAge(45)).toBe("45s");
		expect(formatAge(200)).toBe("3m 20s");
		expect(formatAge(3700)).toBe("1h 01m");
	});

	it("marks the stuck job and re-kicks only the stuck ones", async () => {
		vi.spyOn(PlatformAPI, "getProvisioners").mockResolvedValue(report);
		const rekick = vi
			.spyOn(PlatformAPI, "rekickProvisioners")
			.mockResolvedValue({
				cancelled: [{ id: "stuck-job", workspace: "ws1", error: null }],
				stopped: [{ ...apply, pod: "coder-abc" }],
				errors: [],
				stillRunning: [],
			});
		renderComponent(
			<QueryClientProvider client={new QueryClient()}>
				<ProvisionerRekick />
			</QueryClientProvider>,
		);
		expect(await screen.findAllByTestId("provisioner-job")).toHaveLength(2);
		expect(screen.getByText("Stuck")).toBeInTheDocument();
		expect(screen.getByText("apply 1h 01m")).toBeInTheDocument();
		fireEvent.click(
			screen.getByRole("button", { name: /Re-kick stuck jobs \(1\)/ }),
		);
		await waitFor(() => expect(rekick).toHaveBeenCalledWith(["stuck-job"]));
		expect(await screen.findByText("Re-kicked")).toBeInTheDocument();
	});
});
