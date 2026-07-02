import { Game } from './core/Game.ts';

const app = document.getElementById('app');
const blocker = document.getElementById('blocker');

if (!app || !blocker) {
  throw new Error('Required root elements (#app, #blocker) are missing from index.html');
}

Game.create(app, blocker).then((game) => game.start());
