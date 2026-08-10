export interface Entry {
	key: string;
	value: number;
}

export const total = (entries: Entry[]): number =>
	entries.reduce((value, entry) => value + entry.value, 0);
