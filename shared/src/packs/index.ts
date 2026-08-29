import type { GamePack } from '../pack.js';
import { sandboxPack } from './sandbox.js';
import { pokerPack } from './poker.js';
import { dicePack } from './dice.js';
import { chessPack } from './chess.js';
import { boardPack } from './board.js';
import { eightsPack } from './eights.js';
import { wildColoursPack } from './wildcolours.js';
import { promptPartyPack } from './promptparty.js';

export * from './common.js';
export {
  sandboxPack, pokerPack, dicePack, chessPack, boardPack,
  eightsPack, wildColoursPack, promptPartyPack,
};

/** Packs offered in the room's game picker. All are authored in the public format. */
export const BUILTIN_PACKS: GamePack[] = [
  sandboxPack, dicePack, boardPack,
  eightsPack, wildColoursPack, promptPartyPack, pokerPack, chessPack,
];

/**
 * Which column a pack belongs in on the home page.
 *
 * "sandbox" packs are kit with no rules attached: they hand you the pieces and get out
 * of the way. "scripted" packs run a rules script and can referee themselves. The
 * distinction is the first thing someone choosing a game wants to know, so the lobby
 * asks for it here rather than guessing from whether a script string is present.
 */
export type PackFlavour = 'sandbox' | 'scripted';

export function packFlavour(pack: GamePack): PackFlavour {
  return pack.script ? 'scripted' : 'sandbox';
}

export const DEFAULT_PACK_ID = 'sandbox';

export function getBuiltinPack(id: string): GamePack | undefined {
  return BUILTIN_PACKS.find((p) => p.manifest.id === id);
}
