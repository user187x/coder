import type { Meta, StoryObj } from "@storybook/react-vite";
import { spyOn, userEvent, within } from "storybook/test";
import { ClientCertificatesAPI } from "#/api/clientCertificates";
import {
	MockCertificateDownload,
	MockClientCertificate,
} from "#/testHelpers/clientCertificates";
import { MockUserOwner, mockApiError } from "#/testHelpers/entities";
import * as download from "./ClientCertificateDownload";
import { ClientCertificatesDialog } from "./ClientCertificatesDialog";

const meta = {
	title: "modules/platform/ClientCertificatesDialog",
	component: ClientCertificatesDialog,
	args: { user: { ...MockUserOwner, login_type: "oidc" }, onClose: () => {} },
	beforeEach: () => {
		spyOn(ClientCertificatesAPI, "capabilities").mockResolvedValue({
			enabled: true,
		});
		spyOn(ClientCertificatesAPI, "list").mockResolvedValue({
			certificates: [MockClientCertificate],
		});
	},
} satisfies Meta<typeof ClientCertificatesDialog>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ExistingDevice: Story = {};
export const Loading: Story = {
	beforeEach: () => {
		spyOn(ClientCertificatesAPI, "list").mockReturnValue(new Promise(() => {}));
	},
};
export const Empty: Story = {
	beforeEach: () => {
		spyOn(ClientCertificatesAPI, "list").mockResolvedValue({
			certificates: [],
		});
	},
};
export const LoadError: Story = {
	beforeEach: () => {
		spyOn(ClientCertificatesAPI, "list").mockRejectedValue(
			mockApiError({
				message: "Certificate inventory is temporarily unavailable.",
			}),
		);
	},
};
export const Disabled: Story = {
	beforeEach: () => {
		spyOn(ClientCertificatesAPI, "capabilities").mockResolvedValue({
			enabled: false,
		});
	},
};
export const DownloadReady: Story = {
	beforeEach: () => {
		spyOn(ClientCertificatesAPI, "issue").mockResolvedValue(
			MockCertificateDownload,
		);
		spyOn(download, "saveClientCertificate").mockImplementation(() => {});
	},
	play: async () => {
		const page = within(document.body);
		await userEvent.type(
			await page.findByLabelText("Device name"),
			"Android phone",
		);
		await userEvent.type(
			page.getByLabelText("Download password"),
			"test-device-password",
		);
		await userEvent.click(
			page.getByRole("button", { name: "Issue and download" }),
		);
	},
};
