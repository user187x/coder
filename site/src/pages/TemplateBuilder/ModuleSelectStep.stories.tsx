import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import type { TemplateBuilderModule } from "#/api/typesGenerated";
import { ModuleSelectStep } from "./ModuleSelectStep";

const baseId = "docker";

function makeModule(
	overrides: Partial<TemplateBuilderModule> &
		Pick<TemplateBuilderModule, "id" | "display_name" | "category">,
): TemplateBuilderModule {
	return {
		description: "",
		icon: "",
		version: "1.0.0",
		compatible_os: ["linux"],
		conflicts_with: [],
		variables: [],
		...overrides,
	};
}

const modules: TemplateBuilderModule[] = [
	{
		id: "code-server",
		display_name: "code-server",
		description: "Run VS Code in the browser.",
		category: "IDE",
		icon: "/icon/code.svg",
	},
	{
		id: "jetbrains-gateway",
		display_name: "JetBrains Gateway",
		description: "Connect JetBrains IDEs to your workspace.",
		category: "IDE",
	},
	{
		id: "git-clone",
		display_name: "Git Clone",
		description: "Clone a git repository on workspace start.",
		category: "Source Control",
	},
	{
		id: "claude-code",
		display_name: "Claude Code",
		description: "Run Claude Code in your workspace.",
		category: "AI",
	},
	{
		id: "jfrog-artifactory",
		display_name: "JFrog Artifactory",
		description: "Configure JFrog Artifactory access.",
		category: "Security",
	},
].map(makeModule);

const meta: Meta<typeof ModuleSelectStep> = {
	title: "pages/TemplateBuilder/ModuleSelectStep",
	component: ModuleSelectStep,
	args: {
		baseId,
		selectedModuleIds: [],
		onChangeModules: fn(),
	},
	parameters: {
		queries: [
			{
				key: ["templateBuilder", "modules", baseId],
				data: { modules },
			},
		],
	},
};

export default meta;
type Story = StoryObj<typeof ModuleSelectStep>;

export const Default: Story = {};

export const Loading: Story = {
	parameters: {
		queries: [],
	},
};
