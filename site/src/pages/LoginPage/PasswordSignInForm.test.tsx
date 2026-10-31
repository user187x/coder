import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "#/testHelpers/renderHelpers";
import { PasswordSignInForm } from "./PasswordSignInForm";

it.each(["developer", "developer@example.test"])(
	"submits %s as the login identifier",
	async (identifier) => {
		const onSubmit = vi.fn();
		const user = userEvent.setup();
		render(
			<PasswordSignInForm onSubmit={onSubmit} isSigningIn={false} autoFocus />,
		);
		await user.type(screen.getByLabelText(/Username or email/), identifier);
		await user.type(screen.getByLabelText(/Password/), "test-password");
		await user.click(screen.getByRole("button", { name: "Sign In" }));
		await waitFor(() =>
			expect(onSubmit).toHaveBeenCalledWith(
				{ email: identifier, password: "test-password" },
				expect.anything(),
			),
		);
	},
);
