<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const LENS_ZOOM = 6.5;
	const LENS_SCREEN_PX_PER_S = 600;
	const LENS_KEY_STEP = 50;
	const LENS_IMAGE_WIDTH = 1800;
	const ARROWS: Record<string, [number, number]> = {
		ArrowLeft: [-1, 0],
		ArrowRight: [1, 0],
		ArrowUp: [0, -1],
		ArrowDown: [0, 1]
	};
	const BUTTONS = [
		['ArrowLeft', 'left', '←'],
		['ArrowUp', 'up', '↑'],
		['ArrowDown', 'down', '↓'],
		['ArrowRight', 'right', '→']
	] as const;

	const width = $derived(data.width);
	const height = $derived(data.height);

	let mapWidth = $state(0);
	let lens = $derived({ x: width / 2, y: height / 2 });
	let steering = $state<string[]>([]);
	let dpr = $state(1);
	let frame = 0;
	let lastFrame = 0;

	const scale = $derived(mapWidth / width);
	const retina = $derived(Math.min(Math.ceil(dpr), 2));

	const pctX = (value: number) => `${(value / width) * 100}%`;
	const pctY = (value: number) => `${(value / height) * 100}%`;

	function thumb(url: string, screenWidth: number) {
		const bucket = 2 ** Math.ceil(Math.log2(Math.max(screenWidth * retina, 64)));
		return `${url}?w=${Math.min(bucket, 2048)}&fit=max&auto=format`;
	}

	function moveLens(dx: number, dy: number) {
		lens = {
			x: Math.min(Math.max(lens.x + dx, 0), width),
			y: Math.min(Math.max(lens.y + dy, 0), height)
		};
	}

	function glide(now: number) {
		const distance = (LENS_SCREEN_PX_PER_S * (now - lastFrame)) / 1000 / LENS_ZOOM;
		lastFrame = now;
		const [dx, dy] = steering.reduce(
			([x, y], key) => [x + ARROWS[key][0], y + ARROWS[key][1]],
			[0, 0]
		);
		moveLens(dx * distance, dy * distance);
		frame = steering.length ? requestAnimationFrame(glide) : 0;
	}

	function steer(key: string, on: boolean) {
		steering = on
			? steering.includes(key)
				? steering
				: [...steering, key]
			: steering.filter((other) => other !== key);
		if (steering.length && !frame) {
			lastFrame = performance.now();
			frame = requestAnimationFrame(glide);
		}
	}

	function jump(event: MouseEvent & { currentTarget: HTMLElement }) {
		const rect = event.currentTarget.getBoundingClientRect();
		lens = {
			x: ((event.clientX - rect.left) / rect.width) * width,
			y: ((event.clientY - rect.top) / rect.height) * height
		};
	}

	function onKey(event: KeyboardEvent) {
		if (!ARROWS[event.key]) return;
		event.preventDefault();
		steer(event.key, event.type === 'keydown');
	}
</script>

<svelte:window
	bind:devicePixelRatio={dpr}
	onkeydown={onKey}
	onkeyup={onKey}
	onblur={() => (steering = [])}
/>

<main>
	<div class="map">
		<div
			class="canvas"
			role="presentation"
			onclick={jump}
			bind:clientWidth={mapWidth}
			style:aspect-ratio="{width} / {height}"
			style:width="min(100%, calc(100dvh * {width} / {height}))"
		>
			{#each data.items as item (item._key)}
				<img
					src={thumb(item.url, item.w * scale)}
					alt=""
					style:left={pctX(item.x)}
					style:top={pctY(item.y)}
					style:width={pctX(item.w)}
					style:height={pctY(item.h)}
				/>
			{/each}
			<svg
				class="cross"
				width="10"
				height="10"
				aria-hidden="true"
				style:left={pctX(lens.x)}
				style:top={pctY(lens.y)}
			>
				<path d="M5 0v10M0 5h10" stroke="red" shape-rendering="crispEdges" />
			</svg>
		</div>
	</div>

	<div class="lens">
		<div
			class="lens-world"
			aria-hidden="true"
			style:width="{width * LENS_ZOOM}px"
			style:height="{height * LENS_ZOOM}px"
			style:transform="translate({Math.round(-lens.x * LENS_ZOOM)}px, {Math.round(
				-lens.y * LENS_ZOOM
			)}px)"
		>
			{#each data.items as item (item._key)}
				<img
					src="{item.url}?w={LENS_IMAGE_WIDTH * retina}&fit=max&auto=format"
					alt=""
					loading="lazy"
					style:left={pctX(item.x)}
					style:top={pctY(item.y)}
					style:width={pctX(item.w)}
					style:height={pctY(item.h)}
				/>
			{/each}
		</div>
		<div class="joystick">
			{#each BUTTONS as [key, label, glyph] (key)}
				<button
					aria-label="Move {label}"
					aria-pressed={steering.includes(key)}
					onpointerdown={(event) => {
						event.currentTarget.setPointerCapture(event.pointerId);
						steer(key, true);
					}}
					onpointerup={() => steer(key, false)}
					onpointercancel={() => steer(key, false)}
					onclick={(event) => {
						if (event.detail === 0)
							moveLens(ARROWS[key][0] * LENS_KEY_STEP, ARROWS[key][1] * LENS_KEY_STEP);
					}}>{glyph}</button
				>
			{/each}
		</div>
	</div>
</main>

<style>
	:global(body) {
		margin: 0;
		background: #dfdfdf;
	}

	:global(:focus-visible) {
		outline: 1px solid #000;
	}

	main {
		display: flex;
		height: 100dvh;
		color: #000;
		font: 13px Arial, sans-serif;
	}

	.map {
		display: grid;
		place-items: center;
		width: 50%;
		overflow: hidden;
	}

	.canvas {
		position: relative;
		overflow: clip;
		background: #fff;
		cursor: crosshair;
	}

	.canvas img,
	.lens-world img {
		position: absolute;
		display: block;
		object-fit: contain;
	}

	.cross {
		position: absolute;
		transform: translate(-50%, -50%);
	}

	.lens {
		position: relative;
		flex: 1;
		overflow: hidden;
		border-left: 1px solid #000;
	}

	.lens-world {
		position: absolute;
		top: 50%;
		left: 50%;
		background: #efefef;
	}


	.joystick {
		position: absolute;
		bottom: 0.75rem;
		left: 50%;
		display: flex;
		transform: translateX(-50%);
	}

	.joystick button {
		width: 24px;
		height: 24px;
		padding: 0;
		border: 1px solid #000;
		border-radius: 0;
		background: #dfdfdf;
		color: #000;
		font: inherit;
		cursor: pointer;
		touch-action: none;
	}

	.joystick button + button {
		border-left: 0;
	}

	.joystick button[aria-pressed='true'] {
		background: #000;
		color: #fff;
	}
</style>
