import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { API } from "#/api/api";
import { MockAuditLog } from "#/testHelpers/entities";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import { SecurityActivity } from "./SecurityActivity";

it("filters and pages actual audit requests", async () => {
	const get = vi.spyOn(API, "getAuditLogs").mockResolvedValue({
		audit_logs: [MockAuditLog],
		count: 30,
		count_cap: 2000,
	});
	const user = userEvent.setup();
	renderWithAuth(<SecurityActivity />);
	await user.click(await screen.findByRole("button", { name: "Sign-ins" }));
	await waitFor(() =>
		expect(get).toHaveBeenCalledWith({
			q: "action:login",
			offset: 0,
			limit: 25,
		}),
	);
	await user.click(screen.getByRole("button", { name: "Older events" }));
	await waitFor(() =>
		expect(get).toHaveBeenCalledWith({
			q: "action:login",
			offset: 25,
			limit: 25,
		}),
	);
	await user.clear(
		screen.getByRole("textbox", { name: "Filter security logs" }),
	);
	await user.type(
		screen.getByRole("textbox", { name: "Filter security logs" }),
		"username:admin",
	);
	await user.click(screen.getByRole("button", { name: "Search logs" }));
	await waitFor(() =>
		expect(get).toHaveBeenCalledWith({
			q: "username:admin",
			offset: 0,
			limit: 25,
		}),
	);
});
