import { useEffect, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import {
	navbarAppearance,
	updateNavbarAppearance,
} from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { Loader } from "#/components/Loader/Loader";

export function NavbarAppearance() {
	const id = useId();
	const client = useQueryClient();
	const query = useQuery(navbarAppearance());
	const save = useMutation(updateNavbarAppearance(client));
	const [draft, setDraft] = useState<number | null>(null);
	const value = draft ?? query.data?.transparency ?? 0;
	useEffect(() => {
		if (draft === null) return;
		document.documentElement.style.setProperty(
			"--navbar-preview-alpha",
			String(1 - draft / 100),
		);
		return () => {
			document.documentElement.style.removeProperty("--navbar-preview-alpha");
		};
	}, [draft]);
	return (
		<section
			className="rounded-xl border border-solid border-border bg-surface-primary p-6"
			aria-labelledby={id}
		>
			<h2 id={id} className="m-0 text-base font-semibold">
				Navigation bar
			</h2>
			<p className="text-sm text-content-secondary">
				Choose how much of the page shows through the navigation bar for
				everyone. Preview your changes before saving.
			</p>
			{query.isLoading && <Loader />}
			{(query.error || save.error) && (
				<ErrorAlert error={query.error ?? save.error} />
			)}
			{query.data && (
				<>
					<label
						className="flex max-w-xl justify-between text-sm font-medium"
						htmlFor={`${id}-range`}
					>
						Navbar transparency <span aria-hidden>{value}%</span>
					</label>
					<input
						id={`${id}-range`}
						type="range"
						min="0"
						max="100"
						step="1"
						className="block my-3 w-full max-w-xl accent-content-link"
						aria-valuetext={`${value}% transparent`}
						value={value}
						disabled={save.isPending}
						onChange={(e) => setDraft(e.currentTarget.valueAsNumber)}
					/>
					<div className="flex gap-2">
						<Button
							disabled={save.isPending || value === query.data.transparency}
							onClick={() =>
								save.mutate(value, { onSuccess: () => setDraft(null) })
							}
						>
							Save navbar appearance
						</Button>
						<Button
							variant="outline"
							disabled={save.isPending || draft === null}
							onClick={() => setDraft(null)}
						>
							Discard changes
						</Button>
					</div>
				</>
			)}
		</section>
	);
}
