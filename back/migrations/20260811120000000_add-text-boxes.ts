/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	// mod-editable text boxes, one per /text browser source. stored per-user as an array (mirrors eventLayers),
	// each carrying how it looks and the words currently on stream, so a restart puts the text back up.
	pgm.addColumn("Users", {
		textBoxes: { type: "jsonb", notNull: true, default: "[]" },
	});
}

export async function down(pgm: MigrationBuilder): Promise<void> {
	pgm.dropColumn("Users", "textBoxes");
}
