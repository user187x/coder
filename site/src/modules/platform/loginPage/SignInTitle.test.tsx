import { screen } from "@testing-library/react";
import { LOGIN_PAGE_DEFAULT } from "#/api/platform";
import { renderComponent } from "#/testHelpers/renderHelpers";
import {
	clearSignedOut,
	justSignedOut,
	markSignedOut,
	SignInTitle,
} from "./SignInTitle";

describe("SignInTitle", () => {
	afterEach(() => clearSignedOut());

	it("is the deployment's name, traced, by default", () => {
		renderComponent(
			<SignInTitle
				settings={LOGIN_PAGE_DEFAULT}
				applicationName="Coder"
				signedOut={false}
			/>,
		);
		const title = screen.getByTestId("contour-title");
		expect(title).toHaveAccessibleName("Coder");
		expect(title.dataset.effect).toBe("wireframe");
		// the default colour is left to the stylesheet (darker on the light themes)
		expect(title.style.getPropertyValue("--fx-color")).toBe("");
		expect(title.style.getPropertyValue("--fx-speed")).toBe("3.2s");
		expect(screen.queryByTestId("sign-in-message")).toBeNull();
	});

	it("takes the title, effect, colour, speed and messages set in Customize", () => {
		const settings = {
			...LOGIN_PAGE_DEFAULT,
			title: "Mission Control",
			effect: "neon" as const,
			color: "#ff4fd8",
			speed: 1.5,
			message: "Authorised users only.",
			signedOutMessage: "You are signed out.",
		};
		const { rerender } = renderComponent(
			<SignInTitle
				settings={settings}
				applicationName="Coder"
				signedOut={false}
			/>,
		);
		const title = screen.getByTestId("contour-title");
		expect(title).toHaveAccessibleName("Mission Control");
		expect(title.dataset.effect).toBe("neon");
		expect(title.style.getPropertyValue("--fx-color")).toBe("#ff4fd8");
		expect(title.style.getPropertyValue("--fx-speed")).toBe("1.5s");
		expect(screen.getByTestId("sign-in-message").textContent).toBe(
			"Authorised users only.",
		);
		rerender(
			<SignInTitle settings={settings} applicationName="Coder" signedOut />,
		);
		expect(screen.getByTestId("sign-in-message").textContent).toBe(
			"You are signed out.",
		);
	});

	it("signing out marks the tab, signing in clears it", () => {
		expect(justSignedOut()).toBe(false);
		markSignedOut();
		expect(justSignedOut()).toBe(true);
		clearSignedOut();
		expect(justSignedOut()).toBe(false);
	});
});
