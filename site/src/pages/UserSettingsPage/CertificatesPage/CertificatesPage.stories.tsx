import type { Meta, StoryObj } from "@storybook/react-vite";
import { userSecretsKey } from "#/api/queries/userSecrets";
import type { UserSecret } from "#/api/typesGenerated";
import { MockUserOwner } from "#/testHelpers/entities";
import {
	withAuthProvider,
	withDashboardProvider,
	withToaster,
} from "#/testHelpers/storybook";
import CertificatesPage from "./CertificatesPage";
import {
	certificatePath,
	certificateSecretName,
	describeCertificate,
} from "./certificateSecrets";

const MockCertificateSecret: UserSecret = {
	id: "certificate-secret",
	name: certificateSecretName(MockUserOwner.username),
	description: describeCertificate(MockUserOwner.username, {
		sha: "0123456789abcdef0123",
		subject: "Test User",
		notAfter: new Date("2030-01-01T00:00:00Z"),
	}),
	env_name: "",
	file_path: certificatePath(MockUserOwner.username),
	enabled: true,
	created_at: "2026-09-01T00:00:00Z",
	updated_at: "2026-09-01T00:00:00Z",
};

const meta: Meta<typeof CertificatesPage> = {
	title: "pages/UserSettingsPage/CertificatesPage",
	component: CertificatesPage,
	parameters: { user: MockUserOwner },
	decorators: [withToaster, withAuthProvider, withDashboardProvider],
};

export default meta;
type Story = StoryObj<typeof CertificatesPage>;

export const NoCertificate: Story = {
	parameters: {
		queries: [{ key: userSecretsKey(MockUserOwner.id), data: [] }],
	},
};

export const Installed: Story = {
	parameters: {
		queries: [
			{
				key: userSecretsKey(MockUserOwner.id),
				data: [MockCertificateSecret],
			},
		],
	},
};

export const ExpiringSoonWithLeftover: Story = {
	parameters: {
		queries: [
			{
				key: userSecretsKey(MockUserOwner.id),
				data: [
					{
						...MockCertificateSecret,
						description: describeCertificate(MockUserOwner.username, {
							sha: "0123456789abcdef0123",
							subject: "Test User",
							notAfter: new Date(Date.now() + 10 * 86_400_000),
						}),
					},
					{
						...MockCertificateSecret,
						id: "leftover",
						name: "certificate-old-name",
						file_path: certificatePath("old-name"),
					},
				],
			},
		],
	},
};
