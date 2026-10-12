import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { zPlayerRef } from "../snapshot/SnapshotType";

export class SetTargetWorkerRatioExecution implements Execution {
  constructor(
    private player: Player,
    private ratio: number,
  ) {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }

  init(game: Game, ticks: number): void {
    this.player.setTargetWorkerRatio(this.ratio);
  }

  tick(ticks: number): void {}

  snapshot(w: SnapshotWriter): ExecRecord {
    return SetTargetWorkerRatioExecutionSnapshot.write({
      player: w.player(this.player),
      ratio: this.ratio,
    });
  }

  restoreSnapshot(
    s: SetTargetWorkerRatioState,
    r: SnapshotReader,
  ): void {
    this.player = r.player(s.player);
    this.ratio = s.ratio;
  }
}

const SetTargetWorkerRatioStateSchema = z.object({
  player: zPlayerRef(),
  ratio: z.number(),
});
type SetTargetWorkerRatioState = z.infer<
  typeof SetTargetWorkerRatioStateSchema
>;

export const SetTargetWorkerRatioExecutionSnapshot = execSnapshotType({
  name: "SetTargetWorkerRatio",
  version: 1,
  schema: SetTargetWorkerRatioStateSchema,
  cls: () => SetTargetWorkerRatioExecution,
});
