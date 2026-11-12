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

export type Bridge = {
	listAssets(): Promise<Asset[]>;
	patch(patches: object[]): void;
	publish(): void;
};
