/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	// named /events browser sources an event can render to, so several clips can sit in different
	// places in the scene. stored per-user as an array (mirrors timerEvents). the unnamed default
	// layer is implicit and not stored, so everyone starts empty and existing sources keep working.
	pgm.addColumn("Users", {
		eventLayers: { type: "jsonb", notNull: true, default: "[]" },
	});
}

export async function down(pgm: MigrationBuilder): Promise<void> {
	pgm.dropColumn("Users", "eventLayers");
}
