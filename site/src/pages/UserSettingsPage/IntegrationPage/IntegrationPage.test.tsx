import { screen } from "@testing-library/react";
import { MockBuildInfo } from "#/testHelpers/entities";
import { render } from "#/testHelpers/renderHelpers";
import { IntegrationPageView } from "./IntegrationPage";

/** Each row's label and value, in order: CLI, Dashboard, Agent, Coder, Release date. */
const rows = () =>
	screen
		.getAllByRole("term")
		.map((term, i) => [
			term.textContent,
			screen.getAllByRole("definition")[i]?.textContent,
		]);
const value = (label: string) => rows().find(([l]) => l === label)?.[1];

it("shows the deployment's versions, its release date and the CLI to download", () => {
	render(
		<IntegrationPageView
			build={{
				...MockBuildInfo,
				version: "v1.8.36+abc1234",
				agent_api_version: "2.4",
				dashboard_url: "https://coder.example.com",
				build_time: "2026-11-08T17:03:45Z",
			}}
		/>,
	);
	expect(value("CLI version")).toBe("v1.8.36+abc1234");
	expect(value("Agent version")).toBe("v1.8.36+abc1234API 2.4");
	expect(value("Dashboard")).toBe("https://coder.example.comv1.8.36+abc1234");
	expect(value("Release date")).toMatch(/^November 8, 2026/);
	expect(
		screen.getByRole("link", { name: /Download the CLI/ }),
	).toHaveAttribute("href", "/bin/coder-linux-amd64");
});

it("says when the build records no release date", () => {
	render(<IntegrationPageView build={{ ...MockBuildInfo }} />);
	expect(value("Release date")).toBe("Not recorded in this build");
});
