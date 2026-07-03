import { App } from './core/App.ts';

const lobbyRoot = document.getElementById('lobby');
const gameRoot = document.getElementById('app');
const hud = document.getElementById('hud');
const overlay = document.getElementById('overlay');

if (!lobbyRoot || !gameRoot || !hud || !overlay) {
  throw new Error('Required root elements (#lobby, #app, #hud, #overlay) are missing from index.html');
}

App.create(lobbyRoot, gameRoot, hud, overlay);
