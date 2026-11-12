export type Asset = { _id: string; url: string; name: string; folder?: string; width: number; height: number };

export type Item = {
	_key: string;
	_type: 'canvasItem';
	image: { _type: 'image'; asset: { _type: 'reference'; _ref: string } };
	x: number;
	y: number;
	w: number;
	h: number;
};

export type CanvasDoc = { width?: number; height?: number; items?: Item[] };

export type Status = {
	id: string;
	canvases: { _id: string; title?: string }[];
	live: boolean;
	publishable: boolean;
};

export type Bridge = {
	listAssets(): Promise<Asset[]>;
	select(id: string): void;
	create(title: string): void;
	patch(patches: object[]): void;
	publish(): void;
};
