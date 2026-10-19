import type {
	TemplateParameterUsage,
	TemplateVersionParameter,
	TemplateVersionParameterOption,
} from "#/api/typesGenerated";

/** A parameter's usage, all its template versions in one: what the Parameters usage panel shows. */
export type MergedParameterUsage = TemplateParameterUsage & {
	/** The values the active version offers (options); undefined when it has none or no longer has the parameter. */
	offered?: ReadonlySet<string>;
	/** The active version no longer has the parameter. */
	removed: boolean;
};

/**
 * Platform: the insights report counts a parameter once per definition - every template version whose options,
 * description or name differ adds another entry (UBUNTU's Workspace image had 8, CPU 2), so the panel drew the same
 * parameter again and again. This makes one entry per parameter: named and described as the active version has it
 * (its parameters given), its values' counts added up, each value named by the active version's option, else by the
 * option it was chosen from, else shown as it is. A value an entry's own options do not hold (an orphan) is left out,
 * as before. The active version's parameters come first, in its order; ones it no longer has follow.
 */
export const mergeParameterUsage = (
	usage: readonly TemplateParameterUsage[],
	current: readonly TemplateVersionParameter[] = [],
): MergedParameterUsage[] => {
	const groups = new Map<string, TemplateParameterUsage[]>();
	for (const entry of usage) {
		const list = groups.get(entry.name);
		if (list) {
			list.push(entry);
		} else {
			groups.set(entry.name, [entry]);
		}
	}

	const merged: MergedParameterUsage[] = [];
	for (const [name, entries] of groups) {
		const now = current.find((p) => p.name === name);
		const counts = new Map<string, number>();
		// Options of the values counted: the active version's first, then the ones they were chosen from.
		const options = new Map<string, TemplateVersionParameterOption>();
		for (const option of now?.options ?? []) {
			options.set(option.value, option);
		}
		for (const entry of entries) {
			for (const usage of entry.values) {
				const own = entry.options?.find((o) => o.value === usage.value);
				if (entry.options && entry.options.length > 0 && !own) {
					continue; // an orphan of its own version's options
				}
				counts.set(usage.value, (counts.get(usage.value) ?? 0) + usage.count);
				if (own && !options.has(usage.value)) {
					options.set(usage.value, own);
				}
			}
		}
		const first = entries[0];
		const offered =
			now && now.options.length > 0
				? new Set(now.options.map((o) => o.value))
				: undefined;
		merged.push({
			template_ids: [...new Set(entries.flatMap((e) => e.template_ids))],
			name,
			display_name: now?.display_name ?? first.display_name,
			// the active version's in plain text (its description may be Markdown)
			description: now
				? now.description_plaintext || now.description
				: first.description,
			type: now?.type ?? first.type,
			options: options.size > 0 ? [...options.values()] : undefined,
			values: [...counts]
				.map(([value, count]) => ({ value, count }))
				.sort((a, b) => b.count - a.count),
			offered,
			removed: current.length > 0 && !now,
		});
	}

	const order = (p: MergedParameterUsage) => {
		const index = current.findIndex((c) => c.name === p.name);
		return index < 0 ? current.length : index;
	};
	return merged.sort((a, b) => order(a) - order(b));
};
