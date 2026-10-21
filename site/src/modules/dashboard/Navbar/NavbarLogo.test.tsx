import { fireEvent, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { hasTransparentCorners, NavbarLogo } from "./NavbarLogo";

/** A 2D context whose corner pixels have these alphas (top left, top right, bottom left, bottom right). */
const mockCanvas = (alphas: number[] | "tainted" | "none") => {
	let corner = 0;
	return vi
		.spyOn(HTMLCanvasElement.prototype, "getContext")
		.mockImplementation((() =>
			alphas === "none"
				? null
				: {
						drawImage: vi.fn(),
						getImageData: () => {
							if (alphas === "tainted") {
								throw new DOMException("tainted", "SecurityError");
							}
							return { data: [0, 0, 0, alphas[corner++]] };
						},
					}) as unknown as HTMLCanvasElement["getContext"]);
};

const renderLogo = () =>
	renderComponent(
		<MemoryRouter>
			<NavbarLogo />
		</MemoryRouter>,
	);

describe("hasTransparentCorners", () => {
	afterEach(() => vi.restoreAllMocks());

	it("is true when any corner shows through, false when all four are opaque", () => {
		const image = document.createElement("img");
		mockCanvas([255, 255, 255, 255]);
		expect(hasTransparentCorners(image)).toBe(false);
		vi.restoreAllMocks();
		mockCanvas([255, 255, 0, 255]);
		expect(hasTransparentCorners(image)).toBe(true);
	});

	it("counts a picture it cannot read as opaque", () => {
		const image = document.createElement("img");
		mockCanvas("tainted");
		expect(hasTransparentCorners(image)).toBe(false);
		vi.restoreAllMocks();
		mockCanvas("none");
		expect(hasTransparentCorners(image)).toBe(false);
	});
});

describe("NavbarLogo", () => {
	afterEach(() => vi.restoreAllMocks());

	it("sits in the avatar's tile, linking to the workspaces", () => {
		renderLogo();
		const link = screen.getByTestId("navbar-logo");
		expect(link).toHaveAttribute("href", "/workspaces");
		const tile = screen.getByTestId("navbar-logo-tile");
		expect(link.firstElementChild).toBe(tile);
		// the user menu's avatar tile: an Avatar of size lg, inset as the avatar's picture is
		for (const name of [
			"border",
			"border-solid",
			"bg-surface-secondary",
			"size-(--avatar-lg)",
			"rounded-[6px]",
			"overflow-hidden",
			"p-0.5",
		]) {
			expect(tile).toHaveClass(name);
		}
		expect(tile).toHaveAttribute("data-logo-shape", "pending");
	});

	it("crops an opaque logo to a rounded square", () => {
		mockCanvas([255, 255, 255, 255]);
		renderLogo();
		const image = screen.getByRole("img");
		fireEvent.load(image);
		expect(screen.getByTestId("navbar-logo-tile")).toHaveAttribute(
			"data-logo-shape",
			"opaque",
		);
		expect(image).toHaveClass("object-cover", "rounded-[6px]", "size-full");
	});

	it("shows a transparent logo whole, as it is", () => {
		mockCanvas([0, 0, 0, 0]);
		renderLogo();
		const image = screen.getByRole("img");
		fireEvent.load(image);
		expect(screen.getByTestId("navbar-logo-tile")).toHaveAttribute(
			"data-logo-shape",
			"transparent",
		);
		expect(image).toHaveClass("object-contain");
		expect(image).not.toHaveClass("object-cover");
		expect(image).not.toHaveClass("rounded-[6px]");
	});
});
