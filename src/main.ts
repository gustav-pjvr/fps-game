import { App } from './core/App.ts';
import { startGamepadMenus } from './ui/gamepadFocus.ts';
import { installErrorReporter } from './core/errorReporter.ts';
import { APP_VERSION } from './core/config.ts';
import { Settings } from './settings/Settings.ts';

const lobbyRoot = document.getElementById('lobby');
const gameRoot = document.getElementById('app');
const hud = document.getElementById('hud');
const overlay = document.getElementById('overlay');

if (!lobbyRoot || !gameRoot || !hud || !overlay) {
  throw new Error('Required root elements (#lobby, #app, #hud, #overlay) are missing from index.html');
}

// Installed before the App exists so a startup failure is caught too; until the App resolves the
// player is in the menus. Reports nothing in a dev build.
let app: App | null = null;
installErrorReporter({
  getState: () => ({ where: app?.reportingWhere ?? 'menu', graphics: Settings.getGraphicsQuality() }),
  version: APP_VERSION,
  dev: import.meta.env.DEV,
});

startGamepadMenus();
void App.create(lobbyRoot, gameRoot, hud, overlay).then((created) => {
  app = created;
});
