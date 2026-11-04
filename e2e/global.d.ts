import type { GameDebugApi } from '../src/core/gameDebugApi.ts';

declare global {
  interface Window {
    __gameDebug?: GameDebugApi;
  }
}

export {};
