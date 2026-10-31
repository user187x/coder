import type { Meta, StoryObj } from "@storybook/react-vite";
import { within } from "storybook/test";
import {
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
} from "#/components/Breadcrumb/Breadcrumb";
import { AdminBreadcrumb } from "./AdminBreadcrumb";

const meta: Meta<typeof AdminBreadcrumb> = {
	title: "modules/management/AdminBreadcrumb",
	component: AdminBreadcrumb,
	render: () => (
		<div>
			<div className="sticky top-0 z-40 flex h-[72px] items-center bg-surface-primary px-6">
				Coder navigation
			</div>
			<div>
				<AdminBreadcrumb variant="connected">
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink to="/hud">Admin</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbItem>
							<BreadcrumbPage>Health</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</AdminBreadcrumb>
				<div className="flex gap-8 px-6 py-5">
					<aside className="sticky top-[calc(88px+var(--admin-breadcrumb-height,0px))] h-fit w-52 shrink-0">
						Categories
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
	parameters: { layout: "fullscreen" },
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
