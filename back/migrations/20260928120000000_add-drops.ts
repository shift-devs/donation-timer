/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	// the drops tab's config (odds, the hourly cap and floor, the rewards and the minigames), and the current
	// hour's tally — kept so a restart mid-hour can't hand out an extra drop or draw a fresh floor. the drop on
	// screen and the queue are live state and are never written here.
	pgm.addColumn("Users", {
		dropSettings: { type: "jsonb", notNull: true, default: "{}" },
		dropState: { type: "jsonb", notNull: true, default: "{}" },
	});
}

export async function down(pgm: MigrationBuilder): Promise<void> {
	pgm.dropColumn("Users", "dropSettings");
	pgm.dropColumn("Users", "dropState");
}
