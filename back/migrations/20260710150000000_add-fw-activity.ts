/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	// rolling fourthwall activity feed (purchases/donations/memberships with buyer + message),
	// shown on the /fwactivity page. per-user jsonb array, capped in code.
	pgm.addColumn("Users", {
		fwActivity: { type: "jsonb", notNull: true, default: "[]" },
	});
}

export async function down(pgm: MigrationBuilder): Promise<void> {
	pgm.dropColumn("Users", "fwActivity");
}
