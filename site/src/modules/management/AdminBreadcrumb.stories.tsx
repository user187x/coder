import type { Meta, StoryObj } from "@storybook/react-vite";
import { BoxIcon, ImagesIcon } from "lucide-react";
import { userEvent, within } from "storybook/test";
import {
	BreadcrumbItem,
	BreadcrumbList,
	BreadcrumbPage,
} from "#/components/Breadcrumb/Breadcrumb";
import { NavbarAction } from "#/modules/dashboard/Navbar/NavbarAction";
import { MockPermissions, MockUserOwner } from "#/testHelpers/entities";
import {
	withAuthProvider,
	withDashboardProvider,
} from "#/testHelpers/storybook";
import { AdminBreadcrumb } from "./AdminBreadcrumb";
import { AdminCategoryMenu } from "./AdminCategoryMenu";
import { CategoryActionsMenu } from "./CategoryActionsMenu";
import { CategoryBreadcrumbButton } from "./CategoryBreadcrumbButton";

const meta: Meta<typeof AdminBreadcrumb> = {
	title: "modules/management/AdminBreadcrumb",
	component: AdminBreadcrumb,
	decorators: [withDashboardProvider, withAuthProvider],
	render: () => (
		<div>
			<div className="sticky top-0 z-40 flex h-[72px] items-center bg-surface-primary px-6">
				Coder navigation
			</div>
			<div>
				<AdminBreadcrumb variant="connected" className="deployment-breadcrumb">
					<BreadcrumbList>
						<BreadcrumbItem>
							<AdminCategoryMenu />
						</BreadcrumbItem>
						<BreadcrumbItem>
							<BreadcrumbPage>Health</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</AdminBreadcrumb>
				<div className="flex gap-8 px-6 py-5">
					<aside className="sticky top-[calc(88px+var(--admin-breadcrumb-height,0px))] h-fit w-52 shrink-0">
						Settings
					</aside>
					<div className="min-w-0 flex-1">
						<h1>Workspace Health</h1>
						<div className="h-[700px]" />
						<h2>Provisioner details</h2>
						<div className="h-[900px]" />
					</div>
				</div>
			</div>
		</div>
	),
	parameters: {
		layout: "fullscreen",
		user: MockUserOwner,
		permissions: MockPermissions,
	},
};
export default meta;
type Story = StoryObj<typeof AdminBreadcrumb>;
export const Default: Story = {};
export const Scrolled: Story = {
	play: async ({ canvasElement }) => {
		within(canvasElement)
			.getByRole("heading", { name: "Provisioner details" })
			.scrollIntoView();
	},
};

export const Categories: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.pointer({
			target: within(canvasElement).getByRole("link", {
				name: "Settings",
			}),
			keys: "[MouseRight]",
		});
	},
};

/** In the navbar: the chevrons in their recessed well, and the category's caret open on the page's action items. */
export const NavbarCategoryActions: Story = {
	render: () => (
		<div className="navbar-start flex h-[72px] items-center bg-surface-primary px-6">
			<AdminBreadcrumb
				variant="connected"
				inline
				className="deployment-breadcrumb admin-navbar-breadcrumb"
			>
				<BreadcrumbList>
					<BreadcrumbItem>
						<AdminCategoryMenu />
					</BreadcrumbItem>
					<BreadcrumbItem>
						<span className="inline-flex">
							<CategoryBreadcrumbButton
								label="Images"
								icon={ImagesIcon}
								controls="categories"
								sidebarOpen={false}
								onToggle={() => {}}
							/>
							<CategoryActionsMenu label="Images" />
						</span>
					</BreadcrumbItem>
				</BreadcrumbList>
			</AdminBreadcrumb>
			<NavbarAction
				menu={[{ label: "New Image", icon: BoxIcon, onSelect: () => {} }]}
			>
				{null}
			</NavbarAction>
		</div>
	),
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", { name: "Images actions" }),
		);
	},
};
