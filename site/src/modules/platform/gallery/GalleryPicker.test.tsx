import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "react-query";
import { PlatformAPI } from "#/api/platform";
import { PREBAKED_BACKGROUNDS, PREBAKED_GALLERY } from "../pictures";
import { GalleryPicker } from "./GalleryPicker";

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
});
