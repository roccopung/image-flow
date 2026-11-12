<script lang="ts">
	import { onMount, tick } from 'svelte';
	import Assets from './Assets.svelte';
	import {
		alignmentGuides,
		CELL,
		contentBounds,
		measure,
		snapRect,
		visibleMidpoint,
		type Line,
		type Rect
	} from './snap.ts';
	import type { Asset, Bridge, CanvasDoc, Item } from './types';

	type Point = { clientX: number; clientY: number };

	let { bridge }: { bridge: Bridge } = $props();

	const MAX_ZOOM = 8;
	const SNAP_SCREEN_PX = 6;
	const DRAG_START_SCREEN_PX = 3;
	const FINE_STEP = 10;
	const FINE_MIN_SCREEN_PX = 8;
	const FINE_FADE_SCREEN_PX = 4;
	const LENS_SCREEN_PX_PER_S = 600;
	const LENS_KEY_STEP = 50;
	const LENS_IMAGE_WIDTH = 1800;
	const ARROWS: Record<string, [number, number]> = {
		ArrowLeft: [-1, 0],
		ArrowRight: [1, 0],
		ArrowUp: [0, -1],
		ArrowDown: [0, 1]
	};
	const LENS_BUTTONS = [
		['ArrowLeft', 'left', '←'],
		['ArrowUp', 'up', '↑'],
		['ArrowDown', 'down', '↓'],
		['ArrowRight', 'right', '→']
	] as const;

	function gridPath(step: number, w: number, h: number) {
		let path = '';
		for (let at = step; at < w; at += step) path += `M${at} 0V${h}`;
		for (let at = step; at < h; at += step) path += `M0 ${at}H${w}`;
		return path;
	}

	let width = $state(1500);
	let height = $state(1500);
	let items = $state<Item[]>([]);
	let assets = $state<Asset[]>([]);
	let canPublish = $state(false);
	let panel = $state<'assets' | 'lens'>('assets');

	let selectedKey = $state<string | null>(null);
	let hoveredKey = $state<string | null>(null);
	let zoom = $state(1);
	let mainWidth = $state(0);
	let mainHeight = $state(0);
	let canvasWidth = $state(0);
	let viewWidth = $state(0);
	let viewHeight = $state(0);
	let lensZoom = $state(6.5);
	let lens = $state.raw({ x: 750, y: 750 });
	let scrollLeft = $state(0);
	let scrollTop = $state(0);
	let snapToGrid = $state(true);
	let snapToObjects = $state(true);
	let altHeld = $state(false);
	let steering = $state<string[]>([]);
	let guides = $state.raw<Line[]>([]);

	const bounds = $derived<Rect>({ x: 0, y: 0, w: width, h: height });
	const minSize = $derived(contentBounds(items));
	const assetsById = $derived(new Map(assets.map((asset) => [asset._id, asset])));
	const cellLines = $derived(gridPath(CELL, width, height));
	const fineLines = $derived(gridPath(FINE_STEP, width, height));
	const baseWidth = $derived(Math.min(mainWidth / 2, (mainHeight * width) / height));
	const scale = $derived(canvasWidth / width);
	const canvasHeight = $derived(height * scale);
	const fineSpacing = $derived(FINE_STEP * scale);
	const fineOpacity = $derived(
		Math.min(Math.max((fineSpacing - FINE_MIN_SCREEN_PX) / FINE_FADE_SCREEN_PX, 0), 1)
	);
	const gridStep = $derived(fineSpacing >= FINE_MIN_SCREEN_PX ? FINE_STEP : CELL);
	const selectedItem = $derived(items.find((item) => item._key === selectedKey));
	const measuredItem = $derived(
		items.find((item) => item._key === hoveredKey && item._key !== selectedKey)
	);
	const segments = $derived(
		altHeld && selectedItem ? measure(selectedItem, measuredItem ?? bounds) : []
	);
	const viewLeft = $derived((scrollLeft - Math.max(0, (viewWidth - canvasWidth) / 2)) / scale);
	const viewTop = $derived((scrollTop - Math.max(0, (viewHeight - canvasHeight) / 2)) / scale);

	let dragging = false;
	let centered = false;
	let frame = 0;
	let lastFrame = 0;
	let scroller: HTMLElement;
	let canvas: HTMLElement;
	let surface: HTMLElement;
	let grab = { offsetX: 0, offsetY: 0, clientX: 0, clientY: 0, moved: false };

	onMount(() => {
		bridge.listAssets().then((list) => (assets = list));
	});

	export function update(doc: CanvasDoc, publishable: boolean) {
		canPublish = publishable;
		if (dragging) return;
		width = doc.width ?? 1500;
		height = doc.height ?? 1500;
		items = doc.items ?? [];
		if (!centered) lens = { x: width / 2, y: height / 2 };
		centered = true;
		if (selectedKey && !items.some((item) => item._key === selectedKey)) selectedKey = null;
	}

	const pctX = (value: number) => `${(value / width) * 100}%`;
	const pctY = (value: number) => `${(value / height) * 100}%`;
	const lineKey = ({ x1, y1, x2, y2 }: Line) => `${x1} ${y1} ${x2} ${y2}`;
	const itemPath = (item: Item) => `items[_key=="${item._key}"]`;

	function src(item: Item, screenWidth: number) {
		const asset = assetsById.get(item.image.asset._ref);
		if (!asset) return undefined;
		const bucket = 2 ** Math.ceil(Math.log2(Math.max(screenWidth * devicePixelRatio, 64)));
		return `${asset.url}?w=${Math.min(bucket, 2048)}&auto=format`;
	}

	function lensSrc(item: Item) {
		const asset = assetsById.get(item.image.asset._ref);
		const w = LENS_IMAGE_WIDTH * Math.min(Math.ceil(devicePixelRatio), 2);
		return asset && `${asset.url}?w=${w}&fit=max&auto=format`;
	}

	function toCanvas({ clientX, clientY }: Point) {
		const rect = canvas.getBoundingClientRect();
		return {
			x: ((clientX - rect.left) / rect.width) * width,
			y: ((clientY - rect.top) / rect.height) * height
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
			SNAP_SCREEN_PX / scale,
			bounds
		);
	}

	function savePosition(item: Item) {
		bridge.patch([{ set: { [`${itemPath(item)}.x`]: item.x, [`${itemPath(item)}.y`]: item.y } }]);
	}

	async function zoomTo(next: number, anchor = scrollerCenter()) {
		const rect = scroller.getBoundingClientRect();
		const point = toCanvas(anchor);
		zoom = Math.min(Math.max(next, 1), MAX_ZOOM);
		await tick();
		scroller.scrollLeft =
			(point.x / width) * canvas.offsetWidth + canvas.offsetLeft - (anchor.clientX - rect.left);
		scroller.scrollTop =
			(point.y / height) * canvas.offsetHeight + canvas.offsetTop - (anchor.clientY - rect.top);
	}

	function moveLens(dx: number, dy: number) {
		lens = {
			x: Math.min(Math.max(lens.x + dx, 0), width),
			y: Math.min(Math.max(lens.y + dy, 0), height)
		};
	}

	function glide(now: number) {
		const distance = (LENS_SCREEN_PX_PER_S * (now - lastFrame)) / 1000 / lensZoom;
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
			? steering.includes(key) ? steering : [...steering, key]
			: steering.filter((other) => other !== key);
		if (steering.length && !frame) {
			lastFrame = performance.now();
			frame = requestAnimationFrame(glide);
		}
	}

	function onWindowKey(event: KeyboardEvent) {
		syncAlt(event);
		const typing = event.target instanceof HTMLInputElement;
		if (panel !== 'lens' || !ARROWS[event.key] || event.defaultPrevented || typing) return;
		event.preventDefault();
		steer(event.key, event.type === 'keydown');
	}

	function onScroll() {
		scrollLeft = scroller.scrollLeft;
		scrollTop = scroller.scrollTop;
	}

	function pinch(event: WheelEvent) {
		if (!event.ctrlKey) return;
		event.preventDefault();
		zoomTo(zoom * Math.exp(-event.deltaY * 0.01), event);
	}

	function onDragOver(event: DragEvent) {
		if (event.dataTransfer?.types.includes('application/x-asset')) event.preventDefault();
	}

	function onDrop(event: DragEvent) {
		const asset = assetsById.get(event.dataTransfer?.getData('application/x-asset') ?? '');
		if (!asset) return;
		event.preventDefault();
		const target = toCanvas(event);
		const ratio = asset.width / asset.height || 1;
		const w = Math.max(1, Math.round(CELL * Math.min(1, ratio)));
		const h = Math.max(1, Math.round(CELL * Math.min(1, 1 / ratio)));
		const item: Item = {
			_key: crypto.randomUUID().replaceAll('-', '').slice(0, 12),
			_type: 'canvasItem',
			image: { _type: 'image', asset: { _type: 'reference', _ref: asset._id } },
			w,
			h,
			...snap({ x: target.x - w / 2, y: target.y - h / 2, w, h }, items)
		};
		items.push(item);
		selectedKey = item._key;
		bridge.patch([{ setIfMissing: { items: [] } }, { insert: { after: 'items[-1]', items: [item] } }]);
	}

	function remove(item: Item) {
		items = items.filter((other) => other._key !== item._key);
		selectedKey = null;
		bridge.patch([{ unset: [itemPath(item)] }]);
		surface.focus({ preventScroll: true });
	}

	function resize(axis: 'width' | 'height', input: HTMLInputElement) {
		const min = Math.max(CELL, axis === 'width' ? minSize.w : minSize.h);
		const value = Math.max(min, Math.round(input.valueAsNumber) || min);
		input.value = String(value);
		if (axis === 'width') width = value;
		else height = value;
		bridge.patch([{ set: { [axis]: value } }]);
	}

	function startDrag(event: PointerEvent & { currentTarget: HTMLElement }, item: Item) {
		if (event.button !== 0) return;
		selectedKey = item._key;
		dragging = true;
		event.currentTarget.focus({ preventScroll: true });
		event.currentTarget.setPointerCapture(event.pointerId);
		const point = toCanvas(event);
		grab = {
			offsetX: point.x - item.x,
			offsetY: point.y - item.y,
			clientX: event.clientX,
			clientY: event.clientY,
			moved: false
		};
	}

	function drag(event: PointerEvent & { currentTarget: HTMLElement }, item: Item) {
		if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
		grab.moved ||=
			Math.hypot(event.clientX - grab.clientX, event.clientY - grab.clientY) >=
			DRAG_START_SCREEN_PX;
		if (!grab.moved) return;

		const point = toCanvas(event);
		const others = items.filter((other) => other._key !== item._key);
		const position = snap(
			{ x: point.x - grab.offsetX, y: point.y - grab.offsetY, w: item.w, h: item.h },
			others
		);
		item.x = position.x;
		item.y = position.y;
		guides = snapToObjects ? alignmentGuides(item, others) : [];
	}

	function endDrag(item: Item) {
		dragging = false;
		guides = [];
		if (grab.moved) savePosition(item);
		grab.moved = false;
	}

	function onItemKey(event: KeyboardEvent, item: Item) {
		if (selectedKey !== item._key) return;
		const arrow = ARROWS[event.key];
		if (arrow) {
			event.preventDefault();
			const step = event.shiftKey ? 10 : 1;
			item.x = Math.min(Math.max(item.x + arrow[0] * step, 0), width - item.w);
			item.y = Math.min(Math.max(item.y + arrow[1] * step, 0), height - item.h);
			savePosition(item);
		} else if (event.key === 'Delete' || event.key === 'Backspace') {
			remove(item);
		} else if (event.key === 'Escape') {
			selectedKey = null;
		}
	}

	function syncAlt(event: KeyboardEvent | PointerEvent) {
		altHeld = event.altKey;
	}
</script>

<svelte:window
	onkeydown={onWindowKey}
	onkeyup={onWindowKey}
	onpointermove={syncAlt}
	onblur={() => {
		altHeld = false;
		steering = [];
	}}
/>

<main bind:clientWidth={mainWidth} bind:clientHeight={mainHeight}>
	<div
		class="scroller"
		role="group"
		aria-label="Canvas"
		bind:this={scroller}
		bind:clientWidth={viewWidth}
		bind:clientHeight={viewHeight}
		onwheel={pinch}
		onscroll={onScroll}
		ondragover={onDragOver}
		ondrop={onDrop}
	>
		<div
			class="canvas"
			bind:this={canvas}
			bind:clientWidth={canvasWidth}
			style:width="{baseWidth * zoom}px"
			style:aspect-ratio="{width} / {height}"
		>
			<svg class="layer" viewBox="0 0 {width} {height}" aria-hidden="true">
				<path class="cell-lines" d={cellLines} />
				{#if fineOpacity > 0}
					<path class="fine-lines" d={fineLines} opacity={fineOpacity} />
				{/if}
			</svg>

			<button
				class="surface"
				aria-label="Deselect image"
				bind:this={surface}
				onclick={() => (selectedKey = null)}
			></button>

			{#each items as item (item._key)}
				{@const selected = selectedKey === item._key}
				{@const url = src(item, item.w * scale)}
				<div
					class={['image', { selected, measured: altHeld && measuredItem?._key === item._key }]}
					style:left={pctX(item.x)}
					style:top={pctY(item.y)}
					style:width={pctX(item.w)}
					style:height={pctY(item.h)}
				>
					<button
						class="grab"
						aria-pressed={selected}
						onpointerdown={(event) => startDrag(event, item)}
						onpointermove={(event) => drag(event, item)}
						onpointerup={() => endDrag(item)}
						onpointercancel={() => endDrag(item)}
						onpointerenter={() => (hoveredKey = item._key)}
						onpointerleave={() => (hoveredKey = null)}
						onclick={() => (selectedKey = item._key)}
						onkeydown={(event) => onItemKey(event, item)}
					>
						{#if url}
							<img src={url} alt="" />
						{:else}
							<span class="missing">Missing asset</span>
						{/if}
					</button>
					{#if selected}
						<button class="delete" aria-label="Delete image" onclick={() => remove(item)}>
							<svg viewBox="0 0 10 10" aria-hidden="true">
								<path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" />
							</svg>
						</button>
					{/if}
				</div>
			{/each}

			<svg class="layer overlay" viewBox="0 0 {width} {height}" aria-hidden="true">
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
					style:left={pctX(
						visibleMidpoint(segment.x1, segment.x2, viewLeft, viewLeft + viewWidth / scale)
					)}
					style:top={pctY(
						visibleMidpoint(segment.y1, segment.y2, viewTop, viewTop + viewHeight / scale)
					)}>{segment.px}</span
				>
			{/each}

			{#if panel === 'lens'}
				<span class="lens-dot" style:left={pctX(lens.x)} style:top={pctY(lens.y)}></span>
			{/if}
		</div>
	</div>

	<div class="side">
		<div class="tabs">
			<button aria-pressed={panel === 'assets'} onclick={() => (panel = 'assets')}>Assets</button>
			<button aria-pressed={panel === 'lens'} onclick={() => (panel = 'lens')}>Lens</button>
		</div>
		{#if panel === 'assets'}
			<Assets {assets} />
		{:else}
			<div class="lens">
				<div
					class="lens-world"
					aria-hidden="true"
					style:width="{width * lensZoom}px"
					style:height="{height * lensZoom}px"
					style:transform="translate({Math.round(-lens.x * lensZoom)}px, {Math.round(
						-lens.y * lensZoom
					)}px)"
				>
					{#each items as item (item._key)}
						<img
							src={lensSrc(item)}
							alt=""
							loading="lazy"
							style:left={pctX(item.x)}
							style:top={pctY(item.y)}
							style:width={pctX(item.w)}
							style:height={pctY(item.h)}
							style:z-index={selectedKey === item._key ? 1 : 0}
						/>
					{/each}
				</div>
				<svg class="lens-mark" width="33" height="33" fill="none" aria-hidden="true">
					<path d="M16.5 4v25M4 16.5h25" stroke="#fff" stroke-width="3" />
					<path d="M16.5 4v25M4 16.5h25" stroke="#000" />
				</svg>
				<div class="joystick">
					{#each LENS_BUTTONS as [key, label, glyph] (key)}
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
		{/if}
	</div>

	<div class="zoom-level">Zoom {Math.round(zoom * 100)}%</div>

	<details class="controls">
		<summary>Controls</summary>
		<div class="panel">
			<button class="publish" disabled={!canPublish} onclick={() => bridge.publish()}>
				{canPublish ? 'Publish' : 'Published'}
			</button>
			<div class="size">
				<label>
					W
					<input
						type="number"
						min={Math.max(CELL, minSize.w)}
						value={width}
						onchange={(event) => resize('width', event.currentTarget)}
					/>
				</label>
				<label>
					H
					<input
						type="number"
						min={Math.max(CELL, minSize.h)}
						value={height}
						onchange={(event) => resize('height', event.currentTarget)}
					/>
				</label>
			</div>
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
			<p>Drag images from Assets onto the canvas.</p>
			<p>Select an image, then hold <kbd>Alt</kbd> and point at another to measure.</p>
			<p><kbd>Arrows</kbd> nudge the selected image 1px, with <kbd>Shift</kbd> 10px.</p>
			<p>In Lens, <kbd>Arrows</kbd> move the view.</p>
		</div>
	</details>
</main>

<style>
	main {
		position: relative;
		display: flex;
		height: 100%;
		background: #dfdfdf;
		color: #000;
		font: 13px Arial, sans-serif;
	}

	main :global(:focus-visible) {
		outline: 1px solid #000;
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

	input[type='number'] {
		width: 100%;
		min-width: 0;
		padding: 0.25rem;
		border: 1px solid #000;
		background: #fff;
		font: inherit;
		cursor: text;
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
		position: absolute;
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

	.size {
		display: flex;
		gap: 0.5rem;
	}

	.publish,
	.tabs button {
		padding: 0.25rem 0.75rem;
		border: 1px solid #000;
		border-radius: 0;
		background: #dfdfdf;
		color: #000;
		font: inherit;
		cursor: pointer;
	}

	.publish:not(:disabled),
	.tabs button[aria-pressed='true'] {
		background: #000;
		color: #fff;
	}

	.publish:disabled {
		cursor: default;
		opacity: 0.5;
	}

	.side {
		position: relative;
		flex: 1;
		min-width: 0;
		border-left: 1px solid #000;
	}

	.tabs {
		position: absolute;
		top: 0.75rem;
		right: 0.75rem;
		z-index: 2;
		display: flex;
	}

	.tabs button + button {
		border-left: 0;
	}

	.lens {
		position: relative;
		height: 100%;
		overflow: hidden;
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

	.lens-dot {
		position: absolute;
		z-index: 3;
		width: 2px;
		height: 2px;
		border-radius: 50%;
		background: red;
		transform: translate(-50%, -50%);
		pointer-events: none;
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
		position: absolute;
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

	.missing {
		display: grid;
		place-items: center;
		height: 100%;
		background: #efefef;
		font-size: 10px;
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
