import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import type { BackgroundImage } from "#/api/platform";
import { getPlatformSnapshot, setBackground } from "#/contexts/platformBoot";
import { MockBackgrounds } from "#/testHelpers/appearance";
import { PlatformBackground } from "./PlatformBackground";

const meta: Meta<{ layer: BackgroundImage["layer"] }> = {
	title: "modules/platform/PlatformBackground",
	parameters: { layout: "fullscreen" },
	args: { layer: "under" },
	render: function Wallpaper({ layer }) {
		useEffect(() => {
			const saved = getPlatformSnapshot().backgrounds.dashboard ?? null;
			const base = MockBackgrounds.dashboard;
			if (!base) return;
			setBackground("dashboard", {
				...base,
				url: "/pictures/destructed-cube.png",
				fit: "span",
				layer,
				opacity: 0.3,
			});
			return () => setBackground("dashboard", saved);
		}, [layer]);
		return (
			<>
				<PlatformBackground slot="dashboard" />
				<main className="flex min-h-[180vh] flex-col justify-between gap-8 p-8">
					<section className="rounded-lg border border-border bg-surface-primary p-8">
						<h1 className="m-0 text-xl">Span wallpaper</h1>
						<p>Layer: {layer === "under" ? "Behind the page" : "Watermark"}</p>
						<p>The wallpaper stays fixed as the page scrolls.</p>
					</section>
					<section className="rounded-lg border border-border bg-surface-primary p-8">
						<h2 className="m-0 text-xl">Bottom of the page</h2>
						<p>The same wallpaper fills the entire viewport here.</p>
					</section>
				</main>
			</>
		);
	},
};
export default meta;
type Story = StoryObj<typeof meta>;
export const SpanBehindPage: Story = {};
export const SpanWatermark: Story = { args: { layer: "over" } };
