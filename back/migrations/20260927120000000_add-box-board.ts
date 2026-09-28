/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	// the box leaderboard: its config (look, how many places, which products are boxes) and the standings,
	// { [login]: { name, count } }. the standings are kept across restarts — only the reset button clears them.
	pgm.addColumn("Users", {
		boxBoardSettings: { type: "jsonb", notNull: true, default: "{}" },
		boxBoard: { type: "jsonb", notNull: true, default: "{}" },
	});
}

export async function down(pgm: MigrationBuilder): Promise<void> {
	pgm.dropColumn("Users", "boxBoard");
	pgm.dropColumn("Users", "boxBoardSettings");
}
