import { ExternalLinkIcon } from "lucide-react";
import { Link } from "react-router";
import { Button } from "#/components/Button/Button";

type AlternativeLink = {
	label: string;
	href: string;
	external: boolean;
};

// Platform: no "Start from scratch" (Coder's online docs: unreachable in an air gap).
const alternatives: readonly AlternativeLink[] = [
	{
		label: "Upload an existing template",
		href: "/templates/new",
		external: false,
	},
	{
		label: "Browse community templates",
		href: "https://registry.coder.com/templates",
		external: true,
	},
	{
		label: "Use template agent skill",
		href: "https://registry.coder.com/skills",
		external: true,
	},
];

export const TemplateAlternatives: React.FC = () => {
	return (
		<div className="p-6 border border-solid rounded-lg mt-6">
			<p className="text-sm text-content-secondary mb-4 mt-0">
				Alternatives to create a template:
			</p>
			<div className="flex flex-wrap gap-2">
				{alternatives.map((alt) =>
					alt.external ? (
						<Button key={alt.label} variant="outline" size="sm" asChild>
							<a href={alt.href} target="_blank" rel="noreferrer">
								{alt.label}
								<ExternalLinkIcon />
							</a>
						</Button>
					) : (
						<Button key={alt.label} variant="outline" size="sm" asChild>
							<Link to={alt.href}>{alt.label}</Link>
						</Button>
					),
				)}
			</div>
		</div>
	);
};
