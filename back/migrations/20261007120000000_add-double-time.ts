/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	// unspent double time prizes: { [twitch login]: { name, count } }. each one doubles the time of the
	// holder's next contribution. persisted like the boxes and ray guns — it's owed to whoever won it.
	pgm.addColumn("Users", {
		doubleTime: { type: "jsonb", notNull: true, default: "{}" },
	});
}

export async function down(pgm: MigrationBuilder): Promise<void> {
	pgm.dropColumn("Users", "doubleTime");
}
