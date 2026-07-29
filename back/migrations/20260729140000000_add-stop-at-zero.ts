/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	// when on, a timer that reaches 0 stays there: later subs/donations/purchases add nothing until a new
	// time is set by hand. off preserves the old behaviour (an event revives the timer from 0).
	pgm.addColumn("Users", {
		stopAtZero: { type: "boolean", notNull: true, default: false },
	});
}

export async function down(pgm: MigrationBuilder): Promise<void> {
	pgm.dropColumn("Users", "stopAtZero");
}
