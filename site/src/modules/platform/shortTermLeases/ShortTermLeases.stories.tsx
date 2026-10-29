import type { Meta, StoryObj } from "@storybook/react-vite";
import { spyOn } from "storybook/test";
import { organizations } from "#/api/queries/organizations";
import { shortTermLeases } from "#/api/queries/shortTermLeases";
import { templates } from "#/api/queries/templates";
import { ShortTermLeasesAPI } from "#/api/shortTermLeases";
import { MockOrganization } from "#/testHelpers/entities";
import {
	MockBrowserTemplate,
	MockShortTermLease,
} from "#/testHelpers/shortTermLeases";
import { ShortTermLeases } from "./ShortTermLeases";

const meta: Meta<typeof ShortTermLeases> = {
	title: "modules/platform/ShortTermLeases",
	component: ShortTermLeases,
	args: { clock: () => Date.parse(MockShortTermLease.issued_at) },
	beforeEach: ({ parameters }) => {
		const mock = spyOn(ShortTermLeasesAPI, "list");
		if (parameters.leaseError)
			mock.mockRejectedValue(new Error("Lease service unavailable"));
		else if (parameters.leaseLoading)
			mock.mockImplementation(() => new Promise(() => {}));
		else
			mock.mockResolvedValue(
				parameters.leaseEmpty
					? []
					: [
							{
								...MockShortTermLease,
								extension_requested_at: parameters.leaseRequested
									? MockShortTermLease.issued_at
									: null,
							},
						],
			);
		return () => mock.mockRestore();
	},
	parameters: {
		queries: [
			{ key: organizations().queryKey, data: [MockOrganization] },
			{ key: templates().queryKey, data: [MockBrowserTemplate] },
		],
	},
};
export default meta;
type Story = StoryObj<typeof ShortTermLeases>;
export const Active: Story = {
	parameters: {
		queries: [
			{ key: organizations().queryKey, data: [MockOrganization] },
			{ key: templates().queryKey, data: [MockBrowserTemplate] },
			{
				key: shortTermLeases(MockOrganization.id).queryKey,
				data: [MockShortTermLease],
			},
		],
	},
};
export const Empty: Story = {
	parameters: {
		leaseEmpty: true,
		queries: [
			{ key: organizations().queryKey, data: [MockOrganization] },
			{ key: templates().queryKey, data: [MockBrowserTemplate] },
			{ key: shortTermLeases(MockOrganization.id).queryKey, data: [] },
		],
	},
};
export const ExtensionRequested: Story = {
	parameters: {
		leaseRequested: true,
		queries: [
			{ key: organizations().queryKey, data: [MockOrganization] },
			{ key: templates().queryKey, data: [MockBrowserTemplate] },
			{
				key: shortTermLeases(MockOrganization.id).queryKey,
				data: [
					{
						...MockShortTermLease,
						extension_requested_at: MockShortTermLease.issued_at,
					},
				],
			},
		],
	},
};
export const Unavailable: Story = {
	parameters: {
		leaseError: true,
		queries: [
			{ key: organizations().queryKey, data: [MockOrganization] },
			{ key: templates().queryKey, data: [MockBrowserTemplate] },
			{
				key: shortTermLeases(MockOrganization.id).queryKey,
				data: undefined,
				isError: true,
			},
		],
	},
};

export const Loading: Story = { parameters: { leaseLoading: true } };
