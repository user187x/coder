import { useId } from "react";

type SettingsCardProps = {
	title: string;
	description: React.ReactNode;
	children: React.ReactNode;
};

/**
 * One card of a settings page laid out in cards (Template Settings, like the
 * workspace's settings): its title and a line on what it is for, then its
 * fields.
 */
export const SettingsCard: React.FC<SettingsCardProps> = ({
	title,
	description,
	children,
}) => {
	const titleId = useId();
	return (
		<section
			aria-labelledby={titleId}
			className="min-w-0 rounded-xl border border-solid border-border bg-surface-primary p-6 shadow-sm"
		>
			<header className="mb-5">
				<h2
					id={titleId}
					className="m-0 text-base font-semibold text-content-primary"
				>
					{title}
				</h2>
				<p className="m-0 mt-1 text-sm leading-relaxed text-content-secondary">
					{description}
				</p>
			</header>
			{children}
		</section>
	);
};
