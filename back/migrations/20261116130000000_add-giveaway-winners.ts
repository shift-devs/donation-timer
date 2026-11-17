/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	// everybody who won a giveaway prize (a box's "Giveaway" prize, or a minigame that names one), for the
	// client to ship: [{ id, t, giveaway, source, login, name, shipped, note }]. listed on the Giveaways tab.
	pgm.addColumn("Users", {
		giveawayWinners: { type: "jsonb", notNull: true, default: "[]" },
	});
}

export async function down(pgm: MigrationBuilder): Promise<void> {
	pgm.dropColumn("Users", "giveawayWinners");
}
