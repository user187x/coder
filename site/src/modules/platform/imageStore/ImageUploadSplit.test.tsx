import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "react-query";
import { PlatformAPI } from "#/api/platform";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { ImageUploadSplit } from "./ImageUploadSplit";

const store = {
	name: "synthsun.gif",
	url: "/__coder-ui/image-store/synthsun.gif?v=1",
	thumb: "/__coder-ui/image-store/thumbs/synthsun.gif?v=1",
	type: "image/gif",
	source: "store" as const,
};

describe("ImageUploadSplit", () => {
	beforeEach(() => {
		vi.spyOn(PlatformAPI, "getImageStore").mockResolvedValue({
			images: [store],
		});
	});
	afterEach(() => vi.restoreAllMocks());

	it("uploads with Upload; its arrow opens the image store in a dialog, a pick closing it", async () => {
		const onUpload = vi.fn();
		const onPickBuiltin = vi.fn();
		renderComponent(
			<QueryClientProvider client={new QueryClient()}>
				<ImageUploadSplit
					testId="bg"
					title="Dashboard background"
					onUpload={onUpload}
					gallery={{ onPick: vi.fn(), onPickBuiltin }}
				/>
			</QueryClientProvider>,
		);
		await userEvent.click(screen.getByTestId("bg-upload"));
		expect(onUpload).toHaveBeenCalled();
		// nothing of the store on the page (no animated previews) until the arrow opens it
		expect(screen.queryByTestId("image-store-grid")).toBeNull();

		await userEvent.click(screen.getByTestId("bg-store"));
		const dialog = await screen.findByRole("dialog", {
			name: "Dashboard background",
		});
		expect(await screen.findByTestId("image-store-grid")).toHaveAttribute(
			"data-layout",
			"grid",
		);
		await userEvent.click(
			await screen.findByRole("radio", { name: "synthsun.gif" }),
		);
		expect(onPickBuiltin).toHaveBeenCalledWith(
			expect.objectContaining({ name: "synthsun.gif" }),
		);
		await waitFor(() => expect(dialog).not.toBeInTheDocument());
	});
});
