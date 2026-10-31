import type { Meta, StoryObj } from "@storybook/react-vite";
import { spyOn, userEvent, within } from "storybook/test";
import { API } from "#/api/api";
import { auditCollectors } from "#/api/queries/auditCollectors";
import { organizations } from "#/api/queries/organizations";
import {
	MockAuditCollectorConfiguration,
	MockOrganization,
} from "#/testHelpers/entities";
import { AuditEndpointCard } from "./AuditEndpointCard";

const meta: Meta<typeof AuditEndpointCard> = {
	title: "modules/platform/AuditEndpointCard",
	component: AuditEndpointCard,
	beforeEach: () => {
		spyOn(API, "getAuditCollectors").mockResolvedValue(
			MockAuditCollectorConfiguration,
		);
	},
	parameters: {
		queries: [
			{ key: organizations().queryKey, data: [MockOrganization] },
			{
				key: auditCollectors(MockOrganization.id).queryKey,
				data: MockAuditCollectorConfiguration,
			},
		],
	},
};
export default meta;
type Story = StoryObj<typeof AuditEndpointCard>;
export const Configured: Story = {};
export const Documentation: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByText("Authentication and request examples"),
		);
	},
};
export const Empty: Story = {
	beforeEach: () => {
		spyOn(API, "getAuditCollectors").mockResolvedValue({
			...MockAuditCollectorConfiguration,
			collectors: [],
		});
	},
	parameters: {
		queries: [
			{ key: organizations().queryKey, data: [MockOrganization] },
			{
				key: auditCollectors(MockOrganization.id).queryKey,
				data: { ...MockAuditCollectorConfiguration, collectors: [] },
			},
		],
	},
};
export const NotConfigured: Story = {
	beforeEach: () => {
		spyOn(API, "getAuditCollectors").mockResolvedValue({
			...MockAuditCollectorConfiguration,
			available: false,
			issuer: "",
			token_endpoint: "",
			collectors: [],
		});
	},
	parameters: {
		queries: [
			{ key: organizations().queryKey, data: [MockOrganization] },
			{
				key: auditCollectors(MockOrganization.id).queryKey,
				data: {
					...MockAuditCollectorConfiguration,
					available: false,
					issuer: "",
					token_endpoint: "",
					collectors: [],
				},
			},
		],
	},
};
export const Loading: Story = {
	parameters: {
		queries: [{ key: organizations().queryKey, data: [MockOrganization] }],
	},
	beforeEach: () => {
		spyOn(API, "getAuditCollectors").mockReturnValue(new Promise(() => {}));
	},
};
export const Unavailable: Story = {
	parameters: {
		queries: [{ key: organizations().queryKey, data: [MockOrganization] }],
	},
	beforeEach: () => {
		spyOn(API, "getAuditCollectors").mockRejectedValue(
			new window.Error("Collector access could not be loaded"),
		);
	},
};
export const Narrow: Story = {
	parameters: { viewport: { defaultViewport: "mobile1" } },
	decorators: [
		(Story) => (
			<div style={{ width: 390, maxWidth: "100%" }}>
				<Story />
			</div>
		),
	],
};
