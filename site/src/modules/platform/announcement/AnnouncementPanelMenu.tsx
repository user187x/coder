import { EraserIcon, ImageIcon, SettingsIcon } from "lucide-react";
import { Link } from "react-router";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "#/components/ContextMenu/ContextMenu";
import { useAuthContext } from "#/contexts/auth/AuthProvider";

export const AnnouncementPanelMenu: React.FC<{
	children: React.ReactElement;
	menuRef: React.Ref<HTMLDivElement>;
	hasPicture: boolean;
	showPicture: boolean;
	onTogglePicture: () => void;
	onClear?: () => void;
	onClose: () => void;
}> = ({
	children,
	menuRef,
	hasPicture,
	showPicture,
	onTogglePicture,
	onClear,
	onClose,
}) => {
	const { permissions } = useAuthContext();
	return (
		<ContextMenu>
			<ContextMenuTrigger
				asChild
				onContextMenu={(event) => event.stopPropagation()}
			>
				{children}
			</ContextMenuTrigger>
			<ContextMenuContent
				ref={menuRef}
				aria-label="Announcement panel actions"
				className="z-[2147483001]"
			>
				{permissions?.editDeploymentConfig && (
					<ContextMenuItem asChild onSelect={onClose}>
						<Link to="/deployment/announcement">
							<SettingsIcon />
							Settings
						</Link>
					</ContextMenuItem>
				)}
				<ContextMenuItem disabled={!hasPicture} onSelect={onTogglePicture}>
					<ImageIcon />
					{showPicture ? "Disable background" : "Enable background"}
				</ContextMenuItem>
				<ContextMenuItem disabled={!onClear} onSelect={onClear}>
					<EraserIcon />
					Clear
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
};
