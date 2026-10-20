import {
	fireEvent,
	render as rtlRender,
	screen,
	waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "react-query";
import { PlatformAPI } from "#/api/platform";

// the arrow reads the image store (a query)
const render = (ui: React.ReactElement) =>
	rtlRender(
		<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>,
	);

import {
	ChosenImage,
	PictureFitSelect,
	UploadImageButton,
} from "./BackgroundPicture";

describe("UploadImageButton", () => {
	it("uploads the file as it is and makes it the background", async () => {
		const upload = vi
			.spyOn(PlatformAPI, "uploadBannerPicture")
			.mockResolvedValue({
				id: "0123456789abcdef",
				url: "/__coder-ui/banner-picture/0123456789abcdef",
				name: "waving flag",
				type: "image/gif",
				bytes: 12,
			});
		const onChange = vi.fn();
		render(<UploadImageButton onChange={onChange} onProblem={vi.fn()} />);
		expect(
			screen.getByRole("button", { name: /Upload image/ }),
		).toBeInTheDocument();
		const gif = new File(["GIF89a-frames"], "waving flag.gif", {
			type: "image/gif",
		});
		fireEvent.change(screen.getByTestId("announcement-picture-input"), {
			target: { files: [gif] },
		});
		await waitFor(() =>
			expect(onChange).toHaveBeenCalledWith(
				"/__coder-ui/banner-picture/0123456789abcdef",
			),
		);
		const [name, dataUrl] = upload.mock.calls[0];
		expect(name).toBe("waving flag.gif");
		expect(atob(dataUrl.split(",")[1])).toBe("GIF89a-frames");
	});

	it("refuses an image over 8 MB before uploading it", () => {
		const upload = vi.spyOn(PlatformAPI, "uploadBannerPicture");
		const onProblem = vi.fn();
		render(<UploadImageButton onChange={vi.fn()} onProblem={onProblem} />);
		const big = new File([new Uint8Array(8 * 1024 * 1024 + 1)], "big.png", {
			type: "image/png",
		});
		fireEvent.change(screen.getByTestId("announcement-picture-input"), {
			target: { files: [big] },
		});
		expect(onProblem).toHaveBeenCalledWith(
			"The image must be smaller than 8 MB.",
		);
		expect(upload).not.toHaveBeenCalled();
	});

	it("offers the image store under its arrow - the presets, the provided pictures, the uploaded ones - without uploading anything", async () => {
		vi.spyOn(PlatformAPI, "getImageStore").mockResolvedValue({
			images: [
				{
					name: "synthsun.gif",
					url: "/__coder-ui/image-store/synthsun.gif?v=1",
					thumb: "/__coder-ui/image-store/thumbs/synthsun.gif?v=1",
					type: "image/gif",
					source: "store",
				},
				{
					name: "flag.png",
					url: "/__coder-ui/banner-picture/0123456789abcdef",
					type: "image/png",
					source: "uploaded",
				},
			],
		});
		const upload = vi.spyOn(PlatformAPI, "uploadBannerPicture");
		const onChange = vi.fn();
		render(<UploadImageButton onChange={onChange} onProblem={vi.fn()} />);
		await userEvent.click(screen.getByTestId("announcement-preset-menu"));
		await screen.findByRole("radio", { name: "synthsun.gif" });
		const names = screen
			.getAllByTestId("image-store-item")
			.map((el) => el.getAttribute("aria-label"));
		// the announcement's presets first, then the provided pictures, the rest baked in, the uploaded ones
		expect(names.slice(0, 3)).toEqual([
			"usa.gif",
			"background.gif",
			"synthsun.gif",
		]);
		expect(names.at(-1)).toBe("flag.png");
		// the provided picture's tile shows its small preview, not the picture itself
		expect(
			screen.getByRole("radio", { name: "synthsun.gif" }).querySelector("img"),
		).toHaveAttribute("src", "/__coder-ui/image-store/thumbs/synthsun.gif?v=1");
		await userEvent.click(screen.getByRole("radio", { name: "synthsun.gif" }));
		expect(onChange).toHaveBeenCalledWith(
			"/__coder-ui/image-store/synthsun.gif?v=1",
		);
		expect(upload).not.toHaveBeenCalled();
	});

	it("shows the image chosen, and takes it away", async () => {
		const onRemove = vi.fn();
		render(<ChosenImage picture="/pictures/usa.gif" onRemove={onRemove} />);
		expect(screen.getByAltText("The banner's background")).toHaveAttribute(
			"src",
			"/pictures/usa.gif",
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Remove the background image" }),
		);
		expect(onRemove).toHaveBeenCalled();
	});
});

describe("PictureFitSelect", () => {
	it("waits for an image", () => {
		render(<PictureFitSelect value="span" disabled onChange={vi.fn()} />);
		expect(screen.getByLabelText("Background image fit")).toBeDisabled();
	});
});
