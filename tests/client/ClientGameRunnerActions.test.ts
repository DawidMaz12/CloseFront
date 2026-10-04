import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../src/core/EventBus";
import { UnitType } from "../../src/core/game/Game";
import { TileRef } from "../../src/core/game/GameMap";

// ClientGameRunner's left-click handling: spawn intents during the spawn
// phase, the lazy myPlayer lookup, attack intents, and the auto-boat
// distance limit. Heavy renderer/audio/worker modules are mocked at import.

vi.mock("../../src/client/ClientEnv", () => ({
  ClientEnv: { gitCommit: () => "test-commit" },
}));
vi.mock("../../src/client/Auth", () => ({
  getPlayToken: async () => "8f1d2c3e-4b5a-4c6d-8e7f-90a1b2c3d4e5",
}));
vi.mock("../../src/client/LocalServer", () => ({
  LocalServer: class { },
}));
vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: vi.fn(async () => { }),
  showInGameConfirm: vi.fn(async () => false),
}));
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
  reloadForUpdate: vi.fn(),
  createCanvas: () => document.createElement("canvas"),
  homeHref: () => "/",
}));
vi.mock("../../src/core/game/TerrainMapLoader", () => ({
  loadTerrainMap: vi.fn(async () => ({}) as never),
}));
vi.mock("../../src/client/TerrainMapFileLoader", () => ({
  terrainMapFileLoader: {},
}));
vi.mock("../../src/client/hud/GameRenderer", () => ({
  createRenderer: vi.fn(),
}));
vi.mock("../../src/client/hud/layers/lib/GoldRateTracker", () => ({
  goldRateTracker: { resetAll: vi.fn() },
}));
vi.mock("../../src/client/theme/ThemeProvider", () => ({
  themeProvider: { reset: vi.fn() },
}));
vi.mock("../../src/client/sound/SoundManager", () => ({
  SoundManager: class { },
}));
vi.mock("../../src/client/render/gl", () => ({
  GLUnavailableError: class extends Error { },
  MapRenderer: class { },
  applyGraphicsOverrides: vi.fn(),
  createRenderSettings: vi.fn(() => ({})),
  deepAssign: vi.fn(),
  preloadAtlasData: vi.fn(async () => { }),
  renderDpr: () => 1,
  showGLGate: vi.fn(),
  trackGLInit: vi.fn(),
}));
vi.mock("../../src/client/WebGLFrameBuilder", () => ({
  WebGLFrameBuilder: class { },
}));
vi.mock("../../src/client/controllers/MapLayerController", () => ({
  MapLayerController: class { },
}));
vi.mock("../../src/client/view", () => ({
  GameView: class { },
  PlayerView: class { },
}));
vi.mock("../../src/core/worker/WorkerClient", () => ({
  WorkerClient: class { },
}));

import {
  ClientGameRunner,
  LobbyConfig,
} from "../../src/client/ClientGameRunner";
import {
  MapDragEvent,
  MapDragPreviewEvent,
  MouseUpEvent,
} from "../../src/client/InputHandler";
import {
  SendAttackIntentEvent,
  SendBoatAttackIntentEvent,
  SendSpawnIntentEvent,
} from "../../src/client/Transport";

const TILE = 77 as TileRef;
const SOURCE_TILE = 78 as TileRef;
const CLICK = { x: 10, y: 20 };

// Runner around fully mocked collaborators; started so clicks are handled.
function makeRunner(overrides: {
  inSpawnPhase?: boolean;
  hasOwner?: boolean;
  playerByClientID?: () => unknown;
  actions?: Record<string, unknown>;
  boatDistSquared?: number;
}) {
  const eventBus = new EventBus();
  const myPlayer = {
    actions: vi.fn(async () => overrides.actions ?? {}),
    id: () => "me",
    troops: () => 100,
  };
  const gameView = {
    config: () => ({ isRandomSpawn: () => false, isReplay: () => false }),
    inSpawnPhase: () => overrides.inSpawnPhase ?? false,
    myPlayer: () => null,
    isValidCoord: () => true,
    ref: (x: number, y: number) => (x === 2 && y === 3 ? SOURCE_TILE : TILE),
    x: (tile: TileRef) => (tile === SOURCE_TILE ? 2 : 1),
    y: (tile: TileRef) => (tile === SOURCE_TILE ? 3 : 2),
    circleSearch: () => new Set([SOURCE_TILE]),
    isLand: () => true,
    hasOwner: () => overrides.hasOwner ?? false,
    owner: (tile: TileRef) => ({
      id: () => (tile === SOURCE_TILE ? "me" : "enemy1"),
    }),
    playerByClientID: vi.fn(overrides.playerByClientID ?? (() => myPlayer)),
    euclideanDistSquared: () => overrides.boatDistSquared ?? 0,
  };
  const input = { initialize: vi.fn(), destroy: vi.fn() };
  const runner = new ClientGameRunner(
    { gameID: "game1234" } as LobbyConfig,
    "c0000001",
    eventBus,
    {
      initialize: vi.fn(),
      tick: vi.fn(),
      uiState: { attackRatio: 0.5, ghostStructure: null },
      transformHandler: {
        screenToWorldCoordinates: vi.fn((x: number, y: number) => ({ x, y })),
        screenToWorldCoordinatesFloat: vi.fn((x: number, y: number) => ({ x, y })),
        worldToScreenCoordinates: vi.fn((cell: { x: number; y: number }) => cell),
      },
    } as never,
    input as never,
    {
      updateCallback: vi.fn(),
      rejoinGame: vi.fn(),
      leaveGame: vi.fn(),
      isLocal: true,
    } as never,
    { start: vi.fn(), sendTurn: vi.fn(), cleanup: vi.fn() } as never,
    gameView as never,
    { playBackgroundMusic: vi.fn(), dispose: vi.fn() } as never,
    { goToPlayer: () => false } as never,
  );
  runner.start();
  return { runner, eventBus, gameView, myPlayer, input };
}

const flushPromises = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => { });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("left click", () => {
  it("emits a spawn intent when clicking unowned land during the spawn phase", () => {
    const { eventBus } = makeRunner({ inSpawnPhase: true });
    const spawns: SendSpawnIntentEvent[] = [];
    eventBus.on(SendSpawnIntentEvent, (e) => spawns.push(e));

    eventBus.emit(new MouseUpEvent(CLICK.x, CLICK.y));

    expect(spawns).toHaveLength(1);
    expect(spawns[0].tile).toBe(TILE);
  });

  it("lazily resolves myPlayer by clientID and emits an attack intent", async () => {
    const { eventBus, gameView } = makeRunner({
      hasOwner: true,
      actions: { canAttack: true, buildableUnits: [] },
    });
    const attacks: SendAttackIntentEvent[] = [];
    eventBus.on(SendAttackIntentEvent, (e) => attacks.push(e));

    eventBus.emit(new MouseUpEvent(CLICK.x, CLICK.y));
    await flushPromises();

    expect(gameView.playerByClientID).toHaveBeenCalledWith("c0000001");
    expect(attacks).toHaveLength(1);
    expect(attacks[0].targetID).toBe("enemy1");
    expect(attacks[0].troops).toBe(50); // 100 troops * 0.5 attack ratio
    expect(attacks[0].targetTile).toBe(TILE);
  });

  it("turns a drag from owned land into a target-directed attack intent", async () => {
    const { eventBus } = makeRunner({
      actions: { canAttack: true, buildableUnits: [] },
    });
    const attacks: SendAttackIntentEvent[] = [];
    eventBus.on(SendAttackIntentEvent, (e) => attacks.push(e));

    eventBus.emit(new MapDragEvent(2, 3, 1, 2));
    await flushPromises();

    expect(attacks).toHaveLength(1);
    expect(attacks[0]).toMatchObject({
      targetID: "enemy1",
      troops: 50,
      targetTile: TILE,
      sourceTile: SOURCE_TILE,
    });
  });

  it("renders an arrow from the nearest owned tile to the dragged target", () => {
    const { eventBus, runner } = makeRunner({
      actions: { canAttack: true, buildableUnits: [] },
    });

    eventBus.emit(new MapDragPreviewEvent(2, 3, 1, 2, true));

    const line = document.querySelector("svg line");
    const target = document.querySelector("svg circle:last-child");
    expect(line).not.toBeNull();
    expect(line?.getAttribute("x1")).toBe("2.5");
    expect(line?.getAttribute("y1")).toBe("3.5");
    expect(line?.getAttribute("x2")).toBe("1.5");
    expect(line?.getAttribute("y2")).toBe("2.5");
    expect(target?.getAttribute("cx")).toBe("1.5");

    runner.stop();
    expect(document.querySelector("svg")).toBeNull();
  });

  it("does nothing when the player is not in the view yet", async () => {
    const { eventBus, gameView } = makeRunner({
      hasOwner: true,
      playerByClientID: () => null,
    });
    const attacks: SendAttackIntentEvent[] = [];
    eventBus.on(SendAttackIntentEvent, (e) => attacks.push(e));
    const boats: SendBoatAttackIntentEvent[] = [];
    eventBus.on(SendBoatAttackIntentEvent, (e) => boats.push(e));

    eventBus.emit(new MouseUpEvent(CLICK.x, CLICK.y));
    await flushPromises();

    // The lazy-lookup branch was reached and returned early: no intent of
    // either kind went out.
    expect(gameView.playerByClientID).toHaveBeenCalledWith("c0000001");
    expect(attacks).toHaveLength(0);
    expect(boats).toHaveLength(0);
  });
});

describe("auto boat", () => {
  const boatActions = {
    canAttack: false,
    buildableUnits: [{ type: UnitType.TransportShip, canBuild: 5 as TileRef }],
  };

  it("boat-attacks land within the distance limit", async () => {
    const { eventBus } = makeRunner({
      hasOwner: true,
      actions: boatActions,
      boatDistSquared: 99 * 99,
    });
    const boats: SendBoatAttackIntentEvent[] = [];
    eventBus.on(SendBoatAttackIntentEvent, (e) => boats.push(e));

    eventBus.emit(new MouseUpEvent(CLICK.x, CLICK.y));
    await flushPromises();

    expect(boats).toHaveLength(1);
    expect(boats[0].dst).toBe(TILE);
    expect(boats[0].troops).toBe(50);
  });

  it("does not boat-attack past the distance limit", async () => {
    const { eventBus } = makeRunner({
      hasOwner: true,
      actions: boatActions,
      boatDistSquared: 100 * 100,
    });
    const boats: SendBoatAttackIntentEvent[] = [];
    eventBus.on(SendBoatAttackIntentEvent, (e) => boats.push(e));

    eventBus.emit(new MouseUpEvent(CLICK.x, CLICK.y));
    await flushPromises();

    expect(boats).toHaveLength(0);
  });
});

describe("stop() (OPE-411)", () => {
  it("calls input.destroy()", () => {
    const { runner, input } = makeRunner({});

    runner.stop();

    expect(input.destroy).toHaveBeenCalledTimes(1);
  });

  it("tolerates a second stop()", () => {
    const { runner, input } = makeRunner({});

    runner.stop();
    runner.stop();

    expect(input.destroy).toHaveBeenCalledTimes(2);
  });
});
