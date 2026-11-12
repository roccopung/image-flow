import { defineArrayMember, defineField, defineType } from 'sanity';

const canvasItem = defineArrayMember({
	name: 'canvasItem',
	type: 'object',
	fields: [
		defineField({ name: 'image', type: 'image', validation: (rule) => rule.required() }),
		defineField({ name: 'x', type: 'number' }),
		defineField({ name: 'y', type: 'number' }),
		defineField({ name: 'w', type: 'number' }),
		defineField({ name: 'h', type: 'number' })
	],
	preview: { select: { media: 'image', x: 'x', y: 'y' }, prepare: ({ media, x, y }) => ({ title: `${x}, ${y}`, media }) }
});

export const schemaTypes = [
	defineType({
		name: 'canvas',
		type: 'document',
		fields: [
			defineField({ name: 'title', type: 'string' }),
			defineField({ name: 'width', type: 'number', initialValue: 1500 }),
			defineField({ name: 'height', type: 'number', initialValue: 1500 }),
			defineField({ name: 'items', type: 'array', of: [canvasItem] })
		]
	}),
	defineType({
		name: 'settings',
		type: 'document',
		fields: [defineField({ name: 'canvas', type: 'reference', to: [{ type: 'canvas' }], weak: true })]
	})
];
