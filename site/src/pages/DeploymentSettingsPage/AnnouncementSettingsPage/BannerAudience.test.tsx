import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { API } from "#/api/api";
import { MockUserMember } from "#/testHelpers/entities";
import { MockBanner } from "#/testHelpers/platform";
import { render } from "#/testHelpers/renderHelpers";
import { BannerAudience } from "./BannerAudience";

it("selects and removes recipients without changing the message", async () => {
	vi.spyOn(API, "getUsers").mockResolvedValue({
		users: [MockUserMember],
		count: 1,
	});
	const onChange = vi.fn();
	const Editor = () => {
		const [ids, setIds] = useState<string[]>([]);
		return (
			<BannerAudience
				form={{ ...MockBanner, audience: "selected", audienceUserIds: ids }}
				onChange={(patch) => {
					onChange(patch);
					if (patch.audienceUserIds) setIds(patch.audienceUserIds);
				}}
			/>
		);
	};
	render(<Editor />);
	await userEvent.click(
		await screen.findByRole("checkbox", {
			name: `${MockUserMember.username} (${MockUserMember.email})`,
		}),
	);
	expect(onChange).toHaveBeenLastCalledWith({
		audienceUserIds: [MockUserMember.id],
	});

	await userEvent.click(
		screen.getByRole("checkbox", {
			name: `${MockUserMember.username} (${MockUserMember.email})`,
		}),
	);
	expect(onChange).toHaveBeenLastCalledWith({ audienceUserIds: [] });
	vi.restoreAllMocks();
});
