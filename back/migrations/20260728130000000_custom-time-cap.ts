/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

// replace the fixed 30h on/off cap (shouldCap boolean) with a user-set cap in seconds. 0 = no cap.
// anyone who had the old cap enabled keeps the equivalent 30h so behaviour doesn't change under them.
const OLD_CAP_SECONDS = 30 * 3600;

export async function up(pgm: MigrationBuilder): Promise<void> {
	pgm.addColumn("Users", {
		capSeconds: { type: "integer", notNull: true, default: 0 },
	});
	pgm.sql(`UPDATE "Users" SET "capSeconds" = ${OLD_CAP_SECONDS} WHERE "shouldCap" = true`);
	pgm.dropColumn("Users", "shouldCap");
}

export async function down(pgm: MigrationBuilder): Promise<void> {
	pgm.addColumn("Users", {
		shouldCap: { type: "boolean", notNull: true, default: false },
	});
	pgm.sql(`UPDATE "Users" SET "shouldCap" = true WHERE "capSeconds" > 0`);
	pgm.dropColumn("Users", "capSeconds");
}
