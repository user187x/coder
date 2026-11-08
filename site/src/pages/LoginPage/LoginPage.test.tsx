import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { createMemoryRouter } from "react-router";
import { ShortTermLeasesAPI } from "#/api/shortTermLeases";
import { MockUserOwner } from "#/testHelpers/entities";
import {
	render,
	renderWithRouter,
	waitForLoaderToBeRemoved,
} from "#/testHelpers/renderHelpers";
import { server } from "#/testHelpers/server";
import LoginPage from "./LoginPage";
import { SignInForm } from "./SignInForm";

describe("LoginPage", () => {
	// Capture original values before any test stubs take effect.
	const origLocationOrigin = location.origin;
	const origLocationHref = location.href;
	const locationHrefSpy = vi.fn();

	beforeEach(() => {
		server.use(
			// Appear logged out
			http.get("/api/v2/users/me", () => {
				return HttpResponse.json({ message: "no user here" }, { status: 401 });
			}),
		);
		// Stub the location global so tests can intercept server-side redirects
		// without actually navigating away.
		vi.stubGlobal("location", {
			origin: origLocationOrigin,
			get href() {
				return origLocationHref;
			},
			set href(url: string) {
				locationHrefSpy(url);
			},
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		locationHrefSpy.mockReset();
	});

	it("shows an error message if SignIn fails", async () => {
		// Given
		const apiErrorMessage = "Something wrong happened";
		server.use(
			// Make login fail
			http.post("/api/v2/users/login", async () => {
				return HttpResponse.json({ message: apiErrorMessage }, { status: 500 });
			}),
		);

		// When
		render(<LoginPage />);
		await waitForLoaderToBeRemoved();
		const email = screen.getByLabelText(/Username or email/i);
		const password = screen.getByLabelText(/Password/);
		await userEvent.type(email, "test@coder.com");
		await userEvent.type(password, "password");
		// Click sign-in
		const signInButton = await screen.findByText("Sign In");
		fireEvent.click(signInButton);

		// Then
		const errorMessage = await screen.findByText(apiErrorMessage);
		expect(errorMessage).toBeDefined();
	});

	it("associates email validation errors with the email input", async () => {
		// When
		render(<LoginPage />);
		await waitForLoaderToBeRemoved();

		const emailInput = screen.getByLabelText(/Username or email/i);
		const passwordInput = screen.getByLabelText(/Password/);
		expect(emailInput).not.toHaveAttribute("aria-invalid", "true");
		expect(emailInput).not.toHaveAttribute(
			"aria-describedby",
			"signin-email-error",
		);
		expect(passwordInput).not.toHaveAttribute("aria-invalid", "true");
		expect(passwordInput).not.toHaveAttribute(
			"aria-describedby",
			"signin-password-error",
		);

		const signInButton = await screen.findByText("Sign In");
		fireEvent.click(signInButton);

		// Then
		const emailError = await screen.findByText(
			"Please enter your username or email.",
		);
		expect(emailInput).toHaveAttribute("aria-invalid", "true");
		expect(emailInput).toHaveAttribute(
			"aria-describedby",
			"signin-email-error",
		);

		const emailErrorElement = document.getElementById("signin-email-error");
		expect(emailErrorElement).toBe(emailError);
		expect(emailErrorElement).toHaveTextContent(
			"Please enter your username or email.",
		);

		expect(passwordInput).not.toHaveAttribute("aria-invalid", "true");
		expect(passwordInput).not.toHaveAttribute(
			"aria-describedby",
			"signin-password-error",
		);
		expect(document.getElementById("signin-password-error")).toBeNull();
	});

	it("redirects to the setup page if there is no first user", async () => {
		// Given
		server.use(
			// No first user
			http.get("/api/v2/users/first", () => {
				return new HttpResponse(null, { status: 404 });
			}),
		);

		// When
		renderWithRouter(
			createMemoryRouter(
				[
					{
						path: "/login",
						element: <LoginPage />,
					},
					{
						path: "/setup",
						element: <h1>Setup</h1>,
					},
				],
				{ initialEntries: ["/login"] },
			),
		);

		// Then
		await screen.findByText("Setup");
	});

	it("navigates to the home page after successful password login", async () => {
		// Given - user is NOT signed in
		let loggedIn = false;
		server.use(
			http.get("/api/v2/users/me", () => {
				if (!loggedIn) {
					return HttpResponse.json(
						{ message: "no user here" },
						{ status: 401 },
					);
				}
				return HttpResponse.json(MockUserOwner);
			}),
			http.post("/api/v2/users/login", () => {
				loggedIn = true;
				return HttpResponse.json({
					session_token: "test-session-token",
				});
			}),
		);

		// When
		renderWithRouter(
			createMemoryRouter(
				[
					{
						path: "/login",
						element: <LoginPage />,
					},
					{
						path: "/",
						element: <h1>Home</h1>,
					},
				],
				{ initialEntries: ["/login"] },
			),
		);

		await waitForLoaderToBeRemoved();

		await userEvent.type(
			screen.getByLabelText(/Username or email/i),
			"test@coder.com",
		);
		await userEvent.type(screen.getByLabelText(/Password/), "password");
		fireEvent.click(await screen.findByText("Sign In"));

		// Then - the component uses React Router navigation for standard
		// redirects so the new session cookie is picked up by the next route.
		await screen.findByText("Home");
	});

	it("does not follow a protocol-relative redirect after password login (CDM-02-001)", async () => {
		// Given - user is NOT signed in
		let loggedIn = false;
		server.use(
			http.get("/api/v2/users/me", () => {
				if (!loggedIn) {
					return HttpResponse.json(
						{ message: "no user here" },
						{ status: 401 },
					);
				}
				return HttpResponse.json(MockUserOwner);
			}),
			http.post("/api/v2/users/login", () => {
				loggedIn = true;
				return HttpResponse.json({
					session_token: "test-session-token",
				});
			}),
		);

		// When - the redirect param decodes to https://cure53.de//cure53.de,
		// whose pathname is the protocol-relative url //cure53.de.
		renderWithRouter(
			createMemoryRouter(
				[
					{
						path: "/login",
						element: <LoginPage />,
					},
					{
						path: "/",
						element: <h1>Home</h1>,
					},
				],
				{
					initialEntries: ["/login?redirect=https://cure53.de/%2fcure53.de"],
				},
			),
		);

		await waitForLoaderToBeRemoved();

		await userEvent.type(
			screen.getByLabelText(/Username or email/i),
			"test@coder.com",
		);
		await userEvent.type(screen.getByLabelText(/Password/), "password");
		fireEvent.click(await screen.findByText("Sign In"));

		// Then - the malicious redirect must be replaced with the fallback
		// path on both navigation paths (hard reload and SPA navigation).
		await waitFor(() => {
			expect(locationHrefSpy).toHaveBeenCalledWith("/");
		});
		expect(locationHrefSpy).not.toHaveBeenCalledWith(
			expect.stringContaining("//cure53.de"),
		);
		await screen.findByText("Home");
	});

	it("redirects to /oauth2/authorize via server-side redirect when signed in", async () => {
		// Given - user is signed in
		server.use(
			http.get("/api/v2/users/me", () => {
				return HttpResponse.json(MockUserOwner);
			}),
		);

		const redirectPath =
			"/oauth2/authorize?client_id=xxx&response_type=code&redirect_uri=https%3A%2F%2Fexample.com%2Fcallback";

		// When
		renderWithRouter(
			createMemoryRouter(
				[
					{
						path: "/login",
						element: <LoginPage />,
					},
				],
				{
					initialEntries: [
						`/login?redirect=${encodeURIComponent(redirectPath)}`,
					],
				},
			),
		);

		// Then - the full redirect path (including query params) must be
		// preserved for the OAuth2 authorization flow to complete.
		await waitFor(() => {
			expect(locationHrefSpy).toHaveBeenCalledWith(redirectPath);
		});
	});

	it("redirects to /oauth2/authorize after successful login when not already signed in", async () => {
		// Given - user is NOT signed in
		let loggedIn = false;
		server.use(
			http.get("/api/v2/users/me", () => {
				if (!loggedIn) {
					return HttpResponse.json(
						{ message: "no user here" },
						{ status: 401 },
					);
				}
				return HttpResponse.json(MockUserOwner);
			}),
			http.post("/api/v2/users/login", () => {
				loggedIn = true;
				return HttpResponse.json({
					session_token: "test-session-token",
				});
			}),
		);

		const redirectPath =
			"/oauth2/authorize?client_id=xxx&response_type=code&redirect_uri=https%3A%2F%2Fexample.com%2Fcallback";

		// When
		renderWithRouter(
			createMemoryRouter(
				[
					{
						path: "/login",
						element: <LoginPage />,
					},
				],
				{
					initialEntries: [
						`/login?redirect=${encodeURIComponent(redirectPath)}`,
					],
				},
			),
		);

		await waitForLoaderToBeRemoved();

		await userEvent.type(
			screen.getByLabelText(/Username or email/i),
			"test@coder.com",
		);
		await userEvent.type(screen.getByLabelText(/Password/), "password");
		fireEvent.click(await screen.findByText("Sign In"));

		// Then - the full redirect path (including query params) must be
		// preserved for the OAuth2 authorization flow to complete.
		await waitFor(() => {
			expect(locationHrefSpy).toHaveBeenCalledWith(redirectPath);
		});
	});
});

describe("sign-in method selector", () => {
	it("switches between lease and password authentication", async () => {
		const user = userEvent.setup();
		const submit = vi.fn();
		const login = vi
			.spyOn(ShortTermLeasesAPI, "login")
			.mockRejectedValue(new Error("Invalid token"));
		render(
			<SignInForm
				isSigningIn={false}
				redirectTo="/workspaces"
				onSubmit={submit}
			/>,
		);
		await user.click(
			screen.getByRole("button", { name: "Choose sign-in method" }),
		);
		await user.click(
			screen.getByRole("menuitemradio", { name: "Lease token" }),
		);
		await user.type(
			screen.getByLabelText("Lease token", { exact: true }),
			" test-lease ",
		);
		await user.click(screen.getByRole("button", { name: "Sign In" }));
		await waitFor(() => expect(login).toHaveBeenCalledWith("test-lease"));
		await user.click(
			await screen.findByRole("button", { name: "Choose sign-in method" }),
		);
		await user.click(
			screen.getByRole("menuitemradio", { name: "Username and password" }),
		);
		await user.type(screen.getByLabelText(/Username or email/i), "xxx");
		await user.type(screen.getByLabelText(/^Password/), "example-password");
		await user.click(screen.getByRole("button", { name: "Sign In" }));
		await waitFor(() =>
			expect(submit).toHaveBeenCalledWith(
				{ email: "xxx", password: "example-password" },
				expect.anything(),
			),
		);
		login.mockRestore();
	});
});

describe("lease token sign-in", () => {
	const assign = vi.fn();
	const leaseToken = "example-lease-token";

	beforeEach(() => {
		vi.stubGlobal("location", {
			origin: "http://localhost",
			href: "http://localhost/login",
			search: "",
			assign,
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		assign.mockReset();
	});

	const openLeaseForm = async (user: ReturnType<typeof userEvent.setup>) => {
		render(
			<SignInForm
				isSigningIn={false}
				redirectTo="/"
				authMethods={{
					password: { enabled: true },
					oidc: { enabled: false, signInText: "", iconUrl: "" },
				}}
				onSubmit={vi.fn()}
			/>,
		);
		await user.click(
			screen.getByRole("button", { name: "Choose sign-in method" }),
		);
		await user.click(
			screen.getByRole("menuitemradio", { name: "Lease token" }),
		);
		return screen.getByLabelText("Lease token", { exact: true });
	};

	it("shows a private token field when Lease token is chosen", async () => {
		const field = await openLeaseForm(userEvent.setup());
		expect(field).toHaveAttribute("type", "password");
		expect(field).toHaveAttribute("autocomplete", "off");
	});

	it("posts the token in the body and redirects on success", async () => {
		const user = userEvent.setup();
		let body: unknown;
		let requestUrl = "";
		server.use(
			http.post("/api/v2/short-term-lease/login", async ({ request }) => {
				body = await request.json();
				requestUrl = request.url;
				return HttpResponse.json({});
			}),
		);
		const field = await openLeaseForm(user);
		await user.type(field, leaseToken);
		await user.click(screen.getByRole("button", { name: "Sign In" }));

		await waitFor(() => expect(assign).toHaveBeenCalledWith("/"));
		expect(body).toEqual({ token: leaseToken });
		expect(requestUrl).not.toContain(leaseToken);
		expect(assign.mock.calls.flat().join()).not.toContain(leaseToken);
		expect(field).toHaveValue("");
	});

	it.each([401, 403])("shows the server error on a %i", async (status) => {
		const user = userEvent.setup();
		server.use(
			http.post("/api/v2/short-term-lease/login", () =>
				HttpResponse.json({ message: "Lease rejected." }, { status }),
			),
		);
		const field = await openLeaseForm(user);
		await user.type(field, leaseToken);
		await user.click(screen.getByRole("button", { name: "Sign In" }));

		expect(await screen.findByText("Lease rejected.")).toBeInTheDocument();
		expect(assign).not.toHaveBeenCalled();
	});

	it("shows a clear message when rate limited", async () => {
		const user = userEvent.setup();
		server.use(
			http.post("/api/v2/short-term-lease/login", () =>
				HttpResponse.json({ message: "raw" }, { status: 429 }),
			),
		);
		const field = await openLeaseForm(user);
		await user.type(field, leaseToken);
		await user.click(screen.getByRole("button", { name: "Sign In" }));

		expect(await screen.findByText(/too many attempts/i)).toBeInTheDocument();
	});
});
