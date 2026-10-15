/**
 * Pictures baked into the dashboard (site/static/pictures/), so they are there
 * offline from the first install: offered as backgrounds (Customize >
 * Background image) and as the announcement's preset pictures.
 */
export type PrebakedPicture = {
	name: string;
	url: string;
	type: string;
};

export const PREBAKED_BACKGROUNDS: readonly PrebakedPicture[] = [
	{ name: "creeper.gif", url: "/pictures/creeper.gif", type: "image/gif" },
	{
		name: "background.gif",
		url: "/pictures/background.gif",
		type: "image/gif",
	},
];

export const BANNER_PRESET_PICTURES: readonly PrebakedPicture[] = [
	{ name: "usa.gif", url: "/pictures/usa.gif", type: "image/gif" },
	{
		name: "background.gif",
		url: "/pictures/background.gif",
		type: "image/gif",
	},
];
