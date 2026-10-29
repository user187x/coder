import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "react-query";
import * as Preview from "#/modules/platform/announcement/BannerPreview";
import { bannerAlpha } from "#/modules/platform/announcement/bannerAlpha";
import { MockBanner } from "#/testHelpers/platform";
import { editableFields, sameFields } from "./AnnouncementSettingsPage";
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

afterEach(() => vi.restoreAllMocks());

it.each(["keyboard", "pointer"])(
	"publishes a transparency-only change via %s",
	async (interaction) => {
		const published = editableFields({
			...MockBanner,
			opacity: 100,
			picture: "/pictures/creeper.gif",
			pictureFit: "span",
		});
		const preview = vi.spyOn(Preview, "BannerPreview").mockReturnValue(null);
		const onPublish = vi.fn();
		const Editor = () => {
			const [form, setForm] = useState(published);
			return (
				<>
					<Preview.BannerPreview banner={form} />
					<BannerEditor
						form={form}
						dirty={!sameFields(form, published)}
						isPublishing={false}
						problem={null}
						onChange={(patch) =>
							setForm((current) => ({ ...current, ...patch }))
						}
						onProblem={vi.fn()}
						onPublish={() => onPublish(form)}
						onDiscard={vi.fn()}
						onTryOpen={vi.fn()}
						onTryClose={vi.fn()}
					/>
				</>
			);
		};
		render(
			<QueryClientProvider client={new QueryClient()}>
				<Editor />
			</QueryClientProvider>,
		);
		const user = userEvent.setup();
		if (interaction === "keyboard") {
			screen.getByRole("slider", { name: "Transparency" }).focus();
			await user.keyboard("{ArrowRight}");
		} else {
			const track = screen.getByRole("group", { name: "Transparency" });
			vi.spyOn(track, "getBoundingClientRect").mockReturnValue(
				new DOMRect(0, 0, 100, 8),
			);
			vi.spyOn(HTMLElement.prototype, "hasPointerCapture").mockReturnValue(
				true,
			);
			await user.pointer([
				{
					keys: "[MouseLeft>]",
					target: track,
					coords: { clientX: 25, clientY: 4 },
				},
				{ target: track, coords: { clientX: 75, clientY: 4 } },
				{
					keys: "[/MouseLeft]",
					target: track,
					coords: { clientX: 75, clientY: 4 },
				},
			]);
		}
		await user.click(screen.getByRole("button", { name: "Publish changes" }));
		const opacity = interaction === "keyboard" ? 99 : 40;
		expect(onPublish).toHaveBeenCalledWith({ ...published, opacity });
		expect(preview.mock.lastCall?.[0].banner).toEqual({
			...published,
			opacity,
		});
		expect(bannerAlpha(opacity)).toBe(interaction === "keyboard" ? 0.99 : 0.4);
	},
);

it.each([
	["Background image effect", "Pan up", { pictureEffect: "pan-up" }],
	["Background image effect", "Pan down", { pictureEffect: "pan-down" }],
	["Background image effect", "Roller pin", { pictureEffect: "roller" }],
	["Background image effect", "Glitch", { pictureEffect: "glitch" }],
	["Background image effect", "Fade in/out", { pictureEffect: "fade" }],
	["Background image effect", "Gaussian blur", { pictureEffect: "gaussian" }],
	[
		"Background image effect",
		"Ripple (flag wave)",
		{ pictureEffect: "ripple" },
	],
	["Text effect", "Borealis", { effect: "aurora" }],
	["Text effect", "Neon-Haus", { effect: "neon" }],
	["Text effect", "Chrome", { effect: "chrome" }],
	["Text effect", "Lens-Drift", { effect: "focus" }],
	["Text effect", "Emberglow", { effect: "ember" }],
	["Text effect", "Prisma", { effect: "spectrum" }],
	["Text effect", "Anaglyph-3D", { effect: "anaglyph" }],
	["Text effect", "Cardio", { effect: "heartbeat" }],
	["Text effect", "Soft-Blur", { effect: "softblur" }],
	["Text effect", "Kilovolt", { effect: "voltage" }],
])("changes %s to %s independently", async (control, option, expected) => {
	const onChange = vi.fn();
	render(
		<QueryClientProvider client={new QueryClient()}>
			<BannerEditor
				form={{ ...MockBanner, picture: "/pictures/creeper.gif" }}
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
	await userEvent.click(screen.getByRole("combobox", { name: control }));
	await userEvent.click(screen.getByRole("option", { name: option }));
	expect(onChange).toHaveBeenCalledWith(expected);
});
