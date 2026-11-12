/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	alignmentGuides,
	contentBounds,
	intersects,
	measure,
	snapRect,
	unionRect,
	visibleMidpoint
} from './snap.ts';

const CANVAS = 1500;
const CANVAS_RECT = { x: 0, y: 0, w: CANVAS, h: 1200 };

const rect = (x: number, y: number, w = 80, h = 100) => ({ x, y, w, h });
const pixels = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) =>
	measure(a, b).map((segment) => segment.px);

test('grid snap sticks either edge within the threshold and leaves the rest free', () => {
	assert.deepEqual(snapRect(rect(104, 500), [], 100, 6, CANVAS_RECT), { x: 100, y: 500 });
	assert.deepEqual(snapRect(rect(217, 500), [], 100, 6, CANVAS_RECT), { x: 220, y: 500 });
	assert.deepEqual(snapRect(rect(150, 550), [], 100, 6, CANVAS_RECT), { x: 150, y: 550 });
});

test('object snap matches edges and centres, and beats the grid', () => {
	const other = rect(405, 900);
	assert.equal(snapRect(rect(403, 0), [other], 100, 6, CANVAS_RECT).x, 405);
	assert.equal(snapRect(rect(482, 0), [other], 100, 6, CANVAS_RECT).x, 485);
	assert.equal(snapRect(rect(407, 0), [rect(405, 900)], 400, 6, CANVAS_RECT).x, 405);
});

test('snap stays inside the canvas and returns whole px when off', () => {
	assert.deepEqual(snapRect(rect(CANVAS, -50), [], null, 6, CANVAS_RECT), { x: CANVAS - 80, y: 0 });
	assert.deepEqual(snapRect(rect(10.4, 20.6), [], null, 6, CANVAS_RECT), { x: 10, y: 21 });
});

test('guides span the moving image and the images it aligns with', () => {
	const [guide] = alignmentGuides(rect(100, 0), [rect(100, 500)]);
	assert.deepEqual(guide, { x1: 100, y1: 0, x2: 100, y2: 600 });
	assert.deepEqual(alignmentGuides(rect(0, 0), [rect(1000, 1000)]), []);
});

test('measure gives gaps per separated axis', () => {
	assert.deepEqual(pixels(rect(0, 0), rect(100, 0)), [20]);
	assert.deepEqual(pixels(rect(100, 0), rect(0, 0)), [20]);
	assert.deepEqual(pixels(rect(0, 0), rect(0, 130)), [30]);
	assert.deepEqual(pixels(rect(0, 0), rect(90, 110)), [10, 10]);
	assert.deepEqual(pixels(rect(0, 0), rect(80, 0)), [0]);
});

test('labels sit on the visible part of a line', () => {
	assert.equal(visibleMidpoint(200, 3000, 0, 600), 400);
	assert.equal(visibleMidpoint(3000, 200, 0, 600), 400);
	assert.equal(visibleMidpoint(0, 100, 0, 600), 50);
	assert.equal(visibleMidpoint(1000, 2000, 0, 600), 1500);
});

test('measure gives four inner distances for overlapping rects and the canvas', () => {
	assert.deepEqual(pixels(rect(10, 20), CANVAS_RECT), [10, CANVAS - 90, 20, 1200 - 120]);
});

test('snap clamps to non-square bounds', () => {
	assert.equal(snapRect(rect(0, 5000), [], null, 6, CANVAS_RECT).y, 1200 - 100);
});

test('content bounds is the far corner of all items', () => {
	assert.deepEqual(contentBounds([rect(10, 20), rect(500, 0, 100, 50)]), { w: 600, h: 120 });
	assert.deepEqual(contentBounds([]), { w: 0, h: 0 });
});

test('union spans all rects; intersects counts any overlap but not touching edges', () => {
	assert.deepEqual(unionRect([rect(100, 200), rect(400, 50, 20, 20)]), { x: 100, y: 50, w: 320, h: 250 });
	assert.equal(intersects(rect(0, 0), rect(79, 99)), true);
	assert.equal(intersects(rect(0, 0), rect(80, 0)), false);
});
