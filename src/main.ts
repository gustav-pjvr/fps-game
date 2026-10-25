import { App } from './core/App.ts';
import { startGamepadMenus } from './ui/gamepadFocus.ts';

const lobbyRoot = document.getElementById('lobby');
const gameRoot = document.getElementById('app');
const hud = document.getElementById('hud');
const overlay = document.getElementById('overlay');

if (!lobbyRoot || !gameRoot || !hud || !overlay) {
  throw new Error('Required root elements (#lobby, #app, #hud, #overlay) are missing from index.html');
}

startGamepadMenus();
App.create(lobbyRoot, gameRoot, hud, overlay);
