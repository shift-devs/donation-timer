/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	// who the fuck you gun hit and when: { login: ms }. first aid refuses them for 24h after.
	pgm.addColumn("Users", {
		fuckedYou: { type: "jsonb", notNull: true, default: "{}" },
	});
}

export async function down(pgm: MigrationBuilder): Promise<void> {
	pgm.dropColumn("Users", "fuckedYou");
}
