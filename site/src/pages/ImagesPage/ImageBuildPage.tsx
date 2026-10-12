import { cn } from "cn";
import {
	ArrowLeftIcon,
	CircleCheckIcon,
	CircleIcon,
	CircleXIcon,
	FileTextIcon,
	LoaderIcon,
	PencilIcon,
	SquareIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { Link as RouterLink, useParams } from "react-router";
import { type BuildDetail, ImagesAPI, terraformSnippet } from "#/api/images";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { CodeExample } from "#/components/CodeExample/CodeExample";
import { Loader } from "#/components/Loader/Loader";
import { Margins } from "#/components/Margins/Margins";
import { Spinner } from "#/components/Spinner/Spinner";
import { useStartProgress } from "#/modules/platform/workspaceInitializing/WorkspaceInitializing";
import "#/modules/platform/workspaceInitializing/workspaceInitializing.css";
import { pageTitle } from "#/utils/page";
import { FipsBadge, GradeBadge } from "./badges";
import { imageKey } from "./ImageEditorPage";
import { imagesKey } from "./ImagesPage";

const FINISHED = ["ready", "failed", "cancelled"];

const elapsed = (from: string, to: number) => {
	const seconds = Math.max(0, Math.floor((to - Date.parse(from)) / 1000));
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/** Templates > Images > (an image) > a build: its progress as it runs, and what came of it. */
const ImageBuildPage: React.FC = () => {
	const { image: id = "", build: buildParam = "" } = useParams();
	const buildId = Number(buildParam);
	const queryClient = useQueryClient();
	const query = useQuery({
		queryKey: [...imageKey(id), "builds", buildId],
		queryFn: () => ImagesAPI.buildStatus(id, buildId),
		refetchInterval: (q) =>
			q.state.data && FINISHED.includes(q.state.data.build.status)
				? false
				: 1500,
	});
	const detail = useQuery({
		queryKey: imageKey(id),
		queryFn: () => ImagesAPI.get(id),
	});
	const status = query.data?.build.status;
	useEffect(() => {
		if (status && FINISHED.includes(status)) {
			void queryClient.invalidateQueries({ queryKey: imagesKey });
		}
	}, [status, queryClient]);
	const cancel = useMutation({
		mutationFn: () => ImagesAPI.cancelBuild(id, buildId),
		onSuccess: () => void query.refetch(),
	});

	if (query.error) {
		return (
			<Margins className="py-10">
				<ErrorAlert error={query.error} />
			</Margins>
		);
	}
	if (!query.data) {
		return <Loader />;
	}
	const { build, image } = query.data;
	const name = detail.data?.image.name ?? id;
	const finished = FINISHED.includes(build.status);

	return (
		<Margins className="flex flex-col gap-6 pb-12">
			<title>{pageTitle(`${name} build ${build.id}`, "Images")}</title>
			<header className="flex flex-wrap items-center gap-3 pt-8">
				<Button variant="subtle" size="sm" asChild>
					<RouterLink to={`/images/${id}`}>
						<ArrowLeftIcon />
						{name}
					</RouterLink>
				</Button>
				<h1 className="m-0 text-2xl font-semibold">
					{name} v{build.version}
				</h1>
				<span className="text-sm text-content-secondary">
					build {build.id}
					{build.by ? ` by ${build.by}` : ""}
				</span>
				<span className="flex-1" />
				{!finished && (
					<Button
						variant="outline"
						onClick={() => cancel.mutate()}
						disabled={cancel.isPending}
					>
						<Spinner loading={cancel.isPending}>
							<SquareIcon />
						</Spinner>
						Cancel build
					</Button>
				)}
				{finished && detail.data?.image.canEdit && (
					<Button variant="outline" asChild>
						<RouterLink to={`/images/${id}/edit`}>
							<PencilIcon />
							{build.status === "ready" ? "Edit" : "Back to the builder"}
						</RouterLink>
					</Button>
				)}
			</header>
			<BuildPanel build={build} />
			{build.status === "ready" && image.pullRef && (
				<section
					className="flex flex-col gap-4 rounded-lg border border-solid border-border p-5"
					data-testid="build-ready"
				>
					<div className="flex flex-wrap items-center gap-4">
						<h2 className="m-0 text-lg font-semibold">Ready for templates</h2>
						<GradeBadge summary={image.summary} />
						<FipsBadge status={image.summary?.fips} />
						<span className="flex-1" />
						<Button variant="outline" asChild>
							<RouterLink to={`/images/${id}#report`}>
								<FileTextIcon />
								Security report
							</RouterLink>
						</Button>
					</div>
					<CodeExample code={image.pullRef} secret={false} />
					<p className="m-0 text-sm text-content-secondary">
						In a workspace template's Terraform:
					</p>
					<pre className="m-0 overflow-x-auto rounded-md border border-solid border-border bg-surface-secondary p-3 text-xs">
						{terraformSnippet(image.pullRef)}
					</pre>
				</section>
			)}
			<BuildLog lines={build.log} follow={!finished} />
		</Margins>
	);
};

/** The workspace restart's panel (stripes, bricks, a bar that moves on real progress), for an image build. */
const BuildPanel: React.FC<{ build: BuildDetail }> = ({ build }) => {
	const [now, setNow] = useState(Date.now);
	const finished = FINISHED.includes(build.status);
	useEffect(() => {
		if (finished) {
			return;
		}
		const timer = window.setInterval(() => setNow(Date.now()), 500);
		return () => window.clearInterval(timer);
	}, [finished]);
	const total = build.steps.length;
	const done =
		build.status === "ready"
			? total
			: build.steps.filter((s) => s.state === "done").length;
	const overall = useStartProgress(done, total, now);
	const percent =
		build.status === "ready" ? 100 : Math.min(99, Math.round(overall * 100));
	const activeIndex = build.steps.findIndex((s) => s.state === "active");
	const title =
		build.status === "ready"
			? "IMAGE READY"
			: build.status === "failed"
				? "BUILD FAILED"
				: build.status === "cancelled"
					? "BUILD CANCELLED"
					: "IMAGE BUILDING";
	const end = build.finishedAt ? Date.parse(build.finishedAt) : now;

	return (
		<div className="flex flex-col gap-4">
			<section
				className="ws-init"
				role="status"
				aria-live="polite"
				data-testid="image-build-panel"
				data-status={build.status}
			>
				<div className="ws-init-stripes" />
				<div className="ws-init-stage">
					{!finished && (
						<img src="/loading-brix.gif" alt="" className="ws-init-anim" />
					)}
					<div className="ws-init-text">
						<h2
							className="ws-init-title"
							style={finished ? { animation: "none" } : undefined}
						>
							{title}
						</h2>
						<div className="ws-init-info">
							<p className="ws-init-step">
								{build.status === "failed" || build.status === "cancelled"
									? (build.error ?? "The build stopped.")
											.split("\n")[0]
											.slice(0, 200)
									: build.status === "ready"
										? "Built, pushed and scanned"
										: (build.message ?? "Waiting for the builder…")}
							</p>
							<div className="ws-init-meter">
								<div
									className="ws-init-progress"
									role="progressbar"
									aria-label="Image build"
									aria-valuemin={0}
									aria-valuemax={100}
									aria-valuenow={percent}
									aria-valuetext={`${percent}%: ${done} of ${total} steps done`}
									title={`${done} of ${total} steps done`}
								>
									<div
										className="ws-init-progress-fill"
										style={{
											width: `${Math.max(2, percent)}%`,
											...(build.status === "failed" ||
											build.status === "cancelled"
												? {
														background: "#b91c1c",
														boxShadow: "none",
														animation: "none",
													}
												: {}),
										}}
									/>
								</div>
								<span className="ws-init-percent">{percent}%</span>
							</div>
							<p className="ws-init-detail">
								Step{" "}
								{Math.min(total, activeIndex >= 0 ? activeIndex + 1 : done)} of{" "}
								{total}
								{build.steps[activeIndex] &&
									` · ${build.steps[activeIndex].label}`}
							</p>
							<p className="ws-init-note">
								{elapsed(build.startedAt, end)}{" "}
								{finished
									? "in all"
									: "elapsed · you can leave this page; the build goes on"}
							</p>
						</div>
					</div>
				</div>
				<div className="ws-init-stripes" />
			</section>
			<ol
				className="m-0 grid list-none gap-x-6 gap-y-1.5 p-0 text-sm sm:grid-cols-2 lg:grid-cols-3"
				data-testid="build-steps"
			>
				{build.steps.map((s) => {
					const failedHere =
						s.state === "active" &&
						(build.status === "failed" || build.status === "cancelled");
					return (
						<li
							key={s.key}
							className={cn(
								"flex items-center gap-2",
								s.state === "pending" && "text-content-secondary",
								s.state === "active" && "font-semibold",
							)}
							data-state={s.state}
						>
							{s.state === "done" || build.status === "ready" ? (
								<CircleCheckIcon className="size-4 text-content-success" />
							) : failedHere ? (
								<CircleXIcon className="size-4 text-content-destructive" />
							) : s.state === "active" ? (
								<LoaderIcon className="size-4 animate-spin" />
							) : (
								<CircleIcon className="size-4" />
							)}
							{s.label}
						</li>
					);
				})}
			</ol>
		</div>
	);
};

const BuildLog: React.FC<{ lines: string[]; follow: boolean }> = ({
	lines,
	follow,
}) => {
	const ref = useRef<HTMLPreElement>(null);
	const pinned = useRef(true);
	useEffect(() => {
		const el = ref.current;
		if (el && follow && pinned.current) {
			el.scrollTop = el.scrollHeight;
		}
	}, [lines, follow]);
	return (
		<details open className="rounded-lg border border-solid border-border">
			<summary className="cursor-pointer px-4 py-2 text-sm font-semibold">
				Build log ({lines.length} lines shown)
			</summary>
			<pre
				ref={ref}
				onScroll={(e) => {
					const el = e.currentTarget;
					pinned.current =
						el.scrollHeight - el.scrollTop - el.clientHeight < 40;
				}}
				className="m-0 max-h-[28rem] overflow-auto border-0 border-t border-solid border-border bg-surface-secondary p-3 text-xs leading-relaxed"
				data-testid="build-log"
			>
				{lines.join("\n") || "Waiting for output…"}
			</pre>
		</details>
	);
};

export default ImageBuildPage;
