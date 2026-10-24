import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "react-query";
import { MockBanner } from "#/testHelpers/platform";
import { BannerEditor } from "./BannerEditor";

it.each([true, false])(
	"changes continuous text looping from %s independently of effects",
	async (loopText) => {
		const onChange = vi.fn();
		render(
			<QueryClientProvider client={new QueryClient()}>
				<BannerEditor
					form={{ ...MockBanner, loopText, effect: "none", repeat: false }}
					dirty={false}
					isPublishing={false}
					problem={null}
					onChange={onChange}
					onProblem={vi.fn()}
					onPublish={vi.fn()}
					onDiscard={vi.fn()}
					onTryOpen={vi.fn()}
					onTryClose={vi.fn()}
				/>
			</QueryClientProvider>,
		);
		await userEvent.setup().click(
			screen.getByRole("button", {
				name: "Loop text continuously",
			}),
		);
		expect(onChange).toHaveBeenCalledWith({ loopText: !loopText });
	},
);
