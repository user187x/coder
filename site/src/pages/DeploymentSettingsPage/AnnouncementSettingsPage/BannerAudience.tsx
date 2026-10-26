import { useState } from "react";
import { useQuery } from "react-query";
import type { BannerFields } from "#/api/platform";
import { users } from "#/api/queries/users";
import { Checkbox } from "#/components/Checkbox/Checkbox";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";

export const BannerAudience = ({
	form,
	onChange,
}: {
	form: BannerFields;
	onChange: (patch: Partial<BannerFields>) => void;
}) => {
	const [search, setSearch] = useState("");
	const selected = form.audience === "selected";
	const query = useQuery({
		...users({ q: search, limit: 100 }),
		enabled: selected,
	});
	const ids = form.audienceUserIds ?? [];
	return (
		<section
			className="space-y-3 border-0 border-t border-solid border-border pt-4"
			aria-label="Target audience"
		>
			<h3 className="m-0 text-sm font-semibold">Target audience</h3>
			<Select
				value={form.audience ?? "everyone"}
				onValueChange={(audience) => {
					if (audience === "everyone" || audience === "selected")
						onChange({ audience });
				}}
			>
				<SelectTrigger aria-label="Target audience">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="everyone">Everyone</SelectItem>
					<SelectItem value="selected">Selected users</SelectItem>
				</SelectContent>
			</Select>
			{selected && (
				<>
					<Input
						aria-label="Search recipients"
						placeholder="Search users…"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
					/>
					<p className="m-0 text-xs text-content-secondary">
						{ids.length} selected. Only these signed-in users receive the
						banner. It will not appear on the sign-in page.
					</p>
					{query.isLoading ? (
						<p>Loading users…</p>
					) : query.isError ? (
						<p role="alert">Users could not be loaded. Try again.</p>
					) : (
						<div className="max-h-48 space-y-2 overflow-y-auto">
							{query.data?.users.map((user) => (
								<Label key={user.id} className="flex items-center gap-2">
									<Checkbox
										checked={ids.includes(user.id)}
										onCheckedChange={(checked) =>
											onChange({
												audienceUserIds:
													checked === true
														? [...new Set([...ids, user.id])]
														: ids.filter((id) => id !== user.id),
											})
										}
									/>
									{user.username} ({user.email})
								</Label>
							))}
							{query.data?.users.length === 0 && <p>No matching users.</p>}
						</div>
					)}
					{ids.length === 0 && (
						<p role="alert" className="text-sm text-content-secondary">
							Select at least one recipient before publishing.
						</p>
					)}
				</>
			)}
		</section>
	);
};
