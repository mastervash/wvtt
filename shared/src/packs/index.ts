import type { GamePack } from '../pack.js';
import { sandboxPack } from './sandbox.js';
import { pokerPack } from './poker.js';
import { dicePack } from './dice.js';
import { chessPack } from './chess.js';
import { boardPack } from './board.js';
import { eightsPack } from './eights.js';

export * from './common.js';
export { sandboxPack, pokerPack, dicePack, chessPack, boardPack, eightsPack };

/** Packs offered in the room's game picker. All are authored in the public format. */
export const BUILTIN_PACKS: GamePack[] = [sandboxPack, eightsPack, pokerPack, dicePack, chessPack, boardPack];

export const DEFAULT_PACK_ID = 'sandbox';

export function getBuiltinPack(id: string): GamePack | undefined {
  return BUILTIN_PACKS.find((p) => p.manifest.id === id);
}
