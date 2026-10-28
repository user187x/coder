import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "react-query";
import { PlatformAPI } from "#/api/platform";
import { lavaPicture } from "../lava/drawLava";
import { PREBAKED_BACKGROUNDS, PREBAKED_GALLERY } from "../pictures";
import { GalleryPicker } from "./GalleryPicker";

vi.mock("../lava/drawLava", () => ({
	lavaRenderer: () => () => {},
	lavaPicture: vi.fn(),
}));

const renderPicker = (
	props: Partial<React.ComponentProps<typeof GalleryPicker>>,
) =>
	render(
		<QueryClientProvider
			client={
				new QueryClient({ defaultOptions: { queries: { retry: false } } })
			}
		>
			<GalleryPicker onPick={() => {}} {...props} />
		</QueryClientProvider>,
	);

describe("GalleryPicker", () => {
	afterEach(() => vi.restoreAllMocks());

	it("offers the dashboard's own pictures even where the platform service has none", async () => {
		vi.spyOn(PlatformAPI, "getGallery").mockRejectedValue(
			new Error("no gallery"),
		);
		renderPicker({ extra: PREBAKED_BACKGROUNDS });
		const names = [...PREBAKED_BACKGROUNDS, ...PREBAKED_GALLERY].map(
			(p) => p.name,
		);
		for (const name of names) {
			expect(await screen.findByRole("radio", { name })).toBeInTheDocument();
		}
	});

	it("hands a built-in picture over as it is, without fetching it", async () => {
		vi.spyOn(PlatformAPI, "getGallery").mockResolvedValue({ images: [] });
		const fetchSpy = vi.spyOn(window, "fetch");
		const onPickBuiltin = vi.fn();
		const onPick = vi.fn();
		renderPicker({ extra: PREBAKED_BACKGROUNDS, onPick, onPickBuiltin });
		fireEvent.click(await screen.findByRole("radio", { name: "creeper.gif" }));
		await waitFor(() =>
			expect(onPickBuiltin).toHaveBeenCalledWith(PREBAKED_BACKGROUNDS[0]),
		);
		expect(onPick).not.toHaveBeenCalled();
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("makes a lava lamp with its dials and gives it as a file, at the chooser's size and limit", async () => {
		vi.spyOn(PlatformAPI, "getGallery").mockResolvedValue({ images: [] });
		const file = new File(["GIF89a"], "lava.gif", { type: "image/gif" });
		vi.mocked(lavaPicture).mockResolvedValue(file);
		const onPick = vi.fn();
		const lava = { size: 256, maxBytes: 4 * 1024 * 1024 };
		renderPicker({ onPick, tile: "round", lava });
		await userEvent.click(screen.getByRole("button", { name: /Lava lamp/ }));
		await userEvent.click(
			await screen.findByRole("button", { name: "Add lava" }),
		);
		await userEvent.click(screen.getByRole("button", { name: "Use this" }));
		await waitFor(() => expect(onPick).toHaveBeenCalledWith(file));
		const [settings, output] = vi.mocked(lavaPicture).mock.calls[0];
		expect(settings.blobs).toHaveLength(7);
		expect(settings.size).toBe(100);
		expect(output).toEqual(lava);
	});
});
