import { LobbyScene } from '../lobby/LobbyScene.ts';
import { MainMenu } from '../ui/menu/MainMenu.ts';
import { SettingsPanel } from '../ui/menu/SettingsPanel.ts';
import { InventoryPanel } from '../ui/menu/InventoryPanel.ts';
import { PlaySetupModal, type MatchSetupConfig } from '../ui/menu/PlaySetupModal.ts';
import { LoadingScreen } from '../ui/menu/LoadingScreen.ts';
import { MultiplayerMenu } from '../ui/menu/MultiplayerMenu.ts';
import { CreateRoomScreen } from '../ui/menu/CreateRoomScreen.ts';
import { JoinRoomScreen } from '../ui/menu/JoinRoomScreen.ts';
import { MatchEndScreen, type MultiplayerMatchEndResult, type RematchSettings } from '../ui/matchEndScreen.ts';
import { Game } from './Game.ts';
import { DEFAULT_ENEMY_COUNT, DEFAULT_TARGET_COUNT, MAX_MATCH_ENTITY_COUNT } from './config.ts';
import { generateMultiplayerSeed } from './worldSeed.ts';
import { pickMultiplayerSpawnPoints } from './multiplayerSpawn.ts';
import type { PeerConnection } from '../network/PeerConnection.ts';
import type { MultiplayerMatchStartParams, MultiplayerRole, MultiplayerSession } from '../network/MultiplayerSession.ts';

/** Top-level state machine: lobby (with menu overlays) -> match setup -> loading -> gameplay,
 * with gameplay able to hand control back to a fresh lobby via the death screen. */
export class App {
  private lobby: LobbyScene | null = null;
  private currentGame: Game | null = null;
  private readonly mainMenu: MainMenu;
  private readonly settingsPanel: SettingsPanel;
  // Assigned in create() before enterLobby() shows the menu that can open it - InventoryPanel's
  // creation is async (it renders each weapon's preview thumbnail), unlike the other lobby panels.
  private inventoryPanel!: InventoryPanel;
  private readonly loadingScreen: LoadingScreen;
  private playSetupModal: PlaySetupModal | null = null;
  private readonly multiplayerMenu: MultiplayerMenu;
  private readonly createRoomScreen: CreateRoomScreen;
  private readonly joinRoomScreen: JoinRoomScreen;
  private readonly matchEndScreen: MatchEndScreen;
  /** Tracks the room this multiplayer match is on (MULTIPLAYER_PLAN.md §7 phase 4) - restartMultiplayerMatch
   * needs the connection/role to reuse them for a rematch, and this is simpler than threading them
   * back out through every callback that might need them. Null outside a multiplayer match. */
  private currentMultiplayerSession: MultiplayerSession | null = null;

  private constructor(
    private readonly lobbyContainer: HTMLElement,
    private readonly gameContainer: HTMLElement,
    private readonly hudRoot: HTMLElement,
    private readonly overlayRoot: HTMLElement,
  ) {
    this.mainMenu = new MainMenu(overlayRoot, {
      onPlay: () => this.openPlaySetup(),
      onMultiplayer: () => this.multiplayerMenu.show(),
      onSettings: () => this.settingsPanel.show(),
      onInventory: () => this.inventoryPanel.show(),
    });
    this.settingsPanel = new SettingsPanel(overlayRoot, () => this.settingsPanel.hide());
    this.loadingScreen = new LoadingScreen(overlayRoot);
    this.multiplayerMenu = new MultiplayerMenu(overlayRoot, {
      onCreateRoom: () => {
        this.multiplayerMenu.hide();
        this.createRoomScreen.show();
      },
      onJoinRoom: () => {
        this.multiplayerMenu.hide();
        this.joinRoomScreen.show();
      },
      onClose: () => this.multiplayerMenu.hide(),
    });
    this.createRoomScreen = new CreateRoomScreen(
      overlayRoot,
      () => this.multiplayerMenu.show(),
      (connection, params) => void this.startMultiplayerMatch(connection, 'host', params),
    );
    this.joinRoomScreen = new JoinRoomScreen(
      overlayRoot,
      () => this.multiplayerMenu.show(),
      (connection, params) => void this.startMultiplayerMatch(connection, 'guest', params),
    );
    this.matchEndScreen = new MatchEndScreen(
      overlayRoot,
      (settings) => this.handleRematchClick(settings),
      () => this.handleReturnToLobbyFromMatchEnd(),
    );
  }

  static async create(
    lobbyContainer: HTMLElement,
    gameContainer: HTMLElement,
    hudRoot: HTMLElement,
    overlayRoot: HTMLElement,
  ): Promise<App> {
    const app = new App(lobbyContainer, gameContainer, hudRoot, overlayRoot);
    app.inventoryPanel = await InventoryPanel.create(overlayRoot, () => app.inventoryPanel.hide());
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

  /** Wired from CreateRoomScreen/JoinRoomScreen once a match is actually starting (see
   * MULTIPLAYER_PLAN.md §7 phase 2). Also the entry point restartMultiplayerMatch reuses for a
   * rematch, so it must not assume this is the *first* match on this connection. */
  private async startMultiplayerMatch(connection: PeerConnection, role: MultiplayerRole, params: MultiplayerMatchStartParams): Promise<void> {
    this.multiplayerMenu.hide();
    await this.createMultiplayerGame(connection, role, params);
  }

  /** Shared by the initial startMultiplayerMatch and restartMultiplayerMatch (phase 4's rematch
   * flow) - mirrors startMatch's lobby-teardown/loading-screen shape, but hands Game.create() a
   * multiplayer session instead of a MatchSetupConfig. `enemyCount`/`targetCount` are passed as 0
   * and are otherwise unused: Game.create() skips AI spawning entirely once a multiplayer session
   * is present, since multiplayer matches are pure PvP. */
  private async createMultiplayerGame(connection: PeerConnection, role: MultiplayerRole, params: MultiplayerMatchStartParams): Promise<void> {
    this.mainMenu.hide();
    this.matchEndScreen.hide();
    this.loadingScreen.show();

    this.lobby?.dispose();
    this.lobby = null;
    this.currentMultiplayerSession = { connection, role, ...params };

    const game = await Game.create(
      this.gameContainer,
      this.hudRoot,
      { enemyCount: 0, targetCount: 0 },
      (status, ratio) => this.loadingScreen.setProgress(status, ratio),
      () => void this.returnToLobby(),
      { connection, role, ...params },
      (result) => this.handleMultiplayerMatchEnd(result),
      (rematchParams) => void this.restartMultiplayerMatch(connection, role, rematchParams),
      // Only ever fires on the guest's side (see protocol.ts's HostLeftRoomMessage) - the host
      // never receives its own message back.
      () => {
        this.matchEndScreen.hide();
        void this.returnToLobby();
      },
    );

    this.loadingScreen.hide();
    this.currentGame = game;
    game.start();
  }

  /** Tears down the current (just-ended) multiplayer Game and starts a fresh one on the *same*
   * still-open connection (MULTIPLAYER_PLAN.md §7 phase 4) - triggered by the host's Rematch click
   * (handleRematchClick) or, on the guest's side, by receiving the fresh matchStart that click
   * sends (Game.ts's onMultiplayerRematchReceived). */
  private async restartMultiplayerMatch(connection: PeerConnection, role: MultiplayerRole, params: MultiplayerMatchStartParams): Promise<void> {
    // Silences the old Game's message handling before tearing it down - Game.create() re-attaches
    // its own callbacks once the new match is ready, but there's a gap in between where a stray
    // message must not reach a Game instance that's about to be disposed.
    connection.setCallbacks({ onConnected: () => {}, onPeerDisconnected: () => {}, onError: () => {}, onMessage: () => {} });
    this.currentGame?.dispose({ keepConnectionAlive: true });
    this.currentGame = null;
    await this.createMultiplayerGame(connection, role, params);
  }

  /** Wired to Game's onMultiplayerMatchEnd - shows MatchEndScreen and remembers the result so
   * handleRematchClick has the connection/role/killLimit it needs. */
  private handleMultiplayerMatchEnd(result: MultiplayerMatchEndResult): void {
    this.matchEndScreen.show(result);
  }

  /** MatchEndScreen only ever shows this button (and its settings) to the host (see its own
   * comment) - applies whatever kill limit/new-map choice the host made there, sends the result to
   * the guest on the same connection, and restarts locally. The guest restarts on its own once
   * that message arrives (Game.ts's onMultiplayerRematchReceived). */
  private handleRematchClick(settings: RematchSettings): void {
    if (!this.currentMultiplayerSession) return;
    const { connection, role, seed: previousSeed, ownSlot, roomCode, hostRoster } = this.currentMultiplayerSession;
    const seed = settings.newMap ? generateMultiplayerSeed() : previousSeed;
    const killLimit = settings.killLimit;
    // The host's *current* roster (whoever's actually still connected, including anyone who
    // rejoined since the last match started) rather than the original match-start roster, which
    // could still list a slot that's since disconnected for good.
    const roster = hostRoster?.currentRoster() ?? this.currentMultiplayerSession.roster;
    const points = pickMultiplayerSpawnPoints(roster.length);
    const spawns = roster.map((entry, i) => ({ slot: entry.slot, x: points[i]!.x, z: points[i]!.z }));
    connection.send({ type: 'matchStart', seed, killLimit, spawns, roster });
    void this.restartMultiplayerMatch(connection, role, {
      seed,
      killLimit,
      ownSlot,
      spawns: spawns.map((s) => ({ slot: s.slot, point: { x: s.x, z: s.z } })),
      roster,
      roomCode,
      initialScoreboard: [],
      hostRoster,
    });
  }

  /** Wired to MatchEndScreen's "Return to Lobby" button, shown to both host and guest (per user
   * request: the guest waits on the podium for the host to rematch, change settings, or leave) -
   * only the host's click needs to tell the other side, since the guest leaving doesn't end
   * anything for the host (the room/connection is the host's to keep or close). */
  private handleReturnToLobbyFromMatchEnd(): void {
    if (this.currentMultiplayerSession?.role === 'host') {
      this.currentMultiplayerSession.connection.send({ type: 'hostLeftRoom' });
    }
    this.matchEndScreen.hide();
    void this.returnToLobby();
  }

  /** Wired to the death screen's "Return to Lobby" button: tears down the match and rebuilds a
   * fresh lobby scene so the player can change loadout/settings before starting another. */
  private async returnToLobby(): Promise<void> {
    this.currentGame?.dispose();
    this.currentGame = null;
    this.currentMultiplayerSession = null;
    await this.enterLobby();
  }
}
