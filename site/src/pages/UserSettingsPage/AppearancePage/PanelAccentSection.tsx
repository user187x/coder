import { useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import type { PanelAccent } from "#/api/platform";
import {
	updateUserUIPreferences,
	userUIPreferences,
} from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Label } from "#/components/Label/Label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
import { ColorField } from "#/modules/platform/ColorField";

const DEFAULT_CUSTOM = "#7c3aed";
type Mode = "off" | PanelAccent["mode"];

/**
 * Appearance > Panel accents: the inner containers of the Settings menu and panel and of the chat (floating or
 * docked) take the theme's accent colour, a colour of the user's own, or none. Saved as the user's preference.
 */
export const PanelAccentSection: React.FC = () => {
	const id = useId();
	const queryClient = useQueryClient();
	const preferences = useQuery(userUIPreferences());
	const save = useMutation(updateUserUIPreferences(queryClient));
	const accent = preferences.data?.panel_accent ?? null;
	const mode: Mode = accent?.mode ?? "off";
	const [color, setColor] = useState(
		accent?.mode === "custom" ? accent.color : DEFAULT_CUSTOM,
	);
	const apply = (next: PanelAccent | null) =>
		save.mutate({ panel_accent: next });
	// The colour picker reports every step of a drag: save once it rests.
	const pending = useRef<ReturnType<typeof setTimeout>>(undefined);
	const applyColor = (value: string) => {
		clearTimeout(pending.current);
		pending.current = setTimeout(
			() => apply({ mode: "custom", color: value }),
			400,
		);
	};

	return (
		<section
			className="mt-6 rounded-xl border border-solid border-border bg-surface-primary p-6"
			aria-labelledby={`${id}-title`}
		>
			{Boolean(save.error) && <ErrorAlert error={save.error} />}
			<h2 id={`${id}-title`} className="m-0 text-lg font-semibold">
				Panel accents
			</h2>
			<p className="mt-0 mb-4 text-sm text-content-secondary">
				Colour the cards and rows inside the Settings menu and side panel and
				the chat, floating or docked.
			</p>
			<div className="flex max-w-md flex-col gap-3">
				<Label htmlFor={`${id}-mode`}>Accent</Label>
				<Select
					value={mode}
					disabled={preferences.isLoading || save.isPending}
					onValueChange={(value) => {
						if (value === "off") apply(null);
						if (value === "theme") apply({ mode: "theme" });
						if (value === "custom") apply({ mode: "custom", color });
					}}
				>
					<SelectTrigger id={`${id}-mode`}>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="off">None</SelectItem>
						<SelectItem value="theme">Follow theme</SelectItem>
						<SelectItem value="custom">Custom colour</SelectItem>
					</SelectContent>
				</Select>
				{mode === "custom" && (
					<ColorField
						label="Accent colour"
						value={color}
						onChange={(value) => {
							setColor(value);
							applyColor(value);
						}}
					/>
				)}
			</div>
		</section>
	);
};
