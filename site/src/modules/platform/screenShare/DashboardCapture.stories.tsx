import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useRef, useState } from "react";
import { userEvent, within } from "storybook/test";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogTitle,
	DialogTrigger,
} from "#/components/Dialog/Dialog";
import { captureDashboard } from "./dashboardCapture";
import { ShareVideo } from "./ShareVideo";

const CapturePreview = () => {
	const [stream, setStream] = useState<MediaStream | null>(null);
	const [starting, setStarting] = useState(false);
	const [error, setError] = useState("");
	const stopRef = useRef<(() => void) | null>(null);
	useEffect(() => () => stopRef.current?.(), []);
	return (
		<div className="p-6 text-content-primary">
			<h1>Dashboard capture preview</h1>
			<p>
				Local synthetic content only. This preview does not connect to another
				account.
			</p>
			<label className="flex flex-col gap-2 my-6">
				Workspace filter
				<input className="w-64 border border-solid border-border rounded p-2" />
			</label>
			<label className="flex flex-col gap-2 my-6">
				Excluded password field
				<input
					type="password"
					defaultValue="synthetic-test-value"
					className="w-64 border border-solid border-border rounded p-2"
				/>
			</label>
			<Dialog>
				<DialogTrigger asChild>
					<Button>Open test dialog</Button>
				</DialogTrigger>
				<DialogContent>
					<DialogTitle>Live dialog update</DialogTitle>
					<DialogDescription>
						The same dialog should appear in the live preview.
					</DialogDescription>
					<DialogClose asChild>
						<Button>Close test dialog</Button>
					</DialogClose>
				</DialogContent>
			</Dialog>
			<aside
				data-dashboard-support-ignore
				className="fixed right-4 bottom-4 z-[100] w-[min(480px,45vw)] rounded-lg border border-solid border-border bg-surface-primary p-3"
			>
				{stream ? (
					<Button
						onClick={() => {
							stopRef.current?.();
							setStream(null);
						}}
					>
						Stop preview
					</Button>
				) : (
					<Button
						disabled={starting}
						onClick={async () => {
							setStarting(true);
							setError("");
							try {
								const capture = await captureDashboard(setError);
								stopRef.current = capture.stop;
								setStream(capture.stream);
							} catch (error) {
								setError(String(error));
							} finally {
								setStarting(false);
							}
						}}
					>
						Start local preview
					</Button>
				)}
				{error && <p role="alert">{error}</p>}
				<ShareVideo stream={stream} />
			</aside>
		</div>
	);
};

const meta = {
	title: "modules/platform/DashboardCapture",
	component: CapturePreview,
} satisfies Meta<typeof CapturePreview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};

export const LiveDialog: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", { name: "Start local preview" }),
		);
		await canvas.findByRole(
			"button",
			{ name: "Stop preview" },
			{ timeout: 10000 },
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "Open test dialog" }),
		);
	},
};
