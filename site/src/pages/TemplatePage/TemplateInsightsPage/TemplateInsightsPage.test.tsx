import { screen } from "@testing-library/react";
import type { TemplateParameterUsage } from "#/api/typesGenerated";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { TemplateInsightsPageView } from "./TemplateInsightsPage";

const parameter = (
	name: string,
	type: string,
	value: string,
): TemplateParameterUsage => ({
	template_ids: ["7dd1d090-3e23-4ada-8894-3945affcad42"],
	display_name: "",
	name,
	type,
	description: "",
	values: [{ value, count: 1 }],
});

const renderParameters = (parameters_usage: TemplateParameterUsage[]) =>
	renderComponent(
		<TemplateInsightsPageView
			controls={null}
			interval="day"
			templateInsights={{
				data: {
					interval_reports: [],
					report: {
						start_time: "",
						end_time: "",
						template_ids: [],
						active_users: 0,
						apps_usage: [],
						parameters_usage,
					},
				},
				error: null,
			}}
			userLatency={{ data: undefined, error: null }}
			userActivity={{ data: undefined, error: null }}
		/>,
	);

describe("TemplateInsightsPageView parameters usage", () => {
	it("shows a number parameter's value without quotes", () => {
		renderParameters([parameter("home_disk_size", "number", "20")]);
		const value = screen.getByText("20");
		expect(value.parentElement?.textContent).not.toContain('"');
	});

	it("shows a text parameter's value without quotes (a Start folder, a Workspace image)", () => {
		renderParameters([
			parameter("start_directory", "string", "/home/coder"),
			parameter(
				"workspace_image",
				"string",
				"ghcr.io/user187x/coder-workspace:1.8.7",
			),
		]);
		expect(screen.getByText("/home/coder").textContent).toBe("/home/coder");
		expect(
			screen.getByText("/home/coder").parentElement?.textContent,
		).not.toContain('"');
		expect(
			screen.getByText("ghcr.io/user187x/coder-workspace:1.8.7").parentElement
				?.textContent,
		).not.toContain('"');
	});
});
