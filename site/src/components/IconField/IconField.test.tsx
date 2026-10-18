import { fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "react-query";
import { PlatformAPI } from "#/api/platform";
import * as normalize from "#/modules/platform/normalizeImage";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { IconField } from "./IconField";

const renderField = (onPickEmoji = vi.fn()) => {
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<IconField value="" onPickEmoji={onPickEmoji} onChange={() => {}} />
		</QueryClientProvider>,
	);
	return onPickEmoji;
};

const openMenu = () =>
	fireEvent.pointerDown(
		screen.getByRole("button", { name: "Pick an emoji or icon" }),
		{ button: 0, ctrlKey: false },
	);

describe("IconField", () => {
	afterEach(() => vi.restoreAllMocks());

	it("offers the emoji picker and an image upload in its menu", async () => {
		renderField();
		openMenu();
		expect(await screen.findByTestId("icon-field-emoji")).toHaveTextContent(
			"Emoji or icon",
		);
		expect(screen.getByTestId("icon-field-upload")).toHaveTextContent(
			"Upload image",
		);
	});

	it("uploads a chosen image to the icon library under a free name, and uses it", async () => {
		vi.spyOn(PlatformAPI, "getTemplateIcons").mockResolvedValue({
			icons: [
				{
					name: "my-logo",
					type: "image/png",
					url: "",
					bytes: 1,
					uploadedBy: null,
					uploadedAt: "",
				},
			],
			canManage: true,
		} as never);
		vi.spyOn(normalize, "normalizeImage").mockResolvedValue({
			dataURL: "data:image/png;base64,AAAA",
		} as never);
		const upload = vi
			.spyOn(PlatformAPI, "uploadTemplateIcon")
			.mockResolvedValue({} as never);
		const picked = renderField();
		const file = new File(["png"], "My Logo.png", { type: "image/png" });
		fireEvent.change(screen.getByTestId("icon-field-file"), {
			target: { files: [file] },
		});
		await waitFor(() =>
			expect(upload).toHaveBeenCalledWith({
				name: "my-logo-2",
				dataUrl: "data:image/png;base64,AAAA",
			}),
		);
		await waitFor(() =>
			expect(picked).toHaveBeenCalledWith("/__coder-ui/icons/my-logo-2"),
		);
	});
});
