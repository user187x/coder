import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "react-query";
import { PlatformAPI } from "#/api/platform";
import { render } from "#/testHelpers/renderHelpers";
import { GalleryPicker } from "./GalleryPicker";

const store = {
	name: "synthsun.gif",
	url: "/__coder-ui/image-store/synthsun.gif?v=1",
	thumb: "/__coder-ui/image-store/thumbs/synthsun.gif?v=1",
	type: "image/gif",
	source: "store" as const,
};

const renderPicker = (
	props: Partial<React.ComponentProps<typeof GalleryPicker>>,
) =>
	render(
		<QueryClientProvider client={new QueryClient()}>
			<GalleryPicker onPick={vi.fn()} {...props} />
		</QueryClientProvider>,
	);

describe("GalleryPicker on the image store", () => {
	beforeEach(() => {
		vi.spyOn(PlatformAPI, "getImageStore").mockResolvedValue({
			images: [store],
		});
	});
	afterEach(() => vi.restoreAllMocks());

	it("gives a background a provided picture as its address (nothing uploaded)", async () => {
		const onPickBuiltin = vi.fn();
		const onPick = vi.fn();
		renderPicker({ onPick, onPickBuiltin });
		await userEvent.click(
			await screen.findByRole("radio", { name: "synthsun.gif" }),
		);
		expect(onPickBuiltin).toHaveBeenCalledWith({
			name: "synthsun.gif",
			url: "/__coder-ui/image-store/synthsun.gif",
			type: "image/gif",
		});
		expect(onPick).not.toHaveBeenCalled();
	});

	it("gives an avatar or a logo the picture as a file, fetched from the store", async () => {
		const onPick = vi.fn();
		vi.spyOn(window, "fetch").mockResolvedValue(
			new Response(new Blob(["GIF89a"], { type: "image/gif" })),
		);
		renderPicker({ onPick, tile: "round" });
		await userEvent.click(
			await screen.findByRole("radio", { name: "synthsun.gif" }),
		);
		await waitFor(() => expect(onPick).toHaveBeenCalled());
		const file = onPick.mock.calls[0][0] as File;
		expect([file.name, file.type]).toEqual(["synthsun.gif", "image/gif"]);
		expect(window.fetch).toHaveBeenCalledWith(store.url, {
			credentials: "same-origin",
		});
	});
});
