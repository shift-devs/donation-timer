/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	// unfired ray gun charges: { [twitch login]: { name, count } }. won from a mystery box and spent with
	// "!raygun <name>" to time somebody out. persisted for the same reason the boxes are — a charge is owed
	// to whoever won it, and a restart that cancelled it would be robbing them.
	pgm.addColumn("Users", {
		rayguns: { type: "jsonb", notNull: true, default: "{}" },
	});
}

export async function down(pgm: MigrationBuilder): Promise<void> {
	pgm.dropColumn("Users", "rayguns");
}
