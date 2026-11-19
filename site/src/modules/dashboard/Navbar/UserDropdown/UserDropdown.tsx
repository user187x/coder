import type * as TypesGen from "#/api/typesGenerated";
import { Avatar } from "#/components/Avatar/Avatar";
import {
	DropdownMenu,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { BreadcrumbDropdownContent } from "../BreadcrumbMenu";
import { navbarTileTriggerClass } from "../NavbarLogo";
import { UserDropdownContent } from "./UserDropdownContent";

type UserDropdownProps = {
	user: TypesGen.User;
	buildInfo?: TypesGen.BuildInfoResponse;
	supportLinks: readonly TypesGen.LinkConfig[];
	onSignOut: () => void;
};

export const UserDropdown: React.FC<UserDropdownProps> = ({
	buildInfo,
	user,
	supportLinks,
	onSignOut,
}) => {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				{/* Platform: the same trigger as the logo's tile (NavbarLogo). */}
				<button
					type="button"
					aria-label="User menu"
					className={navbarTileTriggerClass}
				>
					<Avatar fallback={user.username} src={user.avatar_url} size="lg" />
				</button>
			</DropdownMenuTrigger>

			<BreadcrumbDropdownContent align="end" style={{ width: 260 }}>
				<UserDropdownContent
					user={user}
					buildInfo={buildInfo}
					supportLinks={supportLinks}
					onSignOut={onSignOut}
				/>
			</BreadcrumbDropdownContent>
		</DropdownMenu>
	);
};
