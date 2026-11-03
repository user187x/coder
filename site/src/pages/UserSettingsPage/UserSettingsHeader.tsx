import { SettingsHeader } from "#/components/SettingsHeader/SettingsHeader";
import { settingsSections, type UserSettingsSection } from "./settingsSections";

/** Places the selected page's heading and actions in the personal settings card header. */
export const UserSettingsHeader = ({
	section,
	...props
}: React.ComponentProps<typeof SettingsHeader> & {
	section: UserSettingsSection;
}) => {
	const Icon = settingsSections[section].icon;
	return (
		<div className="user-settings-card-head flex items-start gap-3.5">
			<span className="ws-icon-tile" aria-hidden>
				<Icon className="size-5" />
			</span>
			<SettingsHeader className="min-w-0 flex-1 pb-0" {...props} />
		</div>
	);
};
