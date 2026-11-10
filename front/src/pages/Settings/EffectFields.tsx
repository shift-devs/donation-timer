import React from "react";
import { Badge, Box, Button, Checkbox, HStack, Input, Select, Switch, Text, Textarea, VStack } from "@chakra-ui/react";
import NumberField from "../../NumberField";
import { countdown, EFFECT_KINDS, prizeImageSrc } from "../../mysterybox";

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
			<Text fontSize="xs" color="subtle">{spec.hint}</Text>
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
						<Text fontSize="sm" color="muted">round{prize.effect.rounds === 1 ? "" : "s"}, each drawn from the list below</Text>
					</HStack>
				)}
				{spec.needs.includes("seconds") && (
					<HStack spacing={1}>
						<Text fontSize="sm" color="muted">
							{prize.effect.kind === "pauseTimer" ? "Pause for"
								: prize.effect.kind === "timebomb" ? "Each contribution buys"
								: prize.effect.kind === "textBox" ? "Hold for"
								: prize.effect.kind === "command" ? "Run after"
								: prize.effect.kind === "timeBoost" ? "for"
								: prize.effect.kind === "infection" ? "Spreads for"
								: prize.effect.kind === "schizo" ? "Reads chat for"
								: prize.effect.kind === "rollcall" ? "Runs for"
								: prize.effect.kind === "potato" || prize.effect.kind === "cup" || prize.effect.kind === "vote" || prize.effect.kind === "voteup" || prize.effect.kind === "weenie" ? "Runs for"
								: prize.effect.kind === "shell" ? "They get"
								: prize.effect.kind === "algebra" ? "Chat gets"
								: prize.effect.kind === "emp" ? "Boxes offline for"
								: prize.effect.kind === "emoteOnly" ? "Emote only for"
								: prize.effect.kind === "subOnly" ? "Sub only for"
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
						<Text fontSize="sm" color="subtle">
							{prize.effect.seconds >= 60 ? `= ${countdown(prize.effect.seconds * 1000)}` : "sec"}
						</Text>
					</HStack>
				)}
				{spec.needs.includes("timeoutSeconds") && (
					<HStack spacing={1}>
						<Text fontSize="sm" color="muted">
							{prize.effect.kind === "potato" ? "then whoever holds it is timed out"
								: prize.effect.kind === "vote" ? "then they're timed out"
								: "then the infected are timed out"}
						</Text>
						<NumberField
							width="100px"
							min={1}
							max={3600}
							value={prize.effect.timeoutSeconds}
							onCommit={(n) => patchEffect(prize.id, { timeoutSeconds: n }, `to${prize.id}`)}
						/>
						<Text fontSize="sm" color="subtle">
							{prize.effect.timeoutSeconds >= 60 ? `sec = ${countdown(prize.effect.timeoutSeconds * 1000)}` : "sec"}
						</Text>
					</HStack>
				)}
				{spec.needs.includes("answerSeconds") && (
					<HStack spacing={1}>
						<Text fontSize="sm" color="muted">each person called gets</Text>
						<NumberField
							width="80px"
							min={5}
							max={300}
							value={prize.effect.answerSeconds}
							onCommit={(n) => patchEffect(prize.id, { answerSeconds: n }, `as${prize.id}`)}
						/>
						<Text fontSize="sm" color="subtle">sec to answer</Text>
					</HStack>
				)}
				{spec.needs.includes("reward") && (
					<HStack spacing={1}>
						<Text fontSize="sm" color="muted">
							{prize.effect.kind === "rollcall" ? "each answer adds"
								: prize.effect.kind === "potato" ? "each pass adds"
								: prize.effect.kind === "weenie" ? "if nobody says it, adds"
								: prize.effect.kind === "algebra" ? "and solving it adds"
								: "for"}
						</Text>
						<NumberField
							width="110px"
							min={0}
							max={86400}
							value={prize.effect.rewardSeconds}
							onCommit={(n) => patchEffect(prize.id, { rewardSeconds: n }, `rw${prize.id}`)}
						/>
						<Text fontSize="sm" color="subtle">
							{prize.effect.rewardSeconds >= 60 ? `sec = +${countdown(prize.effect.rewardSeconds * 1000)}` : "sec on the timer"}
						</Text>
					</HStack>
				)}
				{spec.needs.includes("unique") && (
					<HStack spacing={1}>
						<Switch
							size="sm"
							isChecked={prize.effect.unique}
							onChange={(e) => patchEffect(prize.id, { unique: e.target.checked })}
						/>
						<Text fontSize="sm" color="muted">one per person</Text>
						<Text fontSize="xs" color="subtle">(the number is how many different chatters say it)</Text>
					</HStack>
				)}
				{spec.needs.includes("difficulty") && (
					<HStack spacing={1}>
						<Text fontSize="sm" color="muted">Difficulty</Text>
						<Select size="sm" maxW="300px" value={String(prize.effect.difficulty)} onChange={(e) => patchEffect(prize.id, { difficulty: Number(e.target.value) })}>
							<option value="1">1 — brackets, x on one side</option>
							<option value="2">2 — x on both sides</option>
							<option value="3">3 — brackets inside brackets</option>
						</Select>
					</HStack>
				)}
				{spec.needs.includes("shells") && (
					<HStack spacing={1}>
						<NumberField
							width="80px"
							min={2}
							max={10}
							value={prize.effect.shells}
							onCommit={(n) => patchEffect(prize.id, { shells: n }, `sh${prize.id}`)}
						/>
						<Text fontSize="sm" color="muted">shells (they pick 1 to {prize.effect.shells})</Text>
					</HStack>
				)}
				{spec.needs.includes("shellImage") && (
					<HStack spacing={2} wrap="wrap">
						<Text fontSize="sm" color="muted">Shell art</Text>
						{prize.effect.shellImage && (
							<Box w="40px" h="40px" borderWidth="1px" borderRadius="md" overflow="hidden" bg="panel">
								<img src={prizeImageSrc(prize.effect.shellImage)} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
							</Box>
						)}
						<Select
							size="sm"
							maxW="200px"
							value={PRIZE_IMAGES.includes(prize.effect.shellImage) ? prize.effect.shellImage : ""}
							onChange={(e) => patchEffect(prize.id, { shellImage: e.target.value })}
						>
							<option value="">(plain shells)</option>
							{PRIZE_IMAGES.map((f) => (
								<option key={f} value={f}>{f}</option>
							))}
						</Select>
						<Input
							size="sm"
							maxW="240px"
							placeholder="…or an image URL"
							value={PRIZE_IMAGES.includes(prize.effect.shellImage) ? "" : prize.effect.shellImage}
							onChange={(e) => patchEffect(prize.id, { shellImage: e.target.value }, `si${prize.id}`)}
						/>
						<Text fontSize="xs" color="subtle">each shell is drawn as this, with its number on top</Text>
					</HStack>
				)}
				{spec.needs.includes("topCount") && (
					<HStack spacing={1}>
						<Text fontSize="sm" color="muted">The top</Text>
						<NumberField
							width="80px"
							min={1}
							max={50}
							value={prize.effect.topCount}
							onCommit={(n) => patchEffect(prize.id, { topCount: n }, `tc${prize.id}`)}
						/>
						<Text fontSize="sm" color="muted">most-voted</Text>
					</HStack>
				)}
				{spec.needs.includes("streak") && (
					<HStack spacing={1}>
						<Switch
							size="sm"
							isChecked={prize.effect.streak}
							onChange={(e) => patchEffect(prize.id, { streak: e.target.checked })}
						/>
						<Text fontSize="sm" color="muted">in a row</Text>
						<Text fontSize="xs" color="subtle">(any other line resets the count)</Text>
					</HStack>
				)}
				{spec.needs.includes("factor") && (
					<HStack spacing={1}>
						<Text fontSize="sm" color="muted">Everything is worth</Text>
						<Text fontSize="sm" color="subtle">x</Text>
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
						<Text fontSize="sm" color="muted">{prize.effect.kind === "shield" ? "Blocks the next" : "Gives"}</Text>
						<NumberField
							width="80px"
							min={1}
							max={99}
							value={prize.effect.charges}
							onCommit={(n) => patchEffect(prize.id, { charges: n }, `ch${prize.id}`)}
						/>
						<Text fontSize="sm" color="subtle">{prize.effect.kind === "shield" ? "timeouts from the bot" : prize.effect.kind === "thundergun" ? "shots, 20 minutes each" : prize.effect.kind === "firstaid" ? "first aid kits" : prize.effect.kind === "fuckyougun" ? "shots, 24 hours each" : "shots, each"}</Text>
					</HStack>
				)}
				{spec.needs.includes("boxes") && (
					<HStack spacing={1}>
						<Text fontSize="sm" color="muted">Gives</Text>
						<NumberField
							width="80px"
							min={prize.effect.kind === "algebra" ? 0 : 1}
							max={99}
							value={prize.effect.boxes}
							onCommit={(n) => patchEffect(prize.id, { boxes: n }, `bx${prize.id}`)}
						/>
						<Text fontSize="sm" color="subtle">{prize.effect.kind === "cup" ? "boxes to whoever is it at the end" : prize.effect.kind === "voteup" ? "mystery boxes to the most-voted" : prize.effect.kind === "shell" ? "mystery boxes if they find it" : prize.effect.kind === "algebra" ? "mystery boxes to whoever solves it" : prize.effect.kind === "wonderBoxes" ? `wonder box${prize.effect.boxes === 1 ? "" : "es"}` : "more boxes"}</Text>
					</HStack>
				)}
				{spec.needs.includes("percent") && (
					<HStack spacing={1}>
						<Text fontSize="sm" color="muted">Hits</Text>
						<NumberField
							width="80px"
							min={1}
							max={100}
							value={prize.effect.percent}
							onCommit={(n) => patchEffect(prize.id, { percent: n }, `pc${prize.id}`)}
						/>
						<Text fontSize="sm" color="subtle">% of chat, for</Text>
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
			{spec.needs.includes("bombGoal") && (
				<HStack spacing={2} wrap="wrap">
					<Text fontSize="sm" color="muted">Keep it alive</Text>
					<NumberField
						width="100px"
						min={0}
						max={86400}
						value={prize.effect.bombGoalSec}
						onCommit={(n) => patchEffect(prize.id, { bombGoalSec: n }, `bg${prize.id}`)}
					/>
					<Text fontSize="sm" color="subtle">
						{prize.effect.bombGoalSec > 0 ? `sec${prize.effect.bombGoalSec >= 60 ? ` = ${countdown(prize.effect.bombGoalSec * 1000)}` : ""} and chat earns` : "sec for a reward (0 = no reward)"}
					</Text>
					{prize.effect.bombGoalSec > 0 && (<>
						<Select
							size="sm"
							maxW="150px"
							value={prize.effect.bombReward}
							onChange={(e) => patchEffect(prize.id, { bombReward: e.target.value })}
						>
							<option value="time">time on the timer</option>
							<option value="boxes">boxes for the opener</option>
						</Select>
						{prize.effect.bombReward === "boxes" ? (
							<HStack spacing={1}>
								<NumberField
									width="80px"
									min={1}
									max={99}
									value={prize.effect.boxes}
									onCommit={(n) => patchEffect(prize.id, { boxes: n }, `bbx${prize.id}`)}
								/>
								<Text fontSize="sm" color="subtle">boxes</Text>
							</HStack>
						) : (
							<HStack spacing={1}>
								<NumberField
									width="110px"
									min={0}
									max={86400}
									value={prize.effect.rewardSeconds}
									onCommit={(n) => patchEffect(prize.id, { rewardSeconds: n }, `brw${prize.id}`)}
								/>
								<Text fontSize="sm" color="subtle">
									{prize.effect.rewardSeconds >= 60 ? `sec = +${countdown(prize.effect.rewardSeconds * 1000)}` : "sec"}
								</Text>
							</HStack>
						)}
					</>)}
				</HStack>
			)}
			{spec.needs.includes("loopSound") && (
				<HStack spacing={2} wrap="wrap">
					<Text fontSize="sm" color="muted">Loop</Text>
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
					<Text fontSize="sm" color="muted">Vol</Text>
					<input
						type="range"
						min={0}
						max={1}
						step={0.05}
						value={prize.effect.loopVolume}
						onChange={(e) => patchEffect(prize.id, { loopVolume: Number(e.target.value) }, `lv${prize.id}`)}
					/>
					<Text fontSize="xs" color="subtle">
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
							<Text fontSize="sm" color="muted">Say</Text>
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
							<Text fontSize="sm" color="muted">{prize.effect.unique ? "people within" : "times within"}</Text>
							<NumberField
								width="80px"
								min={5}
								max={3600}
								value={c.seconds}
								onCommit={(n) => patchChant(prize.id, i, { seconds: n }, `cs${prize.id}${i}`)}
							/>
							<Text fontSize="sm" color="muted">sec</Text>
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
							<Text fontSize="xs" color="subtle">a chant with no words is dropped when it&apos;s saved</Text>
						)}
					</HStack>
				</VStack>
			)}
			{spec.needs.includes("phrases") && (
				<VStack align="stretch" spacing={1}>
					<Text fontSize="sm" color="muted">
						{prize.effect.kind === "weenie"
							? "The phrase nobody may say — one per line, one drawn each time it lands"
							: "What they have to say — one per line, one drawn for each person called"}
					</Text>
					<Textarea
						size="sm"
						rows={2}
						placeholder={prize.effect.kind === "weenie" ? "hot dog\nweenie" : "here\npresent"}
						value={prize.effect.phrases.join("\n")}
						onChange={(e) => patchEffect(prize.id, { phrases: e.target.value.split("\n") }, `ph${prize.id}`)}
					/>
					{prize.effect.phrases.filter((p: string) => p.trim()).length === 0 && (
						<Text fontSize="xs" color="red.300">Nothing to answer with yet — add a phrase.</Text>
					)}
				</VStack>
			)}
			{spec.needs.includes("track") && (
				<HStack spacing={2} wrap="wrap">
					<Text fontSize="sm" color="muted">Track</Text>
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
					<Text fontSize="sm" color="muted">Vol</Text>
					<input
						type="range"
						min={0}
						max={1}
						step={0.05}
						value={prize.effect.trackVolume}
						onChange={(e) => patchEffect(prize.id, { trackVolume: Number(e.target.value) }, `tv${prize.id}`)}
					/>
					<Text fontSize="xs" color="subtle">plays once, start to finish, under whatever else happens</Text>
				</HStack>
			)}
			{spec.needs.includes("tts") && (
				<HStack spacing={2} wrap="wrap">
					<Text fontSize="sm" color="muted">Speed</Text>
					<input
						type="range"
						min={0.5}
						max={2}
						step={0.1}
						value={prize.effect.ttsRate}
						onChange={(e) => patchEffect(prize.id, { ttsRate: Number(e.target.value) }, `tr${prize.id}`)}
					/>
					<Text fontSize="xs" color="subtle">{Number(prize.effect.ttsRate).toFixed(1)}x</Text>
					<Text fontSize="sm" color="muted">Pitch</Text>
					<input
						type="range"
						min={0}
						max={2}
						step={0.1}
						value={prize.effect.ttsPitch}
						onChange={(e) => patchEffect(prize.id, { ttsPitch: Number(e.target.value) }, `tp${prize.id}`)}
					/>
					<Text fontSize="xs" color="subtle">{Number(prize.effect.ttsPitch).toFixed(1)}</Text>
					<Text fontSize="sm" color="muted">Vol</Text>
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
			{spec.needs.includes("winSound") && (
				<HStack spacing={2} wrap="wrap">
					<Badge colorScheme="green">WHEN IT ENDS</Badge>
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
					<Text fontSize="sm" color="muted">Timer turns</Text>
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
								<Text fontSize="sm" color="muted">pulse</Text>
							</HStack>
							<Button size="xs" variant="ghost" onClick={() => patchEffect(prize.id, { freezeColor: "" })}>
								leave it alone
							</Button>
						</>
					) : (
						<Text fontSize="xs" color="subtle">not tinted — pick a colour to turn the digits while it holds</Text>
					)}
					<Text fontSize="xs" color="subtle">
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
