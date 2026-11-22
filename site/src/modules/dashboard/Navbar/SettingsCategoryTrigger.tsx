import { useCallback } from "react";
import { BreadcrumbItem } from "#/components/Breadcrumb/Breadcrumb";
import { CategoryDefaultMenu } from "./DefaultViewOption";
import { settingsMenuSlot, useSettingsMenuPresent } from "./settingsMenuHost";

/** Anchors the Settings menu to the current category. */
export function SettingsCategoryTrigger({
	label,
	iconOnly = false,
	path,
	actions,
	children,
}: {
	label: string;
	iconOnly?: boolean;
	path?: string;
	actions?: React.ReactNode;
	children: React.ReactNode;
}) {
	const menuPresent = useSettingsMenuPresent();
	const register = useCallback(
		(element: HTMLLIElement | null) =>
			settingsMenuSlot(element, { label, iconOnly }),
		[label, iconOnly],
	);
	if (menuPresent) return <BreadcrumbItem ref={register} />;
	return (
		<CategoryDefaultMenu path={path} actions={actions}>
			<BreadcrumbItem>{children}</BreadcrumbItem>
		</CategoryDefaultMenu>
	);
}
