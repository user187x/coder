import { render, screen, within } from "@testing-library/react";
import {
	MockWorkspaceAgent,
	MockWorkspaceApp,
	MockWorkspaceResource,
} from "#/testHelpers/entities";
import { TemplateAppsPanel } from "./TemplateAppsPanel";

describe("TemplateAppsPanel", () => {
	it("shows the agent and its apps as centered tiles, the built-in ones after", () => {
		render(
			<TemplateAppsPanel
				resources={[
					{
						...MockWorkspaceResource,
						workspace_transition: "start",
						agents: [
							{
								...MockWorkspaceAgent,
								name: "main",
								operating_system: "linux",
								apps: [
									{
										...MockWorkspaceApp,
										slug: "nifi",
										display_name: "Apache NiFi",
									},
									{
										...MockWorkspaceApp,
										slug: "hidden",
										display_name: "Hidden",
										hidden: true,
									},
								],
								display_apps: ["web_terminal", "port_forwarding_helper"],
							},
						],
					},
				]}
			/>,
		);
		const panel = screen.getByTestId("template-apps");
		expect(panel).toHaveTextContent("Agent main");
		expect(panel).toHaveTextContent("linux");
		const list = screen.getByTestId("template-apps-list");
		expect(list).toHaveClass("justify-center");
		expect(
			within(list)
				.getAllByTestId("template-app")
				.map((t) => t.textContent),
		).toEqual(["Apache NiFi", "Terminal", "Ports"]);
	});

	it("is nothing without an agent", () => {
		const { container } = render(
			<TemplateAppsPanel
				resources={[{ ...MockWorkspaceResource, agents: [] }]}
			/>,
		);
		expect(container).toBeEmptyDOMElement();
	});
});
