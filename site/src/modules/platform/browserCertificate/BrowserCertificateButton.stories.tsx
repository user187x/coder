import type { Meta, StoryObj } from "@storybook/react-vite";
import { useQueryClient } from "react-query";
import { userEvent, within } from "storybook/test";
import { browserCertificateStatus } from "#/api/queries/browserCertificate";
import { BrowserCertificateButton } from "./BrowserCertificateButton";

const meta = {
	title: "modules/platform/BrowserCertificateButton",
	component: BrowserCertificateButton,
	args: { baseUrl: "/certificate/", children: "Browser Certificate" },
	decorators: [
		(Story) => (
			<div className="min-h-screen p-12">
				<h1>Workspace browser</h1>
				<p>
					Apps, metrics and workspace panels remain behind the certificate
					dialog.
				</p>
				<Story />
			</div>
		),
	],
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", {
				name: "Browser Certificate",
			}),
		);
	},
} satisfies Meta<typeof BrowserCertificateButton>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Missing: Story = {
	parameters: {
		queries: [
			{
				key: browserCertificateStatus("/certificate/").queryKey,
				data: {
					state: "missing",
					message: "Supply a certificate for this browser.",
					csrf: "story-csrf",
				},
			},
		],
	},
};
export const Locked: Story = {
	parameters: {
		queries: [
			{
				key: browserCertificateStatus("/certificate/").queryKey,
				data: {
					state: "locked",
					message: "Unlock your saved certificate.",
					csrf: "story-csrf",
				},
			},
		],
	},
};
export const Ready: Story = {
	parameters: {
		queries: [
			{
				key: browserCertificateStatus("/certificate/").queryKey,
				data: {
					state: "ready",
					message: "Your certificate is installed.",
					csrf: "story-csrf",
				},
			},
		],
	},
};

export const Loading: Story = {
	args: { baseUrl: "/certificate-loading/" },
	decorators: [
		(Story) => {
			const client = useQueryClient();
			client.setQueryDefaults(
				browserCertificateStatus("/certificate-loading/").queryKey,
				{ enabled: false },
			);
			return <Story />;
		},
	],
};
export const Unavailable: Story = {
	args: { baseUrl: "/certificate-unavailable/" },
	decorators: [
		(Story) => {
			const client = useQueryClient();
			const query = browserCertificateStatus("/certificate-unavailable/");
			client.setQueryDefaults(query.queryKey, { enabled: false });
			client
				.getQueryCache()
				.build(client, { ...query, gcTime: Number.POSITIVE_INFINITY })
				.setState({
					status: "error",
					error: new Error("Start the workspace browser and retry."),
					fetchStatus: "idle",
				});
			return <Story />;
		},
	],
};
