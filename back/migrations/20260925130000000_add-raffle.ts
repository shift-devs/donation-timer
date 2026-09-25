/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	// the raffle tab's config: the look of the /raffle source and the raffle it starts (title, prize, how many
	// winners, mystery boxes for them). the raffle on screen is live state and is never written here.
	pgm.addColumn("Users", {
		raffleSettings: { type: "jsonb", notNull: true, default: "{}" },
	});
}

export async function down(pgm: MigrationBuilder): Promise<void> {
	pgm.dropColumn("Users", "raffleSettings");
}
