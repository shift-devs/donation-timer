import React from "react";
import { Badge, Button, Checkbox, HStack, Input, Select, Switch, Text, Textarea, VStack } from "@chakra-ui/react";
import NumberField from "../../NumberField";
import { countdown, EFFECT_KINDS } from "../../mysterybox";

// prize art in public/prizes, audio in public/media (vite.config.ts bakes both lists in at build time)
export const PRIZE_IMAGES: string[] = typeof __PRIZES__ !== "undefined" ? __PRIZES__ : [];
const MEDIA_FILES: string[] = typeof __MEDIA_FILES__ !== "undefined" ? __MEDIA_FILES__ : [];
// anything an <audio> element will play, VIDEO CONTAINERS INCLUDED: a "sound effect" pulled off youtube
// arrives as an .mp4 with nothing but a soundtrack in it, and the browser plays that through <audio>
// exactly as it would an .mp3. leaving those out made every such upload vanish from these pickers while
// the Events tab — which lists the whole folder — showed them fine.
const AUDIO_RE = /\.(mp3|wav|ogg|oga|m4a|aac|flac|mp4|m4v|webm)$/i;
export const SOUNDS = MEDIA_FILES.filter((f) => AUDIO_RE.test(f));

// the inputs one effect kind needs, rendered from its `needs` list so the editor can't offer a field the
// server would ignore. shared by the mystery box prizes and the drop rewards, which have the same effects.
const EffectFields: React.FC<{ prize: any; patchEffect: (id: string, p: any, key?: string) => void; events: any[]; textBoxes: any[] }> = ({ prize, patchEffect, events, textBoxes }) => {
	// one chant in a chant prize's list changed
	const patchChant = (id: string, i: number, p: any, key?: string) =>
		patchEffect(id, { chants: prize.effect.chants.map((c: any, j: number) => (j === i ? { ...c, ...p } : c)) }, key);

	const spec = EFFECT_KINDS.find((k) => k.key === prize.effect.kind) || EFFECT_KINDS[0];
	return (
		<VStack align="stretch" spacing={2} mt={2}>
			<Text fontSize="xs" color="gray.500">{spec.hint}</Text>
			<HStack spacing={2} wrap="wrap">
				{spec.needs.includes("rounds") && (
					<HStack spacing={1}>
						<NumberField
							width="80px"
							min={1}
							max={50}
							value={prize.effect.rounds}
							onCommit={(n) => patchEffect(prize.id, { rounds: n }, `rd${prize.id}`)}
						/>
						<Text fontSize="sm" color="gray.600">round{prize.effect.rounds === 1 ? "" : "s"}, each drawn from the list below</Text>
					</HStack>
				)}
				{spec.needs.includes("seconds") && (
					<HStack spacing={1}>
						<Text fontSize="sm" color="gray.600">
							{prize.effect.kind === "pauseTimer" ? "Pause for"
								: prize.effect.kind === "timebomb" ? "Each contribution buys"
								: prize.effect.kind === "textBox" ? "Hold for"
								: prize.effect.kind === "command" ? "Run after"
								: prize.effect.kind === "timeBoost" ? "for"
								: prize.effect.kind === "infection" ? "Spreads for"
								: prize.effect.kind === "schizo" ? "Reads chat for"
								: prize.effect.kind === "nuke" ? ""
								: prize.effect.kind === "raygun" ? ""
								: "Seconds"}
						</Text>
						<NumberField
							width="110px"
							min={0}
							max={86400}
							value={prize.effect.seconds}
							onCommit={(n) => patchEffect(prize.id, { seconds: n }, `sec${prize.id}`)}
						/>
						<Text fontSize="sm" color="gray.500">
							{prize.effect.seconds >= 60 ? `= ${countdown(prize.effect.seconds * 1000)}` : "sec"}
						</Text>
					</HStack>
				)}
				{spec.needs.includes("timeoutSeconds") && (
					<HStack spacing={1}>
						<Text fontSize="sm" color="gray.600">then the infected are timed out</Text>
						<NumberField
							width="100px"
							min={1}
							max={3600}
							value={prize.effect.timeoutSeconds}
							onCommit={(n) => patchEffect(prize.id, { timeoutSeconds: n }, `to${prize.id}`)}
						/>
						<Text fontSize="sm" color="gray.500">
							{prize.effect.timeoutSeconds >= 60 ? `sec = ${countdown(prize.effect.timeoutSeconds * 1000)}` : "sec"}
						</Text>
					</HStack>
				)}
				{spec.needs.includes("reward") && (
					<HStack spacing={1}>
						<Text fontSize="sm" color="gray.600">for</Text>
						<NumberField
							width="110px"
							min={0}
							max={86400}
							value={prize.effect.rewardSeconds}
							onCommit={(n) => patchEffect(prize.id, { rewardSeconds: n }, `rw${prize.id}`)}
						/>
						<Text fontSize="sm" color="gray.500">
							{prize.effect.rewardSeconds >= 60 ? `sec = +${countdown(prize.effect.rewardSeconds * 1000)}` : "sec on the timer"}
						</Text>
					</HStack>
				)}
				{spec.needs.includes("streak") && (
					<HStack spacing={1}>
						<Switch
							size="sm"
							isChecked={prize.effect.streak}
							onChange={(e) => patchEffect(prize.id, { streak: e.target.checked })}
						/>
						<Text fontSize="sm" color="gray.600">in a row</Text>
						<Text fontSize="xs" color="gray.500">(any other line resets the count)</Text>
					</HStack>
				)}
				{spec.needs.includes("factor") && (
					<HStack spacing={1}>
						<Text fontSize="sm" color="gray.600">Everything is worth</Text>
						<Text fontSize="sm" color="gray.500">x</Text>
						<NumberField
							width="80px"
							min={2}
							max={10}
							value={prize.effect.factor}
							onCommit={(n) => patchEffect(prize.id, { factor: n }, `f${prize.id}`)}
						/>
					</HStack>
				)}
				{spec.needs.includes("charges") && (
					<HStack spacing={1}>
						<Text fontSize="sm" color="gray.600">Gives</Text>
						<NumberField
							width="80px"
							min={1}
							max={99}
							value={prize.effect.charges}
							onCommit={(n) => patchEffect(prize.id, { charges: n }, `ch${prize.id}`)}
						/>
						<Text fontSize="sm" color="gray.500">shots, each</Text>
					</HStack>
				)}
				{spec.needs.includes("boxes") && (
					<HStack spacing={1}>
						<Text fontSize="sm" color="gray.600">Gives</Text>
						<NumberField
							width="80px"
							min={1}
							max={99}
							value={prize.effect.boxes}
							onCommit={(n) => patchEffect(prize.id, { boxes: n }, `bx${prize.id}`)}
						/>
						<Text fontSize="sm" color="gray.500">more boxes</Text>
					</HStack>
				)}
				{spec.needs.includes("percent") && (
					<HStack spacing={1}>
						<Text fontSize="sm" color="gray.600">Hits</Text>
						<NumberField
							width="80px"
							min={1}
							max={100}
							value={prize.effect.percent}
							onCommit={(n) => patchEffect(prize.id, { percent: n }, `pc${prize.id}`)}
						/>
						<Text fontSize="sm" color="gray.500">% of chat, for</Text>
					</HStack>
				)}
				{spec.needs.includes("eventId") && (
					<Select
						size="sm"
						maxW="260px"
						value={prize.effect.eventId}
						onChange={(e) => patchEffect(prize.id, { eventId: e.target.value })}
					>
						<option value="">(pick an event)</option>
						{events.map((ev) => (
							<option key={ev.id} value={ev.id}>{ev.name || ev.id}</option>
						))}
					</Select>
				)}
				{spec.needs.includes("box") && (
					<Select
						size="sm"
						maxW="200px"
						value={prize.effect.box}
						onChange={(e) => patchEffect(prize.id, { box: e.target.value })}
					>
						<option value="">(pick a text box)</option>
						{textBoxes.map((b) => (
							<option key={b.id} value={b.name || b.id}>{b.name || b.id}</option>
						))}
					</Select>
				)}
			</HStack>
			{spec.needs.includes("loopSound") && (
				<HStack spacing={2} wrap="wrap">
					<Text fontSize="sm" color="gray.600">Loop</Text>
					<Select
						size="sm"
						maxW="240px"
						value={prize.effect.loopSound}
						onChange={(e) => patchEffect(prize.id, { loopSound: e.target.value })}
					>
						<option value="">(no music)</option>
						{SOUNDS.map((f) => (
							<option key={f} value={f}>{f}</option>
						))}
					</Select>
					<Text fontSize="sm" color="gray.600">Vol</Text>
					<input
						type="range"
						min={0}
						max={1}
						step={0.05}
						value={prize.effect.loopVolume}
						onChange={(e) => patchEffect(prize.id, { loopVolume: Number(e.target.value) }, `lv${prize.id}`)}
					/>
					<Text fontSize="xs" color="gray.500">
						plays on the Mystery Box source for as long as it lasts
					</Text>
				</HStack>
			)}
			{spec.needs.includes("chants") && (
				<VStack align="stretch" spacing={1}>
					{prize.effect.chants.length === 0 && (
						<Text fontSize="xs" color="red.300">Nothing for chat to say yet — add a chant.</Text>
					)}
					{prize.effect.chants.map((c: any, i: number) => (
						<HStack key={i} spacing={2} wrap="wrap">
							<Text fontSize="sm" color="gray.600">Say</Text>
							<Input
								size="sm"
								maxW="180px"
								placeholder="movies"
								value={c.phrase}
								onChange={(e) => patchChant(prize.id, i, { phrase: e.target.value }, `cp${prize.id}${i}`)}
							/>
							<NumberField
								width="80px"
								min={1}
								max={10000}
								value={c.times}
								onCommit={(n) => patchChant(prize.id, i, { times: n }, `ct${prize.id}${i}`)}
							/>
							<Text fontSize="sm" color="gray.600">times within</Text>
							<NumberField
								width="80px"
								min={5}
								max={3600}
								value={c.seconds}
								onCommit={(n) => patchChant(prize.id, i, { seconds: n }, `cs${prize.id}${i}`)}
							/>
							<Text fontSize="sm" color="gray.600">sec</Text>
							<Button
								size="xs"
								variant="ghost"
								colorScheme="red"
								onClick={() => patchEffect(prize.id, { chants: prize.effect.chants.filter((_: any, j: number) => j !== i) })}
							>
								remove
							</Button>
						</HStack>
					))}
					<HStack>
						<Button
							size="xs"
							isDisabled={prize.effect.chants.length >= 20}
							onClick={() => patchEffect(prize.id, { chants: [...prize.effect.chants, { phrase: "", times: 20, seconds: 60 }] })}
						>
							Add chant
						</Button>
						{prize.effect.chants.length > 0 && prize.effect.chants.some((c: any) => !c.phrase.trim()) && (
							<Text fontSize="xs" color="gray.500">a chant with no words is dropped when it&apos;s saved</Text>
						)}
					</HStack>
				</VStack>
			)}
			{spec.needs.includes("track") && (
				<HStack spacing={2} wrap="wrap">
					<Text fontSize="sm" color="gray.600">Track</Text>
					<Select
						size="sm"
						maxW="280px"
						value={prize.effect.track}
						onChange={(e) => patchEffect(prize.id, { track: e.target.value })}
					>
						<option value="">(pick a track)</option>
						{SOUNDS.map((f) => (
							<option key={f} value={f}>{f}</option>
						))}
					</Select>
					<Text fontSize="sm" color="gray.600">Vol</Text>
					<input
						type="range"
						min={0}
						max={1}
						step={0.05}
						value={prize.effect.trackVolume}
						onChange={(e) => patchEffect(prize.id, { trackVolume: Number(e.target.value) }, `tv${prize.id}`)}
					/>
					<Text fontSize="xs" color="gray.500">plays once, start to finish, under whatever else happens</Text>
				</HStack>
			)}
			{spec.needs.includes("tts") && (
				<HStack spacing={2} wrap="wrap">
					<Text fontSize="sm" color="gray.600">Speed</Text>
					<input
						type="range"
						min={0.5}
						max={2}
						step={0.1}
						value={prize.effect.ttsRate}
						onChange={(e) => patchEffect(prize.id, { ttsRate: Number(e.target.value) }, `tr${prize.id}`)}
					/>
					<Text fontSize="xs" color="gray.500">{Number(prize.effect.ttsRate).toFixed(1)}x</Text>
					<Text fontSize="sm" color="gray.600">Pitch</Text>
					<input
						type="range"
						min={0}
						max={2}
						step={0.1}
						value={prize.effect.ttsPitch}
						onChange={(e) => patchEffect(prize.id, { ttsPitch: Number(e.target.value) }, `tp${prize.id}`)}
					/>
					<Text fontSize="xs" color="gray.500">{Number(prize.effect.ttsPitch).toFixed(1)}</Text>
					<Text fontSize="sm" color="gray.600">Vol</Text>
					<input
						type="range"
						min={0}
						max={1}
						step={0.05}
						value={prize.effect.ttsVolume}
						onChange={(e) => patchEffect(prize.id, { ttsVolume: Number(e.target.value) }, `tvol${prize.id}`)}
					/>
					<Checkbox
						size="sm"
						isChecked={!!prize.effect.sayNames}
						onChange={(e) => patchEffect(prize.id, { sayNames: e.target.checked })}
					>
						say who said it
					</Checkbox>
				</HStack>
			)}
			{spec.needs.includes("endSound") && (
				<HStack spacing={2} wrap="wrap">
					<Badge colorScheme="orange">WHEN IT ENDS</Badge>
					<Select
						size="sm"
						maxW="220px"
						value={prize.effect.failSound}
						onChange={(e) => patchEffect(prize.id, { failSound: e.target.value })}
					>
						<option value="">(sound: none)</option>
						{SOUNDS.map((f) => (
							<option key={f} value={f}>{f}</option>
						))}
					</Select>
					<input
						type="range"
						min={0}
						max={1}
						step={0.05}
						value={prize.effect.failVolume}
						onChange={(e) => patchEffect(prize.id, { failVolume: Number(e.target.value) }, `fv${prize.id}`)}
					/>
				</HStack>
			)}
			{spec.needs.includes("resultSounds") && (
				<HStack spacing={2} wrap="wrap">
					<Badge colorScheme="green">MADE IT</Badge>
					<Select
						size="sm"
						maxW="220px"
						value={prize.effect.winSound}
						onChange={(e) => patchEffect(prize.id, { winSound: e.target.value })}
					>
						<option value="">(sound: none)</option>
						{SOUNDS.map((f) => (
							<option key={f} value={f}>{f}</option>
						))}
					</Select>
					<input
						type="range"
						min={0}
						max={1}
						step={0.05}
						value={prize.effect.winVolume}
						onChange={(e) => patchEffect(prize.id, { winVolume: Number(e.target.value) }, `wv${prize.id}`)}
					/>
					<Badge colorScheme="red">TOO SLOW</Badge>
					<Select
						size="sm"
						maxW="220px"
						value={prize.effect.failSound}
						onChange={(e) => patchEffect(prize.id, { failSound: e.target.value })}
					>
						<option value="">(sound: none)</option>
						{SOUNDS.map((f) => (
							<option key={f} value={f}>{f}</option>
						))}
					</Select>
					<input
						type="range"
						min={0}
						max={1}
						step={0.05}
						value={prize.effect.failVolume}
						onChange={(e) => patchEffect(prize.id, { failVolume: Number(e.target.value) }, `fv${prize.id}`)}
					/>
				</HStack>
			)}
			{spec.needs.includes("freezeColor") && (
				<HStack spacing={2} wrap="wrap">
					<Text fontSize="sm" color="gray.600">Timer turns</Text>
					<input
						type="color"
						value={prize.effect.freezeColor || "#5bd5ff"}
						onChange={(e) => patchEffect(prize.id, { freezeColor: e.target.value }, `fc${prize.id}`)}
					/>
					{prize.effect.freezeColor ? (
						<>
							<HStack spacing={1}>
								<Switch
									size="sm"
									isChecked={prize.effect.freezePulse}
									onChange={(e) => patchEffect(prize.id, { freezePulse: e.target.checked })}
								/>
								<Text fontSize="sm" color="gray.600">pulse</Text>
							</HStack>
							<Button size="xs" variant="ghost" onClick={() => patchEffect(prize.id, { freezeColor: "" })}>
								leave it alone
							</Button>
						</>
					) : (
						<Text fontSize="xs" color="gray.500">not tinted — pick a colour to turn the digits while it holds</Text>
					)}
					<Text fontSize="xs" color="gray.500">
						{prize.effect.freezeColor
							? prize.effect.freezePulse
								? "the countdown beats between its normal colour and this one for as long as the freeze lasts"
								: "the countdown holds this colour for as long as the freeze lasts"
							: ""}
					</Text>
				</HStack>
			)}
			{spec.needs.includes("text") && (
				<Textarea
					size="sm"
					rows={2}
					placeholder="What the text box should say"
					value={prize.effect.text}
					onChange={(e) => patchEffect(prize.id, { text: e.target.value }, `txt${prize.id}`)}
				/>
			)}
			{spec.needs.includes("command") && (
				<Textarea
					size="sm"
					rows={3}
					fontFamily="mono"
					maxLength={1000}
					placeholder={"time 300\nmb give {user} 1"}
					value={prize.effect.command}
					onChange={(e) => patchEffect(prize.id, { command: e.target.value }, `cmd${prize.id}`)}
				/>
			)}
		</VStack>
	);
};

export default EffectFields;
