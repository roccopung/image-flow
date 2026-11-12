export type Rect = { x: number; y: number; w: number; h: number };
export type Line = { x1: number; y1: number; x2: number; y2: number };
export type Segment = Line & { px: number };

export const CELL = 100;

const anchors = (start: number, size: number) => [start, start + size / 2, start + size];

function nearestDelta(values: number[], stops: number[], threshold: number) {
	let best: number | null = null;
	for (const value of values) {
		for (const stop of stops) {
			const delta = stop - value;
			if (Math.abs(delta) <= threshold && (best === null || Math.abs(delta) < Math.abs(best))) {
				best = delta;
			}
		}
	}
	return best;
}

function snapAxis(
	start: number,
	size: number,
	objectStops: number[],
	gridStep: number | null,
	threshold: number,
	max: number
) {
	const edges = [start, start + size];
	const gridStops = gridStep ? edges.map((edge) => Math.round(edge / gridStep) * gridStep) : [];
	const delta =
		nearestDelta(anchors(start, size), objectStops, threshold) ??
		nearestDelta(edges, gridStops, threshold) ??
		0;
	return Math.min(Math.max(Math.round(start + delta), 0), max - size);
}

export function snapRect(
	rect: Rect,
	others: Rect[],
	gridStep: number | null,
	threshold: number,
	bounds: Rect
) {
	const xs = others.flatMap((o) => anchors(o.x, o.w));
	const ys = others.flatMap((o) => anchors(o.y, o.h));
	return {
		x: snapAxis(rect.x, rect.w, xs, gridStep, threshold, bounds.w),
		y: snapAxis(rect.y, rect.h, ys, gridStep, threshold, bounds.h)
	};
}

export function alignmentGuides(rect: Rect, others: Rect[]) {
	const lines: Line[] = [];
	for (const x of anchors(rect.x, rect.w)) {
		const hits = others.filter((o) => anchors(o.x, o.w).some((stop) => Math.abs(stop - x) <= 0.5));
		if (hits.length) {
			const y1 = Math.min(rect.y, ...hits.map((o) => o.y));
			const y2 = Math.max(rect.y + rect.h, ...hits.map((o) => o.y + o.h));
			lines.push({ x1: x, y1, x2: x, y2 });
		}
	}
	for (const y of anchors(rect.y, rect.h)) {
		const hits = others.filter((o) => anchors(o.y, o.h).some((stop) => Math.abs(stop - y) <= 0.5));
		if (hits.length) {
			const x1 = Math.min(rect.x, ...hits.map((o) => o.x));
			const x2 = Math.max(rect.x + rect.w, ...hits.map((o) => o.x + o.w));
			lines.push({ x1, y1: y, x2, y2: y });
		}
	}
	return lines;
}

const horizontal = (x1: number, x2: number, y: number): Segment => ({
	x1,
	y1: y,
	x2,
	y2: y,
	px: Math.abs(x2 - x1)
});
const vertical = (y1: number, y2: number, x: number): Segment => ({
	x1: x,
	y1,
	x2: x,
	y2,
	px: Math.abs(y2 - y1)
});

export function visibleMidpoint(start: number, end: number, viewMin: number, viewMax: number) {
	const low = Math.max(Math.min(start, end), viewMin);
	const high = Math.min(Math.max(start, end), viewMax);
	return low <= high ? (low + high) / 2 : (start + end) / 2;
}

export function measure(a: Rect, b: Rect) {
	const overlapX = a.x < b.x + b.w && b.x < a.x + a.w;
	const overlapY = a.y < b.y + b.h && b.y < a.y + a.h;
	const centerX = a.x + a.w / 2;
	const centerY = a.y + a.h / 2;

	if (overlapX && overlapY) {
		return [
			horizontal(b.x, a.x, centerY),
			horizontal(a.x + a.w, b.x + b.w, centerY),
			vertical(b.y, a.y, centerX),
			vertical(a.y + a.h, b.y + b.h, centerX)
		];
	}

	const segments: Segment[] = [];
	if (!overlapX) {
		const [x1, x2] = a.x + a.w <= b.x ? [a.x + a.w, b.x] : [b.x + b.w, a.x];
		const y = overlapY
			? (Math.max(a.y, b.y) + Math.min(a.y + a.h, b.y + b.h)) / 2
			: centerY;
		segments.push(horizontal(x1, x2, y));
	}
	if (!overlapY) {
		const [y1, y2] = a.y + a.h <= b.y ? [a.y + a.h, b.y] : [b.y + b.h, a.y];
		const x = overlapX
			? (Math.max(a.x, b.x) + Math.min(a.x + a.w, b.x + b.w)) / 2
			: b.x + b.w / 2;
		segments.push(vertical(y1, y2, x));
	}
	return segments;
}

export function contentBounds(rects: Rect[]) {
	return {
		w: Math.max(0, ...rects.map((r) => r.x + r.w)),
		h: Math.max(0, ...rects.map((r) => r.y + r.h))
	};
}
