import { Link } from "react-router";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
import { useDashboard } from "#/modules/dashboard/useDashboard";
import { settingsSections } from "#/pages/UserSettingsPage/settingsSections";

/** The Profile row's right-click options: every User Settings section its sidebar lists, each opening it. */
export const ProfileSections: React.FC = () => {
	const { entitlements, buildInfo } = useDashboard();
	return (
		<>
			{Object.entries(settingsSections).map(([path, { label, icon: Icon }]) =>
				path === "appearance" ||
				(path === "oauth2-provider" && !buildInfo.oauth2_provider) ||
				(path === "schedule" &&
					!entitlements.features.advanced_template_scheduling
						.enabled) ? null : (
					<DropdownMenuItem key={path} asChild>
						<Link to={`/settings/${path}`}>
							<Icon aria-hidden className="size-4 shrink-0" />
							{label}
						</Link>
					</DropdownMenuItem>
				),
			)}
		</>
	);
};
