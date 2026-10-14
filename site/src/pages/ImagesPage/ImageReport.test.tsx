import { fireEvent, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "react-query";
import { ImagesAPI, type ImageReport as Report } from "#/api/images";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { ImageReport } from "./ImageReport";

const report = (): Report =>
	({
		ref: "coder-workspace:1.8.4",
		scannedAt: new Date().toISOString(),
		grade: "B",
		dbUpdatedAt: null,
		vulnerabilities: {
			counts: { MEDIUM: 1 },
			total: 1,
			fixable: 0,
			scanned: true,
			top: [
				{
					id: "CVE-2026-0001",
					pkg: "jq",
					installed: "1.8.1",
					fixed: "",
					severity: "MEDIUM",
					title: "a counted one",
					target: "ubuntu",
				},
			],
			notApplicable: [
				{
					rule: "kernel-headers",
					reason:
						"Linux kernel vulnerabilities ... a container runs its node's kernel.",
					total: 2625,
					counts: { HIGH: 22, MEDIUM: 2603 },
					packages: ["linux-libc-dev"],
					items: [
						{
							id: "CVE-2026-4242",
							pkg: "linux-libc-dev",
							installed: "7.0.0-38.38",
							fixed: "",
							severity: "HIGH",
							title: "kernel: ...",
							target: "ubuntu",
						},
					],
				},
			],
		},
		secrets: [],
		checks: [],
		fips: { status: "not-ready", note: "", checks: [] },
	}) as unknown as Report;

describe("ImageReport", () => {
	it("lists what does not apply to a container apart, with its reason, outside the counts", async () => {
		vi.spyOn(ImagesAPI, "securityData").mockResolvedValue(
			{} as Awaited<ReturnType<typeof ImagesAPI.securityData>>,
		);
		renderComponent(
			<QueryClientProvider client={new QueryClient()}>
				<ImageReport report={report()} summary={null} />
			</QueryClientProvider>,
		);
		// the counts are the counted findings only
		expect(
			screen.getByRole("group", { name: "Severity" }).textContent,
		).not.toMatch(/high/i);
		const na = screen.getByTestId("image-report-not-applicable");
		expect(na.textContent).toContain(
			"linux-libc-dev: 2625 (22 high, 2603 medium)",
		);
		fireEvent.click(na.querySelector("summary") as HTMLElement);
		expect(na.textContent).toContain("a container runs its node's kernel");
		expect(na.textContent).toContain("CVE-2026-4242");
		expect(na.textContent).toContain("and 2624 more");
	});
});
