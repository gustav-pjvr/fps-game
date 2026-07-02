import type { GameDebugApi } from '../src/core/Game.ts';

declare global {
  interface Window {
    __gameDebug?: GameDebugApi;
  }
}

export {};
