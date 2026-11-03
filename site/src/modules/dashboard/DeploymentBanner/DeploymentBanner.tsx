import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "react-query";
import { useLocation } from "react-router";
import { health } from "#/api/queries/debug";
import { deploymentStats } from "#/api/queries/deployment";
import { Margins } from "#/components/Margins/Margins";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { DeploymentBannerView } from "./DeploymentBannerView";

const selector = "[data-deployment-footer]";
const containsFooter = (node: Node) =>
	node instanceof Element &&
	(node.matches(selector) || node.querySelector(selector));

/** A card can mount after its data loads, or disappear when a tab changes. Keep one stats panel per page. */
export function DeploymentFooter({
	content,
	children,
}: React.PropsWithChildren<{ content: React.RefObject<HTMLElement | null> }>) {
	const [target, setTarget] = useState<Element | null>(null);
	useLayoutEffect(() => {
		const main = content.current;
		if (!main) return;
		const locate = () => {
			const slots = Array.from(
				main.querySelectorAll<HTMLElement>(selector),
			).filter(
				(slot) =>
					!slot.closest(
						'dialog, [role="dialog"], [hidden], details:not([open]), tbody',
					) && slot.parentElement?.checkVisibility?.() !== false,
			);
			setTarget(
				slots.find((slot) => slot.dataset.deploymentFooter !== "table") ??
					slots[0] ??
					null,
			);
		};
		locate();
		const observer = new MutationObserver((changes) => {
			if (
				changes.some((change) =>
					change.type === "attributes"
						? containsFooter(change.target)
						: Array.from(change.addedNodes).some(containsFooter) ||
							Array.from(change.removedNodes).some(containsFooter),
				)
			)
				locate();
		});
		observer.observe(main, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["open", "hidden", "data-state", "class"],
		});
		return () => observer.disconnect();
	}, [content]);
	return target ? (
		createPortal(children, target)
	) : (
		<Margins className="mb-3">
			<div data-deployment-footer="page">{children}</div>
		</Margins>
	);
}

export function DeploymentBanner({
	content,
}: {
	content: React.RefObject<HTMLElement | null>;
}) {
	const { permissions } = useAuthenticated();
	const { pathname } = useLocation();
	const enabled =
		Boolean(
			permissions.viewDeploymentConfig && permissions.viewDeploymentStats,
		) && !/^\/@[\w-]+\/[\w-]+\/?$/.test(pathname);
	const { data: stats, refetch } = useQuery({ ...deploymentStats(), enabled });
	const { data: report } = useQuery({ ...health(), enabled });
	if (!enabled || !stats) return null;
	return (
		<DeploymentFooter content={content}>
			<DeploymentBannerView
				stats={stats}
				health={report}
				fetchStats={refetch}
			/>
		</DeploymentFooter>
	);
}
