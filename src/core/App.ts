import { LobbyScene } from '../lobby/LobbyScene.ts';
import { MainMenu } from '../ui/menu/MainMenu.ts';
import { SettingsPanel } from '../ui/menu/SettingsPanel.ts';
import { InventoryPanel } from '../ui/menu/InventoryPanel.ts';
import { PlaySetupModal, type MatchSetupConfig } from '../ui/menu/PlaySetupModal.ts';
import { LoadingScreen } from '../ui/menu/LoadingScreen.ts';
import { Game } from './Game.ts';
import { DEFAULT_ENEMY_COUNT, DEFAULT_TARGET_COUNT, MAX_MATCH_ENTITY_COUNT } from './config.ts';

/** Top-level state machine: lobby (with menu overlays) -> match setup -> loading -> gameplay. */
export class App {
  private lobby: LobbyScene | null = null;
  private readonly mainMenu: MainMenu;
  private readonly settingsPanel: SettingsPanel;
  private readonly inventoryPanel: InventoryPanel;
  private readonly loadingScreen: LoadingScreen;
  private playSetupModal: PlaySetupModal | null = null;

  private constructor(
    private readonly gameContainer: HTMLElement,
    private readonly blocker: HTMLElement,
    private readonly hudRoot: HTMLElement,
    private readonly overlayRoot: HTMLElement,
  ) {
    this.mainMenu = new MainMenu(overlayRoot, {
      onPlay: () => this.openPlaySetup(),
      onSettings: () => this.settingsPanel.show(),
      onInventory: () => this.inventoryPanel.show(),
    });
    this.settingsPanel = new SettingsPanel(overlayRoot, () => this.settingsPanel.hide());
    this.inventoryPanel = new InventoryPanel(overlayRoot, () => this.inventoryPanel.hide());
    this.loadingScreen = new LoadingScreen(overlayRoot);
  }

  static async create(
    lobbyContainer: HTMLElement,
    gameContainer: HTMLElement,
    blocker: HTMLElement,
    hudRoot: HTMLElement,
    overlayRoot: HTMLElement,
  ): Promise<App> {
    const app = new App(gameContainer, blocker, hudRoot, overlayRoot);
    app.lobby = await LobbyScene.create(lobbyContainer);
    app.lobby.start();
    app.mainMenu.show();
    return app;
  }

  private openPlaySetup(): void {
    this.playSetupModal?.dispose();
    this.playSetupModal = new PlaySetupModal(
      this.overlayRoot,
      { enemyCount: DEFAULT_ENEMY_COUNT, targetCount: DEFAULT_TARGET_COUNT },
      MAX_MATCH_ENTITY_COUNT,
      (config) => void this.startMatch(config),
      () => this.playSetupModal?.hide(),
    );
    this.playSetupModal.show();
  }

  private async startMatch(config: MatchSetupConfig): Promise<void> {
    this.playSetupModal?.hide();
    this.mainMenu.hide();
    this.loadingScreen.show();

    this.lobby?.dispose();
    this.lobby = null;

    const game = await Game.create(this.gameContainer, this.blocker, this.hudRoot, config, (status, ratio) => {
      this.loadingScreen.setProgress(status, ratio);
    });

    this.loadingScreen.hide();
    game.start();
  }
}
