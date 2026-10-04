import { ChevronDownIcon } from "#/components/AnimatedIcons/ChevronDown";
import { Button } from "#/components/Button/Button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import {
	AdminSettingsItems,
	type AdminSettingsPermissions,
} from "./AdminSettings";
import type { AdminPage } from "./adminQuickLinks";

type AdminSettingsDropdownProps = {
	permissions: AdminSettingsPermissions;
	quickLinks?: readonly (AdminPage | undefined)[];
	onCustomizeQuickLinks?: () => void;
};

export const AdminSettingsDropdown: React.FC<AdminSettingsDropdownProps> = ({
	permissions,
	quickLinks,
	onCustomizeQuickLinks,
}) => {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" size="lg">
					Admin
					<ChevronDownIcon className="text-content-primary" />
				</Button>
			</DropdownMenuTrigger>

			<DropdownMenuContent
				align="end"
				className="w-[180px] has-[[data-cluster-gauge]]:w-[300px]"
			>
				<nav>
					<AdminSettingsItems
						permissions={permissions}
						quickLinks={quickLinks}
						onCustomizeQuickLinks={onCustomizeQuickLinks}
					/>
				</nav>
			</DropdownMenuContent>
		</DropdownMenu>
	);
};
