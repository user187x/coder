import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImagesAPI } from "#/api/images";
import {
	MockNodeImageCleanupPlan,
	MockNodeImageCleanupResult,
} from "#/testHelpers/nodeImageCleanup";
import { render } from "#/testHelpers/renderHelpers";
import { NodeImageCleanup } from "./NodeImageCleanup";

afterEach(() => vi.restoreAllMocks());
it("previews the selection and sends only the reviewed image set after confirmation", async () => {
	const preview = vi
		.spyOn(ImagesAPI, "previewNodeImageCleanup")
		.mockResolvedValue(MockNodeImageCleanupPlan);
	const purge = vi
		.spyOn(ImagesAPI, "purgeNodeImages")
		.mockResolvedValue(MockNodeImageCleanupResult);
	vi.spyOn(ImagesAPI, "nodeImageCleanup").mockResolvedValue(
		MockNodeImageCleanupResult,
	);
	render(<NodeImageCleanup images={["old:v1"]} />);
	const user = userEvent.setup();
	await user.click(screen.getByRole("button", { name: "Purge selected" }));
	await waitFor(() => expect(preview).toHaveBeenCalledWith(["old:v1"]));
	expect(purge).not.toHaveBeenCalled();
	await user.click(
		screen.getByRole("button", { name: "Purge reviewed images" }),
	);
	await waitFor(() =>
		expect(purge).toHaveBeenCalledWith(MockNodeImageCleanupPlan),
	);
});
it("does not purge when the review fails or is canceled", async () => {
	vi.spyOn(ImagesAPI, "previewNodeImageCleanup").mockRejectedValue(
		new Error("Workload still references the image"),
	);
	const purge = vi.spyOn(ImagesAPI, "purgeNodeImages");
	render(<NodeImageCleanup images={["old:v1"]} />);
	const user = userEvent.setup();
	await user.click(screen.getByRole("button", { name: "Purge selected" }));
	await user.click(screen.getByRole("button", { name: "Cancel" }));
	expect(purge).not.toHaveBeenCalled();
});
