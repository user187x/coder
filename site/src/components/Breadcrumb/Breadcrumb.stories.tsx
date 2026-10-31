import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsIcon, TagIcon } from "lucide-react";
import {
	Breadcrumb,
	BreadcrumbEllipsis,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "#/components/Breadcrumb/Breadcrumb";
import { MockOrganization } from "#/testHelpers/entities";

const meta: Meta<typeof Breadcrumb> = {
	title: "components/Breadcrumb",
	component: Breadcrumb,
};

export default meta;
type Story = StoryObj<typeof Breadcrumb>;

export const Default: Story = {
	args: {
		children: (
			<Breadcrumb>
				<BreadcrumbList>
					<BreadcrumbItem>
						<BreadcrumbPage>Admin Settings</BreadcrumbPage>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem>
						<BreadcrumbEllipsis />
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem>
						<BreadcrumbLink to="/organizations">Organizations</BreadcrumbLink>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem>
						<BreadcrumbPage className="text-content-primary">
							{MockOrganization.name}
						</BreadcrumbPage>
					</BreadcrumbItem>
				</BreadcrumbList>
			</Breadcrumb>
		),
	},
};

export const Connected: Story = {
	args: {
		variant: "connected",
		children: (
			<BreadcrumbList>
				<BreadcrumbItem>
					<BreadcrumbLink to="/hud" end>
						<SettingsIcon aria-hidden className="size-4 shrink-0" />
						Admin
					</BreadcrumbLink>
				</BreadcrumbItem>
				<BreadcrumbItem>
					<BreadcrumbPage>
						<TagIcon aria-hidden className="size-4 shrink-0" />
						Classification
					</BreadcrumbPage>
				</BreadcrumbItem>
			</BreadcrumbList>
		),
	},
};

export const ConnectedNarrow: Story = {
	...Connected,
	decorators: [
		(Story) => (
			<div className="w-80 max-w-full">
				<Story />
			</div>
		),
	],
};
