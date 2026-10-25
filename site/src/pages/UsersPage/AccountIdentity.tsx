import { ChevronDownIcon } from "lucide-react";
import type { User } from "#/api/typesGenerated";
import { AvatarData } from "#/components/Avatar/AvatarData";
import { Button } from "#/components/Button/Button";

/** Keeps identity starts aligned whether an account has action buttons or not. */
export const AccountIdentity: React.FC<{
	user: Pick<User, "username" | "email" | "avatar_url" | "is_service_account">;
	expanded: boolean;
	panelId: string;
	onToggle: () => void;
	children?: React.ReactNode;
}> = ({ user, expanded, panelId, onToggle, children }) => (
	<div className="grid min-w-0 grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-3">
		<Button
			variant="subtle"
			size="icon"
			className="size-7 shrink-0"
			aria-label={`${expanded ? "Collapse" : "Expand"} workspaces for ${user.username}`}
			aria-expanded={expanded}
			aria-controls={expanded ? panelId : undefined}
			onClick={onToggle}
		>
			<ChevronDownIcon aria-hidden className={expanded ? "rotate-180" : ""} />
		</Button>
		<div className="min-w-0" title={`${user.username}\n${user.email}`}>
			<AvatarData
				title={user.username}
				subtitle={user.is_service_account ? "Service Account" : user.email}
				src={user.avatar_url}
				truncate
			/>
		</div>
		<div className="flex items-center justify-end gap-2">{children}</div>
	</div>
);
