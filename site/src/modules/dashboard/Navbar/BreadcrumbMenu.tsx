import { useQuery } from "react-query";
import { userUIPreferences } from "#/api/queries/platform";
import { ContextMenuContent } from "#/components/ContextMenu/ContextMenu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { navbarSettingsSide } from "./settingsMenuHost";
import "./settingsMenuSkeuo.css";

export const breadcrumbMenuClass =
	"settings-menu settings-menu-sections overflow-visible border-0 bg-transparent p-0 shadow-none";

export function BreadcrumbMenuPanel({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<div className="settings-menu-surface flex max-h-[calc(var(--radix-popper-available-height,80vh)/var(--app-zoom,1))] flex-col overflow-hidden rounded-2xl border border-solid border-border bg-surface-primary p-2 shadow-md">
			<div className="settings-menu-well flex min-h-0 flex-col gap-1 overflow-y-auto rounded-lg border border-solid border-border p-1 scrollbar-thin [scrollbar-color:hsl(var(--surface-quaternary))_transparent]">
				{children}
			</div>
		</div>
	);
}

export function BreadcrumbDropdownContent({
	children,
	align,
	...props
}: Omit<React.ComponentProps<typeof DropdownMenuContent>, "className">) {
	const preferences = useQuery(userUIPreferences());
	return (
		<DropdownMenuContent
			align={
				align ??
				(navbarSettingsSide(preferences.data) === "right" ? "end" : "start")
			}
			sideOffset={8}
			collisionPadding={8}
			className={breadcrumbMenuClass}
			{...props}
		>
			<BreadcrumbMenuPanel>{children}</BreadcrumbMenuPanel>
		</DropdownMenuContent>
	);
}

export function BreadcrumbContextMenuContent({
	children,
	...props
}: Omit<React.ComponentProps<typeof ContextMenuContent>, "className">) {
	return (
		<ContextMenuContent
			collisionPadding={8}
			className={breadcrumbMenuClass}
			{...props}
		>
			<BreadcrumbMenuPanel>{children}</BreadcrumbMenuPanel>
		</ContextMenuContent>
	);
}

export function BreadcrumbViewMenu({
	label,
	trigger,
	children,
}: {
	label: string;
	trigger?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<DropdownMenu modal={false}>
			<DropdownMenuTrigger asChild>
				<button type="button" aria-label={label} title={label}>
					{trigger ?? label}
				</button>
			</DropdownMenuTrigger>
			<BreadcrumbDropdownContent>{children}</BreadcrumbDropdownContent>
		</DropdownMenu>
	);
}
