<script lang="ts">
	import { tick } from 'svelte';
	import {
		alignmentGuides,
		CANVAS,
		CANVAS_RECT,
		CELL,
		measure,
		snapRect,
		visibleMidpoint,
		type Line,
		type Rect
	} from '#lib/snap.ts';

	type PlacedImage = Rect & { id: string; src: string; alt: string };
	type Point = { clientX: number; clientY: number };

	const MAX_ZOOM = 8;
	const SNAP_SCREEN_PX = 6;
	const DRAG_START_SCREEN_PX = 3;
	const FINE_STEP = 10;
	const FINE_MIN_SCREEN_PX = 8;
	const FINE_FADE_SCREEN_PX = 4;
	const ARROWS: Record<string, [number, number]> = {
		ArrowLeft: [-1, 0],
		ArrowRight: [1, 0],
		ArrowUp: [0, -1],
		ArrowDown: [0, 1]
	};

	function gridPath(step: number) {
		let path = '';
		for (let at = step; at < CANVAS; at += step) {
			path += `M${at} 0V${CANVAS}M0 ${at}H${CANVAS}`;
		}
		return path;
	}
	const CELL_LINES = gridPath(CELL);
	const FINE_LINES = gridPath(FINE_STEP);

	let images = $state<PlacedImage[]>([]);
	let selectedId = $state<string | null>(null);
	let hoveredId = $state<string | null>(null);
	let zoom = $state(1);
	let canvasWidth = $state(0);
	let viewWidth = $state(0);
	let viewHeight = $state(0);
	let lensZoom = $state(4);
	let lens = $state.raw({ x: CANVAS / 2, y: CANVAS / 2 });
	let scrollLeft = $state(0);
	let scrollTop = $state(0);
	let snapToGrid = $state(true);
	let snapToObjects = $state(true);
	let altHeld = $state(false);
	let guides = $state.raw<Line[]>([]);

	const scale = $derived(canvasWidth / CANVAS);
	const fineSpacing = $derived(FINE_STEP * scale);
	const fineOpacity = $derived(
		Math.min(Math.max((fineSpacing - FINE_MIN_SCREEN_PX) / FINE_FADE_SCREEN_PX, 0), 1)
	);
	const gridStep = $derived(fineSpacing >= FINE_MIN_SCREEN_PX ? FINE_STEP : CELL);
	const selectedImage = $derived(images.find((image) => image.id === selectedId));
	const measuredImage = $derived(
		images.find((image) => image.id === hoveredId && image.id !== selectedId)
	);
	const segments = $derived(
		altHeld && selectedImage ? measure(selectedImage, measuredImage ?? CANVAS_RECT) : []
	);

	const viewLeft = $derived((scrollLeft - Math.max(0, (viewWidth - canvasWidth) / 2)) / scale);
	const viewTop = $derived((scrollTop - Math.max(0, (viewHeight - canvasWidth) / 2)) / scale);

	let pointer: Point = { clientX: 0, clientY: 0 };
	let hovering = false;
	let scroller: HTMLElement;
	let canvas: HTMLElement;
	let surface: HTMLElement;
	let picker: HTMLInputElement;
	let target = { x: 0, y: 0 };
	let grab = { offsetX: 0, offsetY: 0, clientX: 0, clientY: 0, moved: false };

	const pct = (value: number) => `${(value / CANVAS) * 100}%`;
	const lineKey = ({ x1, y1, x2, y2 }: Line) => `${x1} ${y1} ${x2} ${y2}`;

	function toCanvas({ clientX, clientY }: Point) {
		const rect = canvas.getBoundingClientRect();
		return {
			x: ((clientX - rect.left) / rect.width) * CANVAS,
			y: ((clientY - rect.top) / rect.height) * CANVAS
		};
	}

	function scrollerCenter(): Point {
		const rect = scroller.getBoundingClientRect();
		return { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
	}

	function snap(rect: Rect, others: Rect[]) {
		return snapRect(
			rect,
			snapToObjects ? others : [],
			snapToGrid ? gridStep : null,
			SNAP_SCREEN_PX / scale
		);
	}

	async function zoomTo(next: number, anchor = scrollerCenter()) {
		const rect = scroller.getBoundingClientRect();
		const point = toCanvas(anchor);
		zoom = Math.min(Math.max(next, 1), MAX_ZOOM);
		await tick();
		scroller.scrollLeft =
			(point.x / CANVAS) * canvas.offsetWidth + canvas.offsetLeft - (anchor.clientX - rect.left);
		scroller.scrollTop =
			(point.y / CANVAS) * canvas.offsetHeight + canvas.offsetTop - (anchor.clientY - rect.top);
	}

	function updateLens() {
		const point = toCanvas(pointer);
		lens = {
			x: Math.min(Math.max(point.x, 0), CANVAS),
			y: Math.min(Math.max(point.y, 0), CANVAS)
		};
	}

	function onPointerMove(event: PointerEvent) {
		pointer = event;
		hovering = true;
		updateLens();
	}

	function onScroll() {
		scrollLeft = scroller.scrollLeft;
		scrollTop = scroller.scrollTop;
		if (hovering) updateLens();
	}

	function pinch(event: WheelEvent) {
		if (!event.ctrlKey) return;
		event.preventDefault();
		zoomTo(zoom * Math.exp(-event.deltaY * 0.01), event);
	}

	function onSurfaceClick(event: MouseEvent) {
		if (selectedId) {
			selectedId = null;
			return;
		}
		target = toCanvas(event.detail ? event : scrollerCenter());
		picker.click();
	}

	async function place() {
		const file = picker.files?.[0];
		picker.value = '';
		if (!file?.type.startsWith('image/')) return;

		const src = URL.createObjectURL(file);
		const probe = new Image();
		probe.src = src;
		try {
			await probe.decode();
		} catch {
			URL.revokeObjectURL(src);
			return;
		}

		const ratio = probe.naturalWidth / probe.naturalHeight || 1;
		const w = Math.max(1, Math.round(CELL * Math.min(1, ratio)));
		const h = Math.max(1, Math.round(CELL * Math.min(1, 1 / ratio)));
		const position = snap({ x: target.x - w / 2, y: target.y - h / 2, w, h }, images);
		images.push({ id: crypto.randomUUID(), src, alt: file.name, w, h, ...position });
	}

	function remove(image: PlacedImage) {
		URL.revokeObjectURL(image.src);
		images = images.filter((other) => other.id !== image.id);
		selectedId = null;
		surface.focus({ preventScroll: true });
	}

	function startDrag(event: PointerEvent & { currentTarget: HTMLElement }, image: PlacedImage) {
		if (event.button !== 0) return;
		selectedId = image.id;
		event.currentTarget.focus({ preventScroll: true });
		event.currentTarget.setPointerCapture(event.pointerId);
		const point = toCanvas(event);
		grab = {
			offsetX: point.x - image.x,
			offsetY: point.y - image.y,
			clientX: event.clientX,
			clientY: event.clientY,
			moved: false
		};
	}

	function drag(event: PointerEvent & { currentTarget: HTMLElement }, image: PlacedImage) {
		if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
		grab.moved ||=
			Math.hypot(event.clientX - grab.clientX, event.clientY - grab.clientY) >=
			DRAG_START_SCREEN_PX;
		if (!grab.moved) return;

		const point = toCanvas(event);
		const others = images.filter((other) => other.id !== image.id);
		const position = snap(
			{ x: point.x - grab.offsetX, y: point.y - grab.offsetY, w: image.w, h: image.h },
			others
		);
		image.x = position.x;
		image.y = position.y;
		guides = snapToObjects ? alignmentGuides(image, others) : [];
	}

	function onImageKey(event: KeyboardEvent, image: PlacedImage) {
		if (selectedId !== image.id) return;
		const arrow = ARROWS[event.key];
		if (arrow) {
			event.preventDefault();
			const step = event.shiftKey ? 10 : 1;
			image.x = Math.min(Math.max(image.x + arrow[0] * step, 0), CANVAS - image.w);
			image.y = Math.min(Math.max(image.y + arrow[1] * step, 0), CANVAS - image.h);
		} else if (event.key === 'Delete' || event.key === 'Backspace') {
			remove(image);
		} else if (event.key === 'Escape') {
			selectedId = null;
		}
	}

	function syncAlt(event: KeyboardEvent | PointerEvent) {
		altHeld = event.altKey;
	}
</script>

<svelte:window
	onkeydown={syncAlt}
	onkeyup={syncAlt}
	onpointermove={syncAlt}
	onblur={() => (altHeld = false)}
/>

<main>
	<div
		class="scroller"
		role="group"
		aria-label="Canvas"
		bind:this={scroller}
		bind:clientWidth={viewWidth}
		bind:clientHeight={viewHeight}
		onwheel={pinch}
		onscroll={onScroll}
		onpointermove={onPointerMove}
		onpointerleave={() => (hovering = false)}
	>
		<div
			class="canvas"
			bind:this={canvas}
			bind:clientWidth={canvasWidth}
			style:width="calc(min(50vw, 100dvh) * {zoom})"
		>
			<svg class="layer" viewBox="0 0 {CANVAS} {CANVAS}" aria-hidden="true">
				<path class="cell-lines" d={CELL_LINES} />
				{#if fineOpacity > 0}
					<path class="fine-lines" d={FINE_LINES} opacity={fineOpacity} />
				{/if}
			</svg>

			<button
				class={['surface', { adding: !selectedId }]}
				aria-label={selectedId ? 'Deselect image' : 'Add an image here'}
				bind:this={surface}
				onclick={onSurfaceClick}
			></button>

			{#each images as image (image.id)}
				{@const selected = selectedId === image.id}
				<div
					class={['image', { selected, measured: altHeld && measuredImage?.id === image.id }]}
					style:left={pct(image.x)}
					style:top={pct(image.y)}
					style:width={pct(image.w)}
					style:height={pct(image.h)}
				>
					<button
						class="grab"
						aria-pressed={selected}
						onpointerdown={(event) => startDrag(event, image)}
						onpointermove={(event) => drag(event, image)}
						onpointerup={() => (guides = [])}
						onpointercancel={() => (guides = [])}
						onpointerenter={() => (hoveredId = image.id)}
						onpointerleave={() => (hoveredId = null)}
						onclick={() => (selectedId = image.id)}
						onkeydown={(event) => onImageKey(event, image)}
					>
						<img src={image.src} alt={image.alt} />
					</button>
					{#if selected}
						<button class="delete" aria-label="Delete {image.alt}" onclick={() => remove(image)}>
							<svg viewBox="0 0 10 10" aria-hidden="true">
								<path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" />
							</svg>
						</button>
					{/if}
				</div>
			{/each}

			<svg class="layer overlay" viewBox="0 0 {CANVAS} {CANVAS}" aria-hidden="true">
				{#each guides as guide (lineKey(guide))}
					<line class="guide" x1={guide.x1} y1={guide.y1} x2={guide.x2} y2={guide.y2} />
				{/each}
				{#each segments as segment (lineKey(segment))}
					<line
						class="measure"
						x1={segment.x1}
						y1={segment.y1}
						x2={segment.x2}
						y2={segment.y2}
					/>
				{/each}
			</svg>

			{#each segments as segment (lineKey(segment))}
				<span
					class="distance"
					style:left={pct(
						visibleMidpoint(segment.x1, segment.x2, viewLeft, viewLeft + viewWidth / scale)
					)}
					style:top={pct(
						visibleMidpoint(segment.y1, segment.y2, viewTop, viewTop + viewHeight / scale)
					)}>{segment.px}</span
				>
			{/each}		</div>
	</div>

	<div class="lens" aria-hidden="true">
		<div
			class="lens-world"
			style:width="{CANVAS * lensZoom}px"
			style:height="{CANVAS * lensZoom}px"
			style:transform="translate({Math.round(-lens.x * lensZoom)}px, {Math.round(-lens.y * lensZoom)}px)"
		>
			{#each images as image (image.id)}
				<img
					src={image.src}
					alt=""
					style:left={pct(image.x)}
					style:top={pct(image.y)}
					style:width={pct(image.w)}
					style:height={pct(image.h)}
					style:z-index={selectedId === image.id ? 1 : 0}
				/>
			{/each}
		</div>
		<svg class="lens-mark" width="33" height="33" fill="none">
			<path d="M16.5 4v25M4 16.5h25" stroke="#fff" stroke-width="3" />
			<path d="M16.5 4v25M4 16.5h25" stroke="#000" />
		</svg>
	</div>

	<div class="zoom-level">Zoom {Math.round(zoom * 100)}%</div>

	<details class="controls">
		<summary>Controls</summary>
		<div class="panel">
		<label>
			<input type="checkbox" bind:checked={snapToGrid} />
			Snap to grid
		</label>
		<label>
			<input type="checkbox" bind:checked={snapToObjects} />
			Snap to objects
		</label>
		<label class="zoom">
			Zoom {Math.round(zoom * 100)}%
			<input
				type="range"
				min="1"
				max={MAX_ZOOM}
				step="0.1"
				value={zoom}
				oninput={(event) => zoomTo(event.currentTarget.valueAsNumber)}
			/>
		</label>
		<label class="zoom">
			Lens zoom {lensZoom}×
			<input type="range" min="1" max="10" step="0.5" bind:value={lensZoom} />
		</label>
		<p>Select an image, then hold <kbd>Alt</kbd> and point at another to measure.</p>
		<p><kbd>Arrows</kbd> nudge 1px, with <kbd>Shift</kbd> 10px.</p>
		</div>
	</details>

	<input bind:this={picker} type="file" accept="image/*" hidden onchange={place} />
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

	kbd {
		font: inherit;
	}

	input {
		margin: 0;
		appearance: none;
		-webkit-appearance: none;
		border-radius: 0;
		color: #000;
		cursor: pointer;
	}

	input[type='checkbox'] {
		flex: none;
		width: 13px;
		height: 13px;
		border: 1px solid #000;
		background: #fff;
	}

	input[type='checkbox']:checked {
		background: #000;
	}

	input[type='range'] {
		height: 13px;
		background: linear-gradient(#000, #000) center / 100% 1px no-repeat;
	}

	input[type='range']::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 13px;
		height: 13px;
		background: #000;
	}

	input[type='range']::-moz-range-thumb {
		width: 13px;
		height: 13px;
		border: 0;
		border-radius: 0;
		background: #000;
	}

	.controls {
		position: fixed;
		top: 0.75rem;
		left: 0.75rem;
		z-index: 10;
		padding: 0.5rem 0.75rem;
		border: 1px solid #000;
		background: #dfdfdf;
	}

	summary {
		list-style: none;
		cursor: pointer;
	}

	summary::-webkit-details-marker {
		display: none;
	}

	summary::before {
		content: '+ ';
	}

	.controls[open] summary::before {
		content: '− ';
	}

	.panel {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		width: 12rem;
		margin-top: 0.75rem;
	}

	.panel p {
		margin: 0;
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

	.lens-world img {
		position: absolute;
	}

	.lens-mark {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
	}

	label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-variant-numeric: tabular-nums;
	}

	.zoom {
		flex-direction: column;
		align-items: stretch;
		gap: 0.25rem;
	}

	.scroller {
		position: relative;
		display: grid;
		flex: none;
		width: 50%;
		overflow: auto;
		overscroll-behavior: contain;
	}

	.scroller::-webkit-scrollbar {
		width: 5px;
		height: 5px;
	}

	.scroller::-webkit-scrollbar-track,
	.scroller::-webkit-scrollbar-corner {
		background: #dfdfdf;
	}

	.scroller::-webkit-scrollbar-thumb {
		border-radius: 0;
		background: #000;
	}

	@supports not selector(::-webkit-scrollbar) {
		.scroller {
			scrollbar-width: thin;
			scrollbar-color: #000 #dfdfdf;
		}
	}

	.zoom-level {
		position: fixed;
		bottom: 0.75rem;
		left: 0.75rem;
		z-index: 10;
		padding: 0.5rem 0.75rem;
		border: 1px solid #000;
		background: #dfdfdf;
		pointer-events: none;
	}

	.canvas {
		position: relative;
		aspect-ratio: 1;
		margin: auto;
		overflow: clip;
		background: #fff;
	}

	.layer {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}

	.layer path,
	.layer line {
		fill: none;
		stroke-width: 1px;
		vector-effect: non-scaling-stroke;
	}

	.cell-lines {
		stroke: rgb(0 0 0 / 0.14);
		shape-rendering: crispEdges;
	}

	.fine-lines {
		stroke: rgb(0 0 0 / 0.07);
		shape-rendering: crispEdges;
	}

	.overlay {
		z-index: 2;
	}

	.guide,
	.measure {
		stroke: #000;
	}

	.distance {
		position: absolute;
		z-index: 2;
		padding: 0 4px;
		background: #000;
		color: #fff;
		line-height: 16px;
		transform: translate(-50%, -50%);
		pointer-events: none;
	}

	.surface {
		position: absolute;
		inset: 0;
		border: 0;
		background: none;
		outline-offset: -2px;
	}

	.surface.adding {
		cursor:
			url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='33' height='33' fill='none'%3E%3Cpath d='M16.5 4v25M4 16.5h25' stroke='%23fff' stroke-width='3'/%3E%3Cpath d='M16.5 4v25M4 16.5h25' stroke='%23000'/%3E%3C/svg%3E")
				16 16,
			crosshair;
	}

	.image {
		position: absolute;
	}

	.image.selected {
		z-index: 1;
		outline: 2px solid #000;
	}

	.image.measured {
		outline: 1px dashed #000;
	}

	.grab {
		display: block;
		width: 100%;
		height: 100%;
		padding: 0;
		border: 0;
		background: none;
		cursor: grab;
		touch-action: none;
	}

	.grab:active {
		cursor: grabbing;
	}

	img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
		pointer-events: none;
	}

	.delete {
		position: absolute;
		top: 0;
		right: 0;
		width: 24px;
		height: 24px;
		transform: translate(50%, -50%);
		padding: 0;
		border: 0;
		border-radius: 0;
		background: #000;
		color: #fff;
		cursor: pointer;
	}

	.delete svg {
		display: block;
	}
</style>
