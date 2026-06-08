/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	// scheduled conditional media events: at a time, iff the remaining countdown is in a window, play a clip.
	// stored per-user as an array (mirrors the rates column). starts empty for everyone.
	pgm.addColumn("Users", {
		timerEvents: { type: "jsonb", notNull: true, default: "[]" },
	});
}

export async function down(pgm: MigrationBuilder): Promise<void> {
	pgm.dropColumn("Users", "timerEvents");
}
