/**
 * "/dev/mouse" at the banner terminal's prompt: the mouse pointer becomes sparks (codepen-effect-sparks.html, Nik
 * Rowell's pen, MIT) - glowing particles that burst from it, blended additively so where they overlap they glow.
 * Over the page, on a see-through canvas the pointer passes through: the dashboard is used as usual, its own pointer
 * hidden. Any key stops it at once.
 */

/** The class on <html> while the sparks are the pointer: the system pointer hidden (bannerScrollView.css). */
export const SPARKS_CLASS = "platform-sparks-cursor";
const PARTICLES = 100;

type Particle = {
	x: number;
	y: number;
	vx: number;
	vy: number;
	radius: number;
	lifespan: number;
	charge: number;
	r: number;
	g: number;
	b: number;
};

const random = (min: number, max: number) => min + Math.random() * (max - min);

/** The pen's particle: a little apart from where it starts, red to orange, 25 to 50 frames long. */
const particle = (x: number, y: number): Particle => {
	const lifespan = random(25, 50);
	return {
		x: x + random(-10, 10),
		y: y + random(-10, 10),
		vx: random(-2.5, 2.5),
		vy: random(-5, 5),
		radius: Math.random() > 0.75 ? random(25, 50) : 1 + random(1, 20),
		lifespan,
		charge: lifespan,
		r: Math.round(random(0, 255)),
		g: Math.round(random(0, 75)),
		b: Math.round(random(0, 50)),
	};
};

let stopCurrent: (() => void) | null = null;

/** Whether the sparks are the pointer now. */
export const sparksOn = () => stopCurrent !== null;

/** Turns them off (any key does it, too). */
export const stopSparks = () => stopCurrent?.();

/** The sparks become the pointer, until a key is pressed. */
export const startSparks = () => {
	if (stopCurrent) {
		return;
	}
	const canvas = document.createElement("canvas");
	canvas.className = "platform-sparks";
	canvas.setAttribute("aria-hidden", "true");
	canvas.dataset.testid = "sparks-cursor";
	document.body.appendChild(canvas);
	const ctx = canvas.getContext("2d");
	const dpr = Math.min(window.devicePixelRatio || 1, 2);
	let width = 0;
	let height = 0;
	const size = () => {
		width = window.innerWidth;
		height = window.innerHeight;
		canvas.width = Math.round(width * dpr);
		canvas.height = Math.round(height * dpr);
	};
	size();
	// where the pointer is; the centre of the window until it moves
	let mouse: { x: number; y: number } | null = null;
	const at = () => mouse ?? { x: width / 2, y: height / 2 };
	const particles = Array.from({ length: PARTICLES }, () =>
		particle(at().x, at().y),
	);

	let frame = 0;
	const draw = () => {
		if (ctx) {
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			// the pen paints the window black each frame; here it is cleared: the page shows through
			ctx.globalCompositeOperation = "source-over";
			ctx.clearRect(0, 0, width, height);
			ctx.globalCompositeOperation = "lighter";
			for (let i = particles.length - 1; i >= 0; i--) {
				const p = particles[i];
				const opacity = Math.round((p.charge / p.lifespan) * 100) / 100;
				if (p.radius > 0) {
					const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius);
					const rgb = `${p.r}, ${p.g}, ${p.b}`;
					g.addColorStop(0, `rgba(${rgb}, ${opacity})`);
					g.addColorStop(0.5, `rgba(${rgb}, ${opacity})`);
					g.addColorStop(1, `rgba(${rgb}, 0)`);
					ctx.fillStyle = g;
					ctx.beginPath();
					ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
					ctx.fill();
				}
				p.charge--;
				p.radius--;
				p.x += p.vx;
				p.y += p.vy;
				if (p.charge < 0 || p.radius < 0) {
					particles[i] = particle(at().x, at().y);
				}
			}
		}
		frame = requestAnimationFrame(draw);
	};

	const onMove = (e: PointerEvent) => {
		mouse = { x: e.clientX, y: e.clientY };
	};
	const onKey = () => stop();
	const stop = () => {
		cancelAnimationFrame(frame);
		window.removeEventListener("pointermove", onMove, true);
		window.removeEventListener("keydown", onKey, true);
		window.removeEventListener("resize", size);
		document.documentElement.classList.remove(SPARKS_CLASS);
		canvas.remove();
		stopCurrent = null;
	};
	stopCurrent = stop;

	window.addEventListener("pointermove", onMove, true);
	window.addEventListener("keydown", onKey, true);
	window.addEventListener("resize", size);
	document.documentElement.classList.add(SPARKS_CLASS);
	frame = requestAnimationFrame(draw);
};
