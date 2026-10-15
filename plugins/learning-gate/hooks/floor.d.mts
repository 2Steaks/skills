// Types for floor.mjs.

export declare const CATS: readonly string[]

export type FloorPack = {
  name: string
  /** Which files the pack's line patterns read; null reads every file. */
  scope: readonly RegExp[] | null
  categories: Record<string, { paths: readonly RegExp[]; diff: readonly RegExp[] }>
}

export type Floor = {
  commentOnly: boolean
  comment: RegExp
  ignore: readonly RegExp[]
  packs: readonly FloorPack[]
}

export type FloorLine = string | { file: string | null; text: string }

export type FloorMatch = { cat: string; pack: string; pattern: string; file: string | null; text?: string }

export declare function compileFloor(raw: unknown): Floor | null
export declare function floorMatches(floor: Floor, files?: readonly string[], lines?: readonly FloorLine[]): FloorMatch[]
export declare function floorSignals(floor: Floor, files?: readonly string[], lines?: readonly FloorLine[]): string[]
export declare function changedLines(before?: string, after?: string): string[]
