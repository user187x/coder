import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { createMemoryRouter } from "react-router";
import { MockHealth } from "#/testHelpers/entities";
import { renderWithRouter } from "#/testHelpers/renderHelpers";
import { server } from "#/testHelpers/server";
import { HealthSettingsTree } from "./HealthSettingsTree";

const countHealthRequests = () => {
	const requests: string[] = [];
	server.use(
		http.get("/api/v2/debug/health", ({ request }) => {
			requests.push(request.url);
			return HttpResponse.json(MockHealth);
		}),
	);
	return requests;
};

const renderAt = (path: string) =>
	renderWithRouter(
		createMemoryRouter([{ path: "*", element: <HealthSettingsTree /> }], {
			initialEntries: [path],
		}),
	);

describe("HealthSettingsTree", () => {
	it("reads the health report only once the tree is opened", async () => {
		const requests = countHealthRequests();
		const user = userEvent.setup();
		renderAt("/deployment/overview");

		await screen.findByRole("button", { name: "Health" });
		expect(requests).toHaveLength(0);

		await user.click(screen.getByRole("button", { name: "Health" }));
		await waitFor(() => expect(requests).toHaveLength(1));
	});

	it("starts open, with the report, on a health page", async () => {
		const requests = countHealthRequests();
		renderAt("/health/derp");

		await waitFor(() => expect(requests).toHaveLength(1));
	});
});
