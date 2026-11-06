import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntroductionCard } from "./IntroductionCard";

describe("IntroductionCard", () => {
	it("reports the new state when the switch is flipped", async () => {
		const onCheckedChange = vi.fn();
		render(
			<IntroductionCard checked={false} onCheckedChange={onCheckedChange} />,
		);
		await userEvent.click(
			screen.getByRole("switch", { name: "Show section introductions" }),
		);
		expect(onCheckedChange).toHaveBeenCalledWith(true);
	});
});
