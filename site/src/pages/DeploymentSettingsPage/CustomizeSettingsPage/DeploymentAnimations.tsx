import { useId } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { animationPolicy, updateAnimationPolicy } from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Loader } from "#/components/Loader/Loader";
import { Switch } from "#/components/Switch/Switch";
import { ANIMATION_LABELS } from "#/hooks/useAnimationSettings";

export function DeploymentAnimations() {
	const client = useQueryClient();
	const { data, error, isLoading } = useQuery(animationPolicy());
	const save = useMutation(updateAnimationPolicy(client));
	const id = useId();
	return (
		<section
			aria-labelledby={id}
			className="rounded-xl border border-solid border-border bg-surface-primary p-6"
		>
			<h2 id={id} className="m-0 text-base font-semibold">
				Deployment animations
			</h2>
			<p className="text-sm text-content-secondary">
				Choose which animations people can enable. Turning a category off pauses
				it for everyone and keeps their personal choices.
			</p>
			{isLoading && <Loader />}
			{(error || save.error) && <ErrorAlert error={error ?? save.error} />}
			{data && (
				<div className="grid gap-x-8 md:grid-cols-2">
					{ANIMATION_LABELS.map(({ part, label }) => (
						<label
							key={part}
							className="flex items-center justify-between gap-3 border-0 border-t border-solid border-border py-3 text-sm"
							htmlFor={`${id}-${part}`}
						>
							{label}
							<Switch
								id={`${id}-${part}`}
								checked={data[part]}
								disabled={save.isPending || (part !== "all" && !data.all)}
								onCheckedChange={(enabled) => save.mutate({ part, enabled })}
							/>
						</label>
					))}
				</div>
			)}
		</section>
	);
}
