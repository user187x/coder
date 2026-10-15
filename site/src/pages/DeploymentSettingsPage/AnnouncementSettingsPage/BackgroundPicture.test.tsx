import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlatformAPI } from "#/api/platform";
import { PictureFitSelect, UploadImageButton } from "./BackgroundPicture";

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
		render(
			<UploadImageButton picture="" onChange={onChange} onProblem={vi.fn()} />,
		);
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
		render(
			<UploadImageButton picture="" onChange={vi.fn()} onProblem={onProblem} />,
		);
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

	it("offers the preset images under its arrow, without uploading anything", async () => {
		const upload = vi.spyOn(PlatformAPI, "uploadBannerPicture");
		const onChange = vi.fn();
		render(
			<UploadImageButton picture="" onChange={onChange} onProblem={vi.fn()} />,
		);
		await userEvent.click(screen.getByTestId("announcement-preset-menu"));
		await userEvent.click(
			await screen.findByTestId("announcement-preset-usa.gif"),
		);
		expect(onChange).toHaveBeenCalledWith("/pictures/usa.gif");
		expect(upload).not.toHaveBeenCalled();
	});

	it("shows the image chosen, and takes it away", async () => {
		const onChange = vi.fn();
		render(
			<UploadImageButton
				picture="/pictures/usa.gif"
				onChange={onChange}
				onProblem={vi.fn()}
			/>,
		);
		expect(screen.getByAltText("The banner's background")).toHaveAttribute(
			"src",
			"/pictures/usa.gif",
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Remove the background image" }),
		);
		expect(onChange).toHaveBeenCalledWith("");
	});
});

describe("PictureFitSelect", () => {
	it("waits for an image", () => {
		render(<PictureFitSelect value="span" disabled onChange={vi.fn()} />);
		expect(screen.getByLabelText("Background image fit")).toBeDisabled();
	});
});
