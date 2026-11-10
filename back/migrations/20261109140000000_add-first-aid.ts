/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	// unused first aid kits: { [twitch login]: { name, count } }. won from a box and spent with "!firstaid <name>"
	// to cut somebody's timeout to 1 second. persisted like the ray guns — a kit is owed to whoever won it.
	pgm.addColumn("Users", {
		firstAid: { type: "jsonb", notNull: true, default: "{}" },
	});
}

export async function down(pgm: MigrationBuilder): Promise<void> {
	pgm.dropColumn("Users", "firstAid");
}
