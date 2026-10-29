import type { Meta, StoryObj } from "@storybook/react-vite";
import { BANNER_EFFECTS, PICTURE_EFFECTS } from "#/api/platform";
import { MockBanner } from "#/testHelpers/platform";
import { BannerPreview } from "./BannerPreview";

const meta: Meta<typeof BannerPreview> = {
	title: "modules/platform/BannerEffects",
	component: BannerPreview,
	args: { banner: MockBanner, animate: true },
};
export default meta;
type Story = StoryObj<typeof BannerPreview>;
export const TextEffects: Story = {
	render: () => (
		<div className="grid gap-6 p-6">
			{BANNER_EFFECTS.slice(-10).map((effect) => (
				<div key={effect}>
					<p>{effect}</p>
					<BannerPreview
						animate
						banner={{
							...MockBanner,
							message: "System status: all services operational",
							markdown: false,
							effect,
							repeat: true,
						}}
					/>
				</div>
			))}
		</div>
	),
};
export const ImageEffects: Story = {
	render: () => (
		<div className="grid gap-6 p-6">
			{PICTURE_EFFECTS.map((pictureEffect) => (
				<div key={pictureEffect}>
					<p>{pictureEffect}</p>
					<BannerPreview
						animate
						banner={{
							...MockBanner,
							message: "Background image preview",
							markdown: false,
							picture: "/icon/coder.svg",
							pictureFit: "fill",
							pictureEffect,
						}}
					/>
				</div>
			))}
		</div>
	),
};
