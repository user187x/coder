import { render, screen } from "@testing-library/react";
import { MockAuthMethodsAll } from "#/testHelpers/entities";
import { OAuthSignInForm } from "./OAuthSignInForm";

const withOidc = (signInText: string, iconUrl: string) => ({
	...MockAuthMethodsAll,
	oidc: { enabled: true, signInText, iconUrl },
});

describe("OAuthSignInForm", () => {
	it("is Keycloak's logo, with no text, when the provider is Keycloak", () => {
		const { container } = render(
			<OAuthSignInForm
				isSigningIn={false}
				redirectTo="/workspaces"
				authMethods={withOidc(
					"Sign in with your certificate",
					"/icon/keycloak.svg",
				)}
			/>,
		);
		const link = screen.getByRole("link", {
			name: "Sign in with your certificate",
		});
		expect(link).toHaveAttribute(
			"href",
			"/api/v2/users/oidc/callback?redirect=%2Fworkspaces",
		);
		expect(link.querySelector("img")).toHaveAttribute(
			"src",
			"/keycloak-sign-in.png",
		);
		expect(container.textContent).toBe("");
	});

	it("is a large icon button, with no text, for another provider", () => {
		const { container } = render(
			<OAuthSignInForm
				isSigningIn={false}
				redirectTo="/"
				authMethods={withOidc("Sign in with Okta", "")}
			/>,
		);
		const link = screen.getByRole("link", { name: "Sign in with Okta" });
		expect(link.querySelector("img")).toBeNull();
		expect(link.querySelector("svg")).not.toBeNull();
		expect(container.textContent).toBe("");
	});

	it("is nothing without OIDC", () => {
		const { container } = render(
			<OAuthSignInForm
				isSigningIn={false}
				redirectTo="/"
				authMethods={{
					...MockAuthMethodsAll,
					oidc: { enabled: false, signInText: "", iconUrl: "" },
				}}
			/>,
		);
		expect(container).toBeEmptyDOMElement();
	});
});
