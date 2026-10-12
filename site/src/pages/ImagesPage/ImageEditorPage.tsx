import { cn } from "cn";
import {
	ArrowLeftIcon,
	ArrowRightIcon,
	CircleAlertIcon,
	CircleCheckIcon,
	HammerIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "react-query";
import {
	Navigate,
	Link as RouterLink,
	useNavigate,
	useParams,
} from "react-router";
import { getErrorMessage } from "#/api/errors";
import {
	type ImageDetail,
	type ImageInstallation,
	type ImageSpec,
	ImagesAPI,
} from "#/api/images";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import { Loader } from "#/components/Loader/Loader";
import { Margins } from "#/components/Margins/Margins";
import { Spinner } from "#/components/Spinner/Spinner";
import { Textarea } from "#/components/Textarea/Textarea";
import { useDebouncedValue } from "#/hooks/debounce";
import { pageTitle } from "#/utils/page";
import {
	ConfigStep,
	DesktopStep,
	HardenStep,
	InstallationsStep,
	PackagesStep,
	ReviewStep,
	useAptCheck,
} from "./BuilderSteps";
import { imagesKey } from "./ImagesPage";

const STEPS = [
	{ key: "basics", title: "Basics" },
	{ key: "packages", title: "Packages" },
	{ key: "installations", title: "Installations" },
	{ key: "harden", title: "Remove & harden" },
	{ key: "desktop", title: "Desktop" },
	{ key: "config", title: "Configuration" },
	{ key: "review", title: "Review & build" },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

export const imageKey = (id: string) => ["platform", "images", id] as const;

/** Templates > Images > (an image) > Edit: the builder, step by step; saved as you go. */
const ImageEditorPage: React.FC = () => {
	const { image: id = "" } = useParams();
	const query = useQuery({
		queryKey: imageKey(id),
		queryFn: () => ImagesAPI.get(id),
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
	if (!query.data.image.canEdit) {
		return <Navigate to={`/images/${id}`} replace />;
	}
	return <ImageEditor image={query.data.image} />;
};

const ImageEditor: React.FC<{ image: ImageDetail }> = ({ image }) => {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [spec, setSpec] = useState<ImageSpec>(image.spec);
	const [description, setDescription] = useState(image.description);
	const [step, setStep] = useState<StepKey>("basics");
	const [openInstall, setOpenInstall] = useState<string>();
	const settings = useQuery({
		queryKey: ["platform", "images", "settings"],
		queryFn: ImagesAPI.settings,
	});
	const list = useQuery({ queryKey: imagesKey, queryFn: ImagesAPI.list });

	// saved a moment after each change
	const saved = useRef(
		JSON.stringify({ spec: image.spec, description: image.description }),
	);
	const current = JSON.stringify({ spec, description });
	const pending = useDebouncedValue(current, 800);
	const save = useMutation({
		mutationFn: (body: string) => ImagesAPI.save(image.id, JSON.parse(body)),
		onSuccess: (out, body) => {
			saved.current = body;
			queryClient.setQueryData(imageKey(image.id), out);
		},
	});
	const { mutate } = save;
	useEffect(() => {
		if (pending !== saved.current) {
			mutate(pending);
		}
	}, [pending, mutate]);
	const dirty = current !== saved.current;

	// leaving with unsaved changes
	useEffect(() => {
		const warn = (e: BeforeUnloadEvent) => {
			if (current !== saved.current) {
				e.preventDefault();
			}
		};
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [current]);

	// what stops a build: packages apt lacks, installations without a (clean) script
	const apt = useAptCheck(spec.packages);
	const missing = spec.packages.filter(
		(p) => apt.data?.results[p] && !apt.data.results[p].available,
	);
	const scripts = useDebouncedValue(
		spec.installations.map((i) => i.script),
		1000,
	);
	const lints = useQueries({
		queries: scripts.map((script) => ({
			queryKey: ["platform", "images", "lint", script],
			queryFn: () => ImagesAPI.lint(script),
			enabled: Boolean(script.trim()),
			staleTime: Number.POSITIVE_INFINITY,
		})),
	});
	const installProblems = spec.installations.flatMap((inst, n) => {
		const meaningful = inst.script
			.split("\n")
			.some((l) => l.trim() && !l.trim().startsWith("#"));
		if (!meaningful) {
			return [`The installation "${inst.name}" has no script yet.`];
		}
		const errors = (lints[n]?.data?.issues ?? []).filter(
			(i) => i.level === "error",
		).length;
		return errors
			? [
					`The installation "${inst.name}" has ${errors} shellcheck error${errors === 1 ? "" : "s"}.`,
				]
			: [];
	});
	const hardenErrors = useQuery({
		queryKey: ["platform", "images", "lint", spec.hardening.script],
		queryFn: () => ImagesAPI.lint(spec.hardening.script),
		enabled: Boolean(spec.hardening.script.trim()),
		staleTime: Number.POSITIVE_INFINITY,
	}).data?.issues.filter((i) => i.level === "error").length;

	const problemsByStep: Partial<Record<StepKey, string[]>> = {
		packages: [
			...missing.map(
				(p) =>
					`"${p}" is not in the apt sources: upload its .deb, install it manually, or remove it.`,
			),
			...(!apt.error && spec.packages.some((p) => !apt.data?.results[p])
				? ["The packages are still being checked."]
				: []),
			...(apt.error
				? [getErrorMessage(apt.error, "The packages could not be checked.")]
				: []),
		],
		installations: installProblems,
		harden: hardenErrors
			? [
					`The hardening script has ${hardenErrors} shellcheck error${hardenErrors === 1 ? "" : "s"}.`,
				]
			: [],
	};
	const problems = Object.values(problemsByStep).flat();

	const preview = useQuery({
		queryKey: ["platform", "images", "dockerfile", image.id, pending],
		queryFn: () => ImagesAPI.dockerfile(image.id, JSON.parse(pending).spec),
		enabled: step === "review",
	});

	const build = useMutation({
		mutationFn: async () => {
			if (current !== saved.current) {
				await save.mutateAsync(current);
			}
			return ImagesAPI.build(image.id);
		},
		onSuccess: ({ build }) => {
			void queryClient.invalidateQueries({ queryKey: imagesKey });
			navigate(`/images/${image.id}/builds/${build}`);
		},
	});

	const index = STEPS.findIndex((s) => s.key === step);
	// a step with problems can't be left forward (the packages step: until each is found or dealt with)
	const blocked = (problemsByStep[step] ?? []).length > 0 && step !== "review";

	const onAddInstallation = (inst: ImageInstallation, replaces: string) => {
		let id = inst.id;
		for (let n = 2; spec.installations.some((i) => i.id === id); n++) {
			id = `${inst.id}-${n}`;
		}
		setSpec({
			...spec,
			packages: spec.packages.filter((p) => p !== replaces),
			installations: [...spec.installations, { ...inst, id }],
		});
		setOpenInstall(id);
		setStep("installations");
	};

	const stepProps = { imageId: image.id, spec, onChange: setSpec };
	const bases = (list.data?.images ?? []).filter(
		(i) => i.pullRef && i.id !== image.id,
	);

	return (
		<Margins className="pb-12">
			<title>{pageTitle(`Edit ${image.name}`, "Images")}</title>
			<header className="flex flex-wrap items-center gap-3 py-8">
				<Button variant="subtle" size="sm" asChild>
					<RouterLink to={`/images/${image.id}`}>
						<ArrowLeftIcon />
						{image.name}
					</RouterLink>
				</Button>
				<h1 className="m-0 text-2xl font-semibold">Image builder</h1>
				<span
					className="text-sm text-content-secondary"
					aria-live="polite"
					data-testid="save-state"
				>
					{save.error && !save.isPending ? (
						<span className="text-content-destructive">
							Not saved: {getErrorMessage(save.error, "the server refused it")}
						</span>
					) : save.isPending || dirty ? (
						"Saving…"
					) : (
						"All changes saved"
					)}
				</span>
				<span className="flex-1" />
				{image.activeBuild && (
					<Button variant="outline" asChild>
						<RouterLink to={`/images/${image.id}/builds/${image.activeBuild}`}>
							<Spinner loading />A build is running
						</RouterLink>
					</Button>
				)}
				<Button
					onClick={() => build.mutate()}
					disabled={
						problems.length > 0 || build.isPending || Boolean(image.activeBuild)
					}
					title={
						problems.length
							? problems.join("\n")
							: `Build ${image.name} v${image.version + 1}`
					}
					data-testid="build-button"
				>
					<Spinner loading={build.isPending}>
						<HammerIcon />
					</Spinner>
					Build v{image.version + 1}
				</Button>
			</header>
			{build.error ? (
				<div className="mb-4">
					<ErrorAlert error={build.error} />
				</div>
			) : null}
			<div className="grid gap-8 md:grid-cols-[13rem_1fr]">
				<nav aria-label="Builder steps">
					<ol className="m-0 flex list-none flex-col gap-1 p-0">
						{STEPS.map((s, n) => {
							const p = problemsByStep[s.key] ?? [];
							return (
								<li key={s.key}>
									<button
										type="button"
										onClick={() => setStep(s.key)}
										aria-current={s.key === step ? "step" : undefined}
										className={cn(
											"flex w-full cursor-pointer items-center gap-3 rounded-md border-0 px-3 py-2 text-left text-sm",
											s.key === step
												? "bg-surface-secondary font-semibold text-content-primary"
												: "bg-transparent text-content-secondary hover:bg-surface-secondary hover:text-content-primary",
										)}
									>
										<span
											className={cn(
												"flex size-6 shrink-0 items-center justify-center rounded-full border border-solid text-xs tabular-nums",
												p.length
													? "border-border-destructive text-content-destructive"
													: n < index
														? "border-content-success text-content-success"
														: "border-border",
											)}
										>
											{p.length ? (
												<CircleAlertIcon className="size-3.5" />
											) : n < index ? (
												<CircleCheckIcon className="size-3.5" />
											) : (
												n + 1
											)}
										</span>
										{s.title}
										{s.key === "packages" && spec.packages.length > 0 && (
											<span className="ml-auto text-xs tabular-nums">
												{spec.packages.length}
											</span>
										)}
										{s.key === "installations" &&
											spec.installations.length > 0 && (
												<span className="ml-auto text-xs tabular-nums">
													{spec.installations.length}
												</span>
											)}
									</button>
								</li>
							);
						})}
					</ol>
				</nav>
				<section
					className="flex min-w-0 flex-col gap-6"
					aria-label={STEPS[index].title}
				>
					<h2 className="m-0 text-xl font-semibold">{STEPS[index].title}</h2>
					{step === "basics" && (
						<div className="flex max-w-2xl flex-col gap-4">
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="image-name">Name</Label>
								<Input id="image-name" value={image.name} disabled />
								<span className="text-xs text-content-secondary">
									Templates use it as{" "}
									<code>
										{list.data?.pullPrefix ?? "localhost:5000"}/coder-images/
										{image.name}:&lt;version&gt;
									</code>
									; it can't change.
								</span>
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="image-description">Description</Label>
								<Textarea
									id="image-description"
									rows={3}
									value={description}
									onChange={(e) => setDescription(e.target.value)}
								/>
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="image-base">Starts from</Label>
								<select
									id="image-base"
									value={
										spec.base.kind === "image" ? spec.base.id : "workspace"
									}
									onChange={(e) =>
										setSpec({
											...spec,
											base:
												e.target.value === "workspace"
													? { kind: "workspace" }
													: { kind: "image", id: e.target.value },
										})
									}
									className="h-10 rounded-md border border-solid border-border bg-surface-primary px-3 text-sm text-content-primary"
								>
									<option value="workspace">
										The workspace image (
										{list.data?.baseImage ?? "coder-workspace"})
									</option>
									{bases.map((i) => (
										<option key={i.id} value={i.id}>
											{i.name} (v{i.version}, built {i.builtAt?.slice(0, 10)})
										</option>
									))}
									{spec.base.kind === "image" &&
										!bases.some(
											(i) =>
												spec.base.kind === "image" && i.id === spec.base.id,
										) && (
											<option value={spec.base.id}>
												{spec.base.id} (not built)
											</option>
										)}
								</select>
								<span className="text-xs text-content-secondary">
									Another built image is taken at its latest version when this
									one is built.
								</span>
							</div>
						</div>
					)}
					{step === "packages" && (
						<PackagesStep
							{...stepProps}
							onAddInstallation={onAddInstallation}
						/>
					)}
					{step === "installations" && (
						<InstallationsStep {...stepProps} openId={openInstall} />
					)}
					{step === "harden" && (
						<HardenStep
							{...stepProps}
							labels={settings.data?.hardening ?? {}}
						/>
					)}
					{step === "desktop" && <DesktopStep {...stepProps} />}
					{step === "config" && <ConfigStep {...stepProps} />}
					{step === "review" && (
						<ReviewStep
							{...stepProps}
							problems={problems}
							dockerfile={preview.data?.dockerfile}
							plan={preview.data?.steps}
							labels={settings.data?.hardening ?? {}}
						/>
					)}
					<footer className="flex items-center gap-2 border-0 border-t border-solid border-border pt-4">
						{index > 0 && (
							<Button
								variant="outline"
								onClick={() => setStep(STEPS[index - 1].key)}
							>
								<ArrowLeftIcon />
								{STEPS[index - 1].title}
							</Button>
						)}
						<span className="flex-1" />
						{blocked && (
							<span className="text-sm text-content-destructive" role="status">
								{(problemsByStep[step] ?? [])[0]}
							</span>
						)}
						{index < STEPS.length - 1 ? (
							<Button
								onClick={() => setStep(STEPS[index + 1].key)}
								disabled={blocked}
								data-testid="next-step"
							>
								{STEPS[index + 1].title}
								<ArrowRightIcon />
							</Button>
						) : (
							<Button
								onClick={() => build.mutate()}
								disabled={
									problems.length > 0 ||
									build.isPending ||
									Boolean(image.activeBuild)
								}
							>
								<Spinner loading={build.isPending}>
									<HammerIcon />
								</Spinner>
								Build v{image.version + 1}
							</Button>
						)}
					</footer>
				</section>
			</div>
		</Margins>
	);
};

export default ImageEditorPage;
