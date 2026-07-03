import { LobbyScene } from '../lobby/LobbyScene.ts';
import { MainMenu } from '../ui/menu/MainMenu.ts';
import { SettingsPanel } from '../ui/menu/SettingsPanel.ts';
import { InventoryPanel } from '../ui/menu/InventoryPanel.ts';
import { PlaySetupModal, type MatchSetupConfig } from '../ui/menu/PlaySetupModal.ts';
import { LoadingScreen } from '../ui/menu/LoadingScreen.ts';
import { Game } from './Game.ts';
import { DEFAULT_ENEMY_COUNT, DEFAULT_TARGET_COUNT, MAX_MATCH_ENTITY_COUNT } from './config.ts';

/** Top-level state machine: lobby (with menu overlays) -> match setup -> loading -> gameplay,
 * with gameplay able to hand control back to a fresh lobby via the death screen. */
export class App {
  private lobby: LobbyScene | null = null;
  private currentGame: Game | null = null;
  private readonly mainMenu: MainMenu;
  private readonly settingsPanel: SettingsPanel;
  private readonly inventoryPanel: InventoryPanel;
  private readonly loadingScreen: LoadingScreen;
  private playSetupModal: PlaySetupModal | null = null;

  private constructor(
    private readonly lobbyContainer: HTMLElement,
    private readonly gameContainer: HTMLElement,
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
    hudRoot: HTMLElement,
    overlayRoot: HTMLElement,
  ): Promise<App> {
    const app = new App(lobbyContainer, gameContainer, hudRoot, overlayRoot);
    await app.enterLobby();
    return app;
  }

  private async enterLobby(): Promise<void> {
    this.lobby = await LobbyScene.create(this.lobbyContainer);
    this.lobby.start();
    this.mainMenu.show();
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

    const game = await Game.create(
      this.gameContainer,
      this.hudRoot,
      config,
      (status, ratio) => this.loadingScreen.setProgress(status, ratio),
      () => void this.returnToLobby(),
    );

    this.loadingScreen.hide();
    this.currentGame = game;
    game.start();
  }

  /** Wired to the death screen's "Return to Lobby" button: tears down the match and rebuilds a
   * fresh lobby scene so the player can change loadout/settings before starting another. */
  private async returnToLobby(): Promise<void> {
    this.currentGame?.dispose();
    this.currentGame = null;
    await this.enterLobby();
  }
}
