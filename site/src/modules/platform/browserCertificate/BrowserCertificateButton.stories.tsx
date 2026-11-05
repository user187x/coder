import type { Meta, StoryObj } from "@storybook/react-vite";
import { useQueryClient } from "react-query";
import { userEvent, within } from "storybook/test";
import { browserCertificateStatus } from "#/api/queries/browserCertificate";
import { MockBrowserCertificate } from "#/testHelpers/browserCertificate";
import { AddPanelTab } from "../agentPanels/AddPanelTab";
import { BrowserCertificateButton } from "./BrowserCertificateButton";

const meta = {
	title: "modules/platform/BrowserCertificateButton",
	component: BrowserCertificateButton,
	args: {
		baseUrl: "/certificate/",
		children: "Browser Certificate",
		now: Date.parse("2026-10-30T12:00:00Z"),
	},
	decorators: [
		(Story) => (
			<div className="min-h-screen p-12">
				<h1>Workspace browser</h1>
				<p>
					Apps, metrics and workspace panels remain behind the certificate
					panel.
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
				data: MockBrowserCertificate,
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

export const GroupedReady: Story = {
	...Ready,
	args: { grouped: true },
	decorators: [
		(Story) => (
			<div className="relative mt-8">
				<AddPanelTab
					apps={[]}
					disabled={false}
					onAdd={() => {}}
					actions={<Story />}
				/>
			</div>
		),
	],
	play: async () => {
		await userEvent.click(
			await within(document.body).findByRole("button", { name: "Add a panel" }),
		);
		await userEvent.click(
			await within(document.body).findByRole("menuitem", {
				name: "Browser Certificate",
			}),
		);
	},
};

export const GroupedLocked: Story = {
	...GroupedReady,
	parameters: Locked.parameters,
	play: async (context) => {
		await GroupedReady.play?.(context);
		await userEvent.click(
			await within(document.body).findByLabelText("Certificate password"),
		);
	},
};
