import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PlatformAPI } from "#/api/platform";
import { PictureButton, pictureMarkdown } from "./PictureButton";

describe("PictureButton", () => {
	it("uploads the file as it is and inserts its Markdown", async () => {
		const upload = vi
			.spyOn(PlatformAPI, "uploadBannerPicture")
			.mockResolvedValue({
				id: "0123456789abcdef",
				url: "/__coder-ui/banner-picture/0123456789abcdef",
				name: "waving flag",
				type: "image/gif",
				bytes: 12,
			});
		const onInsert = vi.fn();
		render(<PictureButton onInsert={onInsert} onProblem={vi.fn()} />);
		expect(
			screen.getByRole("button", { name: /Upload picture/ }),
		).toBeInTheDocument();
		// The fit selector's choice (Span here, the default) goes into the picture's address.
		const gif = new File(["GIF89a-frames"], "waving flag.gif", {
			type: "image/gif",
		});
		fireEvent.change(screen.getByTestId("announcement-picture-input"), {
			target: { files: [gif] },
		});
		await waitFor(() =>
			expect(onInsert).toHaveBeenCalledWith(
				"![waving flag](/__coder-ui/banner-picture/0123456789abcdef#fit=span)",
			),
		);
		const [name, dataUrl] = upload.mock.calls[0];
		expect(name).toBe("waving flag.gif");
		expect(atob(dataUrl.split(",")[1])).toBe("GIF89a-frames");
	});

	it("refuses a picture over 8 MB before uploading it", () => {
		const upload = vi.spyOn(PlatformAPI, "uploadBannerPicture");
		const onProblem = vi.fn();
		render(<PictureButton onInsert={vi.fn()} onProblem={onProblem} />);
		const big = new File([new Uint8Array(8 * 1024 * 1024 + 1)], "big.png", {
			type: "image/png",
		});
		fireEvent.change(screen.getByTestId("announcement-picture-input"), {
			target: { files: [big] },
		});
		expect(onProblem).toHaveBeenCalledWith(
			"The picture must be smaller than 8 MB.",
		);
		expect(upload).not.toHaveBeenCalled();
	});

	it("inserts a preset picture with the fit chosen, without uploading anything", () => {
		const upload = vi.spyOn(PlatformAPI, "uploadBannerPicture");
		const onInsert = vi.fn();
		render(<PictureButton onInsert={onInsert} onProblem={vi.fn()} />);
		fireEvent.click(screen.getByTestId("announcement-preset-usa.gif"));
		expect(onInsert).toHaveBeenCalledWith("![usa](/pictures/usa.gif#fit=span)");
		expect(upload).not.toHaveBeenCalled();
		expect(screen.getByLabelText("Picture fit")).toBeInTheDocument();
	});

	it("keeps Markdown's own characters out of the description", () => {
		expect(pictureMarkdown("[x](y)*!.png", "/p")).toBe("![xy](/p#fit=span)");
		expect(pictureMarkdown(".gif", "/p", "tile")).toBe(
			"![picture](/p#fit=tile)",
		);
	});
});
