import { fireEvent, render, screen } from "@testing-library/react";
import type { SerpentOption } from "#/api/typesGenerated";
import { UserAuthSettingsPageView } from "./UserAuthSettingsPageView";

const options: SerpentOption[] = [
	{
		name: "OIDC Client ID",
		description: "Client ID to use for Login with OIDC.",
		flag: "oidc-client-id",
		value: "coder",
		group: { name: "OIDC" },
		hidden: false,
	},
];

it("folds OpenID Configurations by default, its state in view", () => {
	render(<UserAuthSettingsPageView options={options} />);
	const section = screen.getByRole("group");
	expect(section).toHaveProperty("open", false);
	expect(section).toHaveTextContent("OpenID Configurations");
	expect(section).toHaveTextContent("Enabled");
	fireEvent.click(screen.getByText("OpenID Configurations"));
	expect(section).toHaveProperty("open", true);
});
