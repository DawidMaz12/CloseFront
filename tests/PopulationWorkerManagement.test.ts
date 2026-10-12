import { describe, expect, it, beforeEach } from "vitest";
import { setup } from "./util/Setup";
import { Game, Player, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { SetTargetWorkerRatioExecution } from "../src/core/execution/SetTargetWorkerRatioExecution";

let game: Game;
let p1: Player;
let p2: Player;

describe("Population and Worker Management", () => {
  beforeEach(async () => {
    game = await setup("big_plains", {});

    const p1Info = new PlayerInfo("p1_id", PlayerType.Human, null, "Player 1");
    const p2Info = new PlayerInfo("p2_id", PlayerType.Human, null, "Player 2");

    p1 = game.addPlayer(p1Info);
    p2 = game.addPlayer(p2Info);
  });

  it("should initialize players with default 80% soldiers and 20% workers", () => {
    expect(p1.targetWorkerRatio()).toBe(0.2);
    expect(p1.actualWorkerRatio()).toBe(0.2);
    // startManpower for human player is 25,000
    expect(p1.population()).toBe(25000);
    expect(p1.troops()).toBe(20000); // 80% soldiers
    expect(p1.workers()).toBe(5000); // 20% workers
  });

  it("should scale passive gold generation with workforce efficiency and population scale", () => {
    // 0% workers -> 0 gold
    p1.setTargetWorkerRatio(0);
    p1.setWorkers(0);
    p1.setTroops(10000);
    expect(p1.actualWorkerRatio()).toBe(0);
    expect(game.config().goldAdditionRate(p1)).toBe(0n);

    // 20% workers at 10,000 pop
    p1.setWorkers(2000);
    p1.setTroops(8000);
    expect(p1.actualWorkerRatio()).toBe(0.2);
    const gold20 = game.config().goldAdditionRate(p1);
    expect(gold20).toBeGreaterThan(0n);

    // 100% workers at 10,000 pop -> reaches 5x concentration efficiency
    p1.setWorkers(10000);
    p1.setTroops(0);
    expect(p1.actualWorkerRatio()).toBe(1.0);
    const gold100 = game.config().goldAdditionRate(p1);
    // 100% output is ~5.95x of 20% output due to the +25% workforce concentration bonus
    expect(Number(gold100) / Number(gold20)).toBeGreaterThan(5.0);

    // Economies of scale: 5,000,000 pop is 1.5x more efficient than <= 5,000 pop
    p1.setWorkers(5000);
    p1.setTroops(0); // 5,000 pop
    const goldSmall = game.config().goldAdditionRate(p1);

    p1.setWorkers(5000000);
    p1.setTroops(0); // 5,000,000 pop (100% workers)
    const goldBig = game.config().goldAdditionRate(p1);
    // big population scale bonus is exactly 1.5x the base output of small population
    expect(Number(goldBig) / Number(goldSmall)).toBeCloseTo(1.5, 1);
  });

  it("should gradually convert soldiers to workers at 5% per second (0.5% per tick)", () => {
    // Set to 10,000 population: 8,000 soldiers, 2,000 workers (20%).
    p1.setTroops(8000);
    p1.setWorkers(2000);
    // Set target to 50% (5,000 workers).
    p1.setTargetWorkerRatio(0.5);

    // In 1 tick (10 ticks/sec), max conversion = 0.5% of 10,000 = 50 population
    p1.tickPopulation();
    expect(p1.troops()).toBe(7950);
    expect(p1.workers()).toBe(2050);

    // In 9 more ticks (total 10 ticks = 1 second)
    for (let i = 0; i < 9; i++) {
      p1.tickPopulation();
    }
    // Total converted in 1 sec = 500 (5% of 10,000)
    expect(p1.troops()).toBe(7500);
    expect(p1.workers()).toBe(2500);
    expect(p1.actualWorkerRatio()).toBe(0.25);
  });

  it("should gradually convert workers back to soldiers when target ratio is decreased", () => {
    // Setup 50/50 split: 5,000 soldiers, 5,000 workers
    p1.setWorkers(5000);
    p1.setTroops(5000);
    p1.setTargetWorkerRatio(0.1); // Target 10% (1,000 workers)

    // 10 ticks = 1 second: 500 workers should convert to soldiers
    for (let i = 0; i < 10; i++) {
      p1.tickPopulation();
    }
    expect(p1.workers()).toBe(4500);
    expect(p1.troops()).toBe(5500);
  });

  it("should prioritize soldiers in combat and only deplete workers once soldiers reach 0", () => {
    p1.setTroops(1000);
    p1.setWorkers(500);

    // Light damage: only soldiers take casualties
    const removedLight = p1.removeTroops(300, true);
    expect(removedLight).toBe(300);
    expect(p1.troops()).toBe(700);
    expect(p1.workers()).toBe(500); // Workers completely safe

    // Overwhelming damage: wipes remaining 700 soldiers and 200 workers
    const removedHeavy = p1.removeTroops(900, true);
    expect(removedHeavy).toBe(900);
    expect(p1.troops()).toBe(0);
    expect(p1.workers()).toBe(300);
  });

  it("should capture 50% of remaining workers upon conquest", () => {
    // p2 has 1,000 workers and 0 soldiers
    p2.setTroops(0);
    p2.setWorkers(1000);

    const conquerorWorkersBefore = p1.workers();

    // Conquer p2
    game.conquerPlayer(p1, p2);

    // 50% of 1,000 = 500 workers captured
    expect(p1.workers()).toBe(conquerorWorkersBefore + 500);
  });

  it("should update target ratio via SetTargetWorkerRatioExecution", () => {
    const exec = new SetTargetWorkerRatioExecution(p1, 0.65);
    exec.init(game, 1);
    expect(p1.targetWorkerRatio()).toBe(0.65);
  });
});
