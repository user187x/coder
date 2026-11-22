import type { LucideIcon } from "lucide-react";
import { useCallback } from "react";
import { BreadcrumbItem } from "#/components/Breadcrumb/Breadcrumb";
import { CategoryDefaultMenu } from "./DefaultViewOption";
import { settingsMenuSlot, useSettingsMenuPresent } from "./settingsMenuHost";

/** Anchors the Settings menu to the current category. */
export function SettingsCategoryTrigger({
	label,
	icon,
	path,
	actions,
	children,
}: {
	label: string;
	icon: LucideIcon;
	path?: string;
	actions?: React.ReactNode;
	children: React.ReactNode;
}) {
	const menuPresent = useSettingsMenuPresent();
	const register = useCallback(
		(element: HTMLLIElement | null) =>
			settingsMenuSlot(element, { label, icon }),
		[label, icon],
	);
	if (menuPresent) return <BreadcrumbItem ref={register} />;
	return (
		<CategoryDefaultMenu path={path} actions={actions}>
			<BreadcrumbItem>{children}</BreadcrumbItem>
		</CategoryDefaultMenu>
	);
}
