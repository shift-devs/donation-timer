/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	// widget appearance settings (bgColor for the /widget chroma fill). per-user jsonb, mirrors rates.
	pgm.addColumn("Users", {
		widgetSettings: { type: "jsonb", notNull: true, default: "{}" },
	});
}

export async function down(pgm: MigrationBuilder): Promise<void> {
	pgm.dropColumn("Users", "widgetSettings");
}
