import { ChevronDownIcon } from "#/components/AnimatedIcons/ChevronDown";
import { Button } from "#/components/Button/Button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import {
	type AdminQuickLinksEditor,
	AdminSettingsItems,
	type AdminSettingsPermissions,
} from "./AdminSettings";
import type { AdminPage } from "./adminQuickLinks";

type AdminSettingsDropdownProps = {
	permissions: AdminSettingsPermissions;
	quickLinks?: readonly AdminPage[];
	quickLinksEditor?: AdminQuickLinksEditor;
};

export const AdminSettingsDropdown: React.FC<AdminSettingsDropdownProps> = ({
	permissions,
	quickLinks,
	quickLinksEditor,
}) => {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" size="lg">
					{/*
					 * Platform: static/admin-icon.svg holds both variants side by side, the white gear on a
					 * black disc (dark theme) on the left and the outlined gear (light theme) on the right;
					 * each theme shows its half.
					 */}
					<img
						src="/admin-icon.svg"
						alt=""
						className="hidden size-5 shrink-0 object-cover object-left dark:block"
					/>
					<img
						src="/admin-icon.svg"
						alt=""
						className="block size-5 shrink-0 object-cover object-right dark:hidden"
					/>
					{/* Platform: the menu is "Settings"; its first item, the deployment's, "Control Panel". */}
					Settings
					<ChevronDownIcon className="text-content-primary" />
				</Button>
			</DropdownMenuTrigger>

			<DropdownMenuContent
				align="end"
				className="w-[220px] has-[[data-cluster-gauge]]:w-[300px]"
			>
				<nav>
					<AdminSettingsItems
						permissions={permissions}
						quickLinks={quickLinks}
						quickLinksEditor={quickLinksEditor}
					/>
				</nav>
			</DropdownMenuContent>
		</DropdownMenu>
	);
};
