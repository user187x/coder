import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MockImageStoreImages } from "#/testHelpers/imageStore";
import { render } from "#/testHelpers/renderHelpers";
import { ImageStoreGrid } from "./ImageStoreGrid";

it("chooses the requested picture from a large gallery with the keyboard", async () => {
	const onChoose = vi.fn();
	const user = userEvent.setup();
	render(
		<ImageStoreGrid
			images={MockImageStoreImages}
			layout="grid"
			onChoose={onChoose}
		/>,
	);
	const image = MockImageStoreImages[27];
	screen.getByRole("radio", { name: image.name }).focus();
	await user.keyboard("{Enter}");
	expect(onChoose).toHaveBeenCalledExactlyOnceWith(image);
});
