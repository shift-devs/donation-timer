/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	// which ! commands twitch mods may run in chat, one switch per group (see chatPermissions.ts). blank means
	// the defaults, so an existing channel keeps what mods could already do.
	pgm.addColumn("Users", {
		chatPermissions: { type: "jsonb", notNull: true, default: "{}" },
	});
}

export async function down(pgm: MigrationBuilder): Promise<void> {
	pgm.dropColumn("Users", "chatPermissions");
}
