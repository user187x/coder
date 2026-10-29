import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { MockWorkspace } from "#/testHelpers/entities";
import { render } from "#/testHelpers/renderHelpers";
import { server } from "#/testHelpers/server";
import { SandboxControl } from "./SandboxControl";

it("applies sandbox membership to the chosen workspace", async () => {
	const submitted = vi.fn();
	server.use(
		http.get("/__coder-ui/api/sandbox/:org", () =>
			HttpResponse.json({ groups: [] }),
		),
		http.get("/api/v2/workspaces", () =>
			HttpResponse.json({ workspaces: [MockWorkspace], count: 1 }),
		),
		http.post("/__coder-ui/api/sandbox/:org", async ({ request }) => {
			submitted(await request.json());
			return HttpResponse.json({ groups: [] });
		}),
	);
	render(<SandboxControl workspace={MockWorkspace} />);
	await userEvent.click(
		await screen.findByRole("button", { name: "Apply sandbox" }),
	);
	await waitFor(() =>
		expect(submitted).toHaveBeenCalledWith({
			workspace_ids: [MockWorkspace.id],
		}),
	);
});
