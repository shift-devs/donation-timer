/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	// running emote-only / sub-only prizes: { emote?: ms, subscriber?: ms } — when each mode is due to switch off.
	// persisted so a restart mid-prize still switches chat back to normal.
	pgm.addColumn("Users", {
		chatModes: { type: "jsonb", notNull: true, default: "{}" },
	});
}

export async function down(pgm: MigrationBuilder): Promise<void> {
	pgm.dropColumn("Users", "chatModes");
}
