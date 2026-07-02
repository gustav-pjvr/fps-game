import { Game } from './core/Game.ts';

const app = document.getElementById('app');
const blocker = document.getElementById('blocker');
const hud = document.getElementById('hud');

if (!app || !blocker || !hud) {
  throw new Error('Required root elements (#app, #blocker, #hud) are missing from index.html');
}

Game.create(app, blocker, hud).then((game) => game.start());
