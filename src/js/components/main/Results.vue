<template>
	<div v-if="show" class="z-10 bg-nis-dark absolute bottom-0 left-0 right-0 p-4 text-white">

		<button class="absolute text-white border border-white p-1" @click="hide" style="top: 5px; right: 5px;">Hide</button>

		<p>Captain : {{ $root.result.captain.name }}</p>

		<div class="flex items-center justify-between mt-2">
			<p class="text-3xl">{{ $root.result.success_chance }}%</p>
			<img :src="member.type.image" alt="" v-for="member in $root.result.crew">
		</div>

		<p class="text-sm mt-1" v-if="$root.result.solidarity">
			Solidarity +{{ $root.result.solidarity }} &mdash; put the {{ $root.result.solidarity_bearer }} in the first crew slot
		</p>

		<div class="flex items-center mt-2">
			<button class="text-white border border-white p-1" @click.prevent="toggleFind">
				{{ finding ? 'Stop pointing' : 'Find on screen' }}
			</button>
			<span class="ml-3 text-sm opacity-75">{{ message }}</span>
		</div>

		<div v-if="finding" class="text-xs opacity-75 mt-1">
			<p>Wants: {{ looking }}</p>
			<p>Hover the ship's row as well, to pin down which of them are already aboard.</p>

			<p v-if="absent.length" class="mt-1">
				No {{ absent.join(' and no ') }} anywhere in the roster.
				A crew member away on a voyage is taken out of it, and the calculator only leaves out the ones marked
				<em>Sent on ship</em> &mdash; so mark whoever is at sea and calculate again to pick from who is actually here.
				<span v-if="unrecognised">
					({{ unrecognised }} tiles could not be recognised, so try <em>Read roster</em> first in case they are there after all.)
				</span>
			</p>

			<p v-for="line in notes">{{ line }}</p>
		</div>

		<div class="mt-2 flex justify-between items-end">
			<div class="w-1/2">
				<p>{{ $root.result.parts.ram.name }}</p>
				<p>{{ $root.result.parts.deckItem1.name }}</p>
				<p>{{ $root.result.parts.deckItem2.name }}</p>
				<p>{{ $root.result.parts.hull.name }}</p>
			</div>

			<div class="w-1/2 flex items-center justify-end">
				<span class="text-sm">Sent on ship :</span>

				<div class="flex ml-2">
					<button class="text-white border border-white w-6 h-6 text-sm rounded-full mr-1" @click="assignToShip(1)">1</button>
					<button class="text-white border border-white w-6 h-6 text-sm rounded-full mr-1" @click="assignToShip(2)">2</button>
					<button class="text-white border border-white w-6 h-6 text-sm rounded-full mr-1" @click="assignToShip(3)">3</button>
					<button class="text-white border border-white w-6 h-6 text-sm rounded-full" @click="assignToShip(4)">4</button>
				</div>
			</div>
		</div>
	</div>
</template>

<script>
	import RosterScanner from '../../ports/scripts/RosterScanner.js';
	import { crewReader, rosterScanner } from '../../ports/scripts/readers.js';

	export default {
		data(){
			return {
				show: false,

				// Pointing runs until it is stopped, because clicking a crew
				// member rearranges the roster underneath it
				finding: false,
				timer: null,
				message: '',

				// Tiles settled by hovering them, who is on the ship's row, and
				// the roster layout those answers were true of
				confirmed: {},
				onShip: {},
				identified: {},
				steady: {},
				hovering: null,

				// Crew watched going aboard: settled under the mouse, and gone
				// from the roster the moment it reflowed. The ship's row cannot
				// say which of several identical crew is up there, and this is
				// the only thing on screen that ever knew
				sailed: [],

				pending: null,
				agreeing: 0,
				lastReport: '',
				lastWhy: '',
				layout: {},

				// What the voyage is after, and the last few things hovering
				// settled — on screen, because a console object is no use to
				// anyone reading it off a screenshot
				looking: '',
				notes: [],
				warned: false,

				// Crew the voyage was calculated on that are not on screen at
				// all. Worth a line of its own rather than a clause in the
				// summary: there is nothing to hover and nothing to click, so
				// the only way forward is off the roster entirely.
				absent: [],

				// How many tiles the portraits could not name, which decides
				// whether "not on screen" can be stated flatly or has to allow
				// for their being there and simply unrecognised
				unrecognised: 0,
			}
		},

		mounted(){
			window.events.$on('result-calculated', data => {
				this.$root.selected = null;
				this.show = true;
				this.stopFinding();
			});
		},

		beforeDestroy(){
			this.stopFinding();
		},

		methods: {
			toggleFind(){
				return this.finding ? this.stopFinding() : this.startFinding();
			},

			/**
			 * Keep boxes on the crew this voyage still needs
			 *
			 * One pass would not survive the first click. Clicking an unassigned
			 * crew member in this interface puts them on the ship, which floats
			 * them into the top row and shuffles everyone behind them along, so
			 * where the remaining picks are sitting changes every time you take
			 * one. Re-reading a few times a second means the boxes describe the
			 * roster as it is rather than as it was.
			 *
			 * @return {void}
			 */
			startFinding(){
				if(this.finding){return;}

				this.finding = true;
				this.message = 'Reading the portraits…';
				this.confirmed = {};
				this.onShip = {};
				this.identified = {};
				this.steady = {};
				this.hovering = null;
				this.sailed = [];
				this.pending = null;
				this.agreeing = 0;
				this.lastReport = '';
				this.layout = {};
				this.notes = [];
				this.warned = false;
				this.absent = [];
				this.unrecognised = 0;

				// What the voyage is actually asking for. If a level here does
				// not match anything in the roster, the picks are describing
				// crew as they were before the roster last moved, and
				// recalculating after a sweep is what puts that right.
				this.looking = this.$root.result.crew
					.filter(member => member.type && member.type.name)
					.map(member => `${member.type.name} lvl ${this.levelOf(member) || '?'}`)
					.join(', ');

				console.log(`Pointing  looking for: ${this.looking}`);

				rosterScanner().prepare().then(() => {
					if(!this.finding){return;}

					this.point();
					this.timer = setInterval(this.point, 250);
				});
			},

			stopFinding(){
				this.finding = false;
				this.message = '';
				this.absent = [];
				this.unrecognised = 0;

				if(this.timer){
					clearInterval(this.timer);
					this.timer = null;
				}
			},

			/**
			 * One pass: read the roster, box whatever is still to be clicked
			 * @return {void}
			 */
			point(){
				let picks = this.$root.result.crew
					.filter(member => member.type && member.type.name && member.type.name !== 'Empty')
					.map(member => ({
						type: member.type.name,
						level: this.levelOf(member),
						morale: member.morale,
						combat: member.combat,
						seafaring: member.seafaring,
					}));

				if(!picks.length){
					this.message = 'Nothing to find';
					return this.stopFinding();
				}

				let scanner = rosterScanner();
				let scan = scanner.scan(this.candidates());

				if(!scan){
					return this.message = 'Open the ship\'s crew interface';
				}

				// Anything settled by hovering only holds while the roster stands
				// still. Clicking a crew member onto the ship shuffles everyone
				// behind them, and an answer about a tile is worthless once
				// somebody else is in it.
				//
				// But a tile dropping out because the mouse is over it is not the
				// roster moving. Comparing the whole grid as one string made
				// every hover look like a reflow and wiped the answer the hover
				// had just produced — so the same crew member had to be hovered
				// again and again. Only a tile that is recognised as somebody
				// *different* counts as movement.
				//
				// The two halves of the grid move for different reasons, so they
				// are watched apart. A reflow of the roster leaves the ship's row
				// alone — the crew already up there keep their slots — and wiping
				// what hovering had established about them threw the answer away
				// on every single click, which is the one moment it is needed.
				let moved = false;
				let named = {};
				let shifted = [];

				scan.tiles.forEach(tile => {
					if(!tile.type){return;}

					let key = `${tile.column},${tile.row}`;

					named[key] = tile.type;

					if(!this.layout[key] || this.layout[key] === tile.type){return;}

					if(tile.row === 1){shifted.push({key: key, was: this.layout[key], now: tile.type});}
					else {moved = true;}
				});

				// A roster tile settled under the mouse and swept out from under
				// it has been clicked, and clicking is what puts somebody on the
				// ship. Nothing up there says which of several identical crew
				// went — a portrait in the ship's row gives a type and no level —
				// so without this the app forgets the very crew member it had
				// just identified for you, the instant you act on what it said.
				if(moved && this.hovering && this.hovering.row >= 2 && Number(this.hovering.level)){
					this.sailed.push({type: this.hovering.type, level: Number(this.hovering.level)});
					this.note(`${this.hovering.type} level ${this.hovering.level} has gone aboard`);
				}

				if(moved){
					this.layout = named;
					this.confirmed = {};

					// The ship's row is not what moved, so what it has said about
					// itself still holds
					this.identified = this.aboutTheShip(this.identified);

					// Whoever was under the mouse may not be there any more
					this.hovering = null;
				} else {
					this.layout = Object.assign({}, this.layout, named);
				}

				// A ship slot that now reads as somebody else has emptied of
				// whoever we had in it, deductions included
				shifted.forEach(change => {
					delete this.onShip[change.key];
					delete this.identified[change.key];
					delete this.steady[change.key];

					if(change.now !== 'Empty'){return;}

					let at = this.sailed.findIndex(gone => gone.type === change.was);

					if(at !== -1){this.sailed.splice(at, 1);}
				});

				// Read the panel before matching, not after. The tile under the
				// mouse carries the hover glow, which can put its portrait out
				// of reach — so the crew member being looked at was the one
				// dropping out of the scan, and the boxes flickered as the mouse
				// moved along them. The panel has just named that tile anyway.
				let seen = this.readHovered(scan);

				// Anyone the panel has named stays named, for as long as the
				// roster holds still. The glow comes and goes with the mouse and
				// took the tile out of the scan with it every time, so a tile
				// being looked at was the one tile nothing could be said about —
				// and the settling that would have restored it needs three ticks
				// during which it is missing.
				if(seen && seen.where.column >= 2){
					this.identified[seen.key] = {type: seen.type, level: Number(seen.level) || null};
				}

				scan.tiles.forEach(held => {
					if(held.type){return;}

					let known = this.identified[`${held.column},${held.row}`];

					if(!known){return;}

					held.type = known.type;
					held.level = held.level || known.level;
				});

				this.attribute(scan);

				let found = scanner.find(scan, picks, RosterScanner.aboard(scan, this.onShip));

				found.room = RosterScanner.room(scan, this.onShip);

				// Telling you to take a crew member off is the one instruction
				// that costs you if it is wrong — a wrong click each way, and
				// the roster reshuffles both times. So it waits for the tile to
				// hold still. 5,1 read Empty, then unrecognised, then a Catherby
				// Fisherman across three ticks with nothing touching it, and the
				// instant it read as somebody it was declared surplus.
				scan.tiles.forEach(tile => {
					if(tile.row !== 1){return;}

					let key = `${tile.column},${tile.row}`;
					let held = this.steady[key];

					if(held && held.type === (tile.type || '')){held.ticks++;}
					else {this.steady[key] = {type: tile.type || '', ticks: 1};}
				});

				found.spares = found.spares.filter(spare => {
					if(spare.certain){return true;}

					let held = this.steady[`${spare.tile.column},${spare.tile.row}`];

					return held && held.ticks >= 4;
				});

				this.judge(found, seen);

				found.marks.forEach(mark => {
					mark.verdict = this.confirmed[`${mark.tile.column},${mark.tile.row}`];
				});

				if(!found.marks.length && !found.missing.length && !found.spares.length){
					this.message = 'All aboard — nothing left to click';
					return this.stopFinding();
				}

				scanner.show(found.marks, 0.7, found.spares);

				this.report(scan, found);

				this.absent = found.missing.map(name => this.describe(name, found));
				this.unrecognised = found.unknown;

				this.message = this.summarise(found);
			},

			/**
			 * Settle an ambiguous tile by hovering it
			 *
			 * A portrait names a crew type and nothing finer, so four
			 * Travelling Drunks are four identical answers. The Compare block
			 * has no such trouble — it knows exactly who the mouse is over,
			 * level and all — so simply moving across the candidates turns each
			 * one green or red as you reach it, with nothing to click and
			 * nothing put on the ship by mistake.
			 *
			 * @param  {object} scan
			 * @param  {object} found
			 * @return {void}
			 */
			readHovered(scan){
				let reader = crewReader();
				let tile = scan.location.skin.grid.tile;

				let where = RosterScanner.tileAt(
					scan.location.gridX, scan.location.gridY, tile, a1lib.mousePosition()
				);

				this.releaseHover(scan, where);

				if(!where || where.column < 2){return null;}

				let key = `${where.column},${where.row}`;
				let onShip = where.row === 1;

				// Every hovered crew tile is read, not only ones already boxed.
				// Skipping the rest meant a tile the portrait could not place
				// stayed unplaced even while the panel was naming it.
				if(!reader.read(scan.location)){return null;}

				let result = reader.result;

				if(!result.type.found || !result.type.name || result.type.name === 'captain'){return null;}

				// The panel lags the mouse, so a reading taken mid-move belongs
				// to the tile just left rather than the one arrived at. Without
				// this the same ship tile reported a Brimhaven Pirate one moment
				// and an empty slot the next, and the count of who was aboard
				// flapped with it.
				let settled = `${key}:${result.type.name}:${result.level}`;

				if(settled !== this.pending){
					this.pending = settled;
					this.agreeing = 1;
					return null;
				}

				this.agreeing++;

				// Two agreeing reads was not enough. The panel can lag the mouse
				// by longer than that, and a stale reading holds still while it
				// does — which is how a tile holding a First Mate was recorded
				// as an empty slot, twice running, and then learned as one.
				if(this.agreeing < 3){return null;}

				// Noted for releaseHover, which captures it once the mouse has
				// moved off and taken the hover glow with it
				this.hovering = {column: where.column, row: where.row, type: result.type.name, level: result.level};

				let level = Number(result.level);

				// Hovering the ship's own row says which of several identical
				// crew is the one already up there, which is the difference
				// between striking the right level off the wanted list and
				// sending you after somebody who has already sailed.
				if(onShip){
					let held = this.onShip[key];
					let news = !held || held.type !== result.type.name || held.level !== level;

					// Written every time, not only when it is news: a seat worked
					// out from watching them go aboard reads the same as this one
					// but is held less firmly, and having now been looked at it
					// should be held as firmly as anything else up there.
					this.onShip[key] = {type: result.type.name, level: level};

					if(news){
						this.note(`${key} aboard: ${result.type.name} level ${result.level}`);
					}
				}

				return {
					where: where, key: key,
					type: result.type.name,
					level: result.level,
					morale: result.morale,
					combat: result.combat,
					seafaring: result.seafaring,
				};
			},

			/**
			 * Only what was said about the ship's own row
			 * @param  {object} answers  keyed "column,row"
			 * @return {object}
			 */
			aboutTheShip(answers){
				let kept = {};

				Object.keys(answers).forEach(key => {
					if(key.split(',')[1] === '1'){kept[key] = answers[key];}
				});

				return kept;
			},

			/**
			 * Sit the crew we watched go aboard in the ship's row
			 *
			 * A portrait up there names a type and stops, so a voyage wanting two
			 * Brimhaven Pirates at different levels cannot tell which of them is
			 * already sailing. Both candidates in the roster then sit amber for
			 * ever, each one answering "one of these" and neither "this one" —
			 * and every hover spent on them is spent on the wrong tile, because
			 * the one that could answer is up in the ship's row.
			 *
			 * Hovering it settles that. So does having watched them go. A hover
			 * still wins where the two disagree, being a reading rather than a
			 * deduction, and a deduced seat never carries the certainty that
			 * would let it tell you to take somebody off without settling first.
			 *
			 * @param  {object} scan
			 * @return {void}
			 */
			attribute(scan){
				if(!this.sailed.length){return;}

				let row = scan.tiles.filter(tile => tile.row === 1);
				let seatOf = tile => this.onShip[`${tile.column},${tile.row}`];

				// A deduced seat gives way to anything the screen says outright
				row.forEach(tile => {
					let key = `${tile.column},${tile.row}`;
					let seen = seatOf(tile);

					if(!seen || !seen.deduced){return;}

					// The slot has emptied, so they are not up there after all —
					// taken off again, most likely. A slot that merely cannot be
					// recognised says nothing either way and is left alone.
					if(tile.type === 'Empty'){
						delete this.onShip[key];

						let at = this.sailed.findIndex(gone => gone.type === seen.type
							&& Number(gone.level) === Number(seen.level));

						if(at !== -1){this.sailed.splice(at, 1);}

						return;
					}

					// Hovering has found that same crew member in a slot of their
					// own. A reading outranks a deduction, and leaving both would
					// count one crew member aboard as two.
					let read = row.some(other => {
						let held = seatOf(other);

						return held && !held.deduced && held.type === seen.type
							&& Number(held.level) === Number(seen.level);
					});

					if(read){delete this.onShip[key];}
				});

				// Never claim more of the ship than the ship is holding. Counted
				// off the screen and off hovering only — a deduced seat propping
				// up the count that justifies it would never let itself go.
				let held = row.filter(tile => {
					let seen = seatOf(tile);

					return ((seen && !seen.deduced) ? seen.type : tile.type) !== 'Empty';
				}).length;

				if(this.sailed.length > held){
					this.sailed = this.sailed.slice(this.sailed.length - held);
				}

				// Anyone the ship's row already accounts for needs no seat of
				// their own, or they would be counted aboard twice over
				let spoken = row.map(seatOf).filter(seen => seen);

				this.sailed.forEach(gone => {
					let at = spoken.findIndex(seen => seen.type === gone.type
						&& Number(seen.level) === Number(gone.level));

					if(at !== -1){return spoken.splice(at, 1);}

					let free = row.filter(tile => !seatOf(tile));

					// Their own portrait first, a slot nobody could name second.
					// The ship's row draws its tiles differently enough that most
					// crew have to be seen up there before they are recognised
					// there, so unrecognised is what an arrival usually looks like.
					let seat = free.find(tile => tile.type === gone.type)
						|| free.find(tile => !tile.type);

					if(!seat){return;}

					this.onShip[`${seat.column},${seat.row}`] = {
						type: gone.type, level: gone.level, deduced: true,
					};
				});
			},

			/**
			 * Turn a settled hover into a verdict on the tile it names
			 * @param  {object} found
			 * @param  {object|null} seen
			 * @return {void}
			 */
			judge(found, seen){
				if(!seen || seen.where.row === 1){return;}

				let key = seen.key;

				let mark = found.marks.find(m => !m.certain
					&& m.tile.column === seen.where.column && m.tile.row === seen.where.row);

				// Nothing is asking about this tile, or it is already settled
				if(!mark){return this.why(key, 'no box is asking about it');}

				// The panel is showing something else, most likely because the
				// mouse has moved on since. Better no answer than a wrong one.
				if(seen.type !== mark.type){
					return this.why(key, `panel says ${seen.type}, the box says ${mark.type}`);
				}

				let wanted = mark.levels.map(Number).filter(Boolean);

				// Nothing to judge against. Calling this "not this one" would be
				// a verdict on a question never asked, and it put a red cross
				// through every candidate on screen.
				if(!wanted.length){
					if(!this.warned){
						this.warned = true;
						this.note('no level recorded for the crew this voyage wants'
							+ ' — sweep the roster with every ship home, then calculate again');
					}

					return;
				}

				// The level narrows the field; the stats settle it. Two crew of
				// one type at one level are not the same crew member — personal
				// bonuses differ, and the voyage was calculated on one of them.
				let match = (mark.crew || []).find(pick => this.sameCrew(pick, seen));

				// This crew member answers one of the picks, but not which one.
				// Another of their type is already aboard and could not be put a
				// level to, so one of the picks is already satisfied and it is
				// not known which — and calling this "this one" would send you
				// after the crew member who has already sailed just as readily
				// as the one still wanted.
				//
				// Ruling a tile out stays sound in the same position: matching
				// none of the picks means none of them, whichever is outstanding.
				if(match && mark.ambiguous){
					delete this.confirmed[key];

					return this.why(key, `one of the ${mark.type}s the voyage wants is already aboard`
						+ ` — hover the one on the ship to say which of these is still needed`);
				}

				let verdict = !!match;

				if(this.confirmed[key] !== verdict){
					this.note(`${key} is a ${mark.type} level ${seen.level}`
						+ ` ${seen.morale}/${seen.combat}/${seen.seafaring}`
						+ ` — ${verdict ? 'this one' : 'not this one'}`);
				}

				this.confirmed[key] = verdict;
			},

			/**
			 * Learn a tile's portrait once the mouse has moved off it
			 *
			 * The ship's own row draws its tiles differently enough that a crew
			 * member has to be seen there before being recognised there, and a
			 * sweep can only ever capture whoever happened to be aboard at the
			 * time. Everyone you send up there afterwards arrives unrecognised.
			 *
			 * Hovering names them, so pointing can learn them too — off the
			 * hover, once the glow has gone, exactly as a sweep does.
			 *
			 * @param  {object} scan
			 * @param  {object|null} where  the tile the mouse is on now
			 * @return {void}
			 */
			releaseHover(scan, where){
				let last = this.hovering;

				if(!last){return;}
				if(where && where.column === last.column && where.row === last.row){return;}

				this.hovering = null;

				let scanner = rosterScanner();
				let tile = scan.location.skin.grid.tile;
				let buffer = scanner.captureAt(scan.location.gridX, scan.location.gridY, tile);

				if(!buffer){return;}

				let signature = scanner.signature(buffer, last.column, last.row, tile);

				// An empty slot is bundled art and never needs learning, and it
				// is the reading a lagging panel is most likely to still be
				// showing — so learning it here can only ever teach a crew
				// member's face as an empty slot.
				if(last.type !== 'Empty' && signature && scanner.remember(last.type, signature)){
					this.note(`learned what a ${last.type} looks like at ${last.column},${last.row}`);
				}

				// And which of several identical crew this one is, so the next
				// scan can tell them apart without being hovered at all
				let corner = scanner.corner(buffer, last.column, last.row, tile);

				if(scanner.rememberBadge(last.type, last.level, corner)){
					this.note(`learned the level ${last.level} badge for a ${last.type}`);
				}
			},

			/**
			 * Print the whole decision, once, whenever it changes
			 *
			 * Every round of this has been spent inferring which half was wrong
			 * from a count of green boxes. The counts are downstream of three
			 * things — who the ship's row holds, which picks that satisfies, and
			 * what is left to find — and none of them were visible.
			 *
			 * @param  {object} scan
			 * @param  {object} found
			 * @return {void}
			 */
			report(scan, found){
				let lines = ['Pointing report'];

				lines.push('  ship row:');

				scan.tiles.filter(tile => tile.row === 1).forEach(tile => {
					let key = `${tile.column},${tile.row}`;
					let seen = this.onShip[key];
					let entry = (found.aboard || []).find(a => a.tile
						&& a.tile.column === tile.column && a.tile.row === tile.row);

					lines.push(`    ${key}  portrait ${(tile.type || '(unrecognised)').padEnd(22)}`
						+ ` hovered ${(seen ? `${seen.type} lvl ${seen.level}` : '-').padEnd(28)}`
						+ ` ${entry ? (entry.matched ? 'counts against a pick' : 'SURPLUS') : 'not counted aboard'}`);
				});

				lines.push('  picks still wanted after that:');

				let wanted = found.wanted || {};

				if(!Object.keys(wanted).length){
					lines.push('    (none)');
				} else {
					Object.keys(wanted).forEach(name => {
						lines.push(`    ${name} x${wanted[name].count}`
							+ (wanted[name].levels.length ? `  levels ${wanted[name].levels.join(', ')}` : '  (no level recorded)'));
					});
				}

				lines.push('  roster tiles boxed:');

				if(!found.marks.length){
					lines.push('    (none)');
				} else {
					found.marks.forEach(mark => {
						lines.push(`    ${mark.tile.column},${mark.tile.row}  ${mark.type.padEnd(22)}`
							+ ` tile level ${String(mark.tile.level || '-').padEnd(4)}`
							+ ` ${mark.certain ? 'green' : (mark.verdict === true ? 'green (hovered)' : mark.verdict === false ? 'red (hovered)' : 'amber')}`
							+ (mark.crew && mark.crew.length ? `  wants ${mark.crew.map(c => `lvl ${c.level} ${c.morale}/${c.combat}/${c.seafaring}`).join(' or ')}` : '')
							+ (mark.levels.length ? `  wants ${mark.levels.join(' or ')}` : ''));
					});
				}

				if(found.spares.length){
					lines.push('  aboard but not wanted:');
					found.spares.forEach(s => lines.push(`    ${s.tile.column},${s.tile.row}  ${s.type} lvl ${s.level || '-'}`));
				}

				let text = lines.join('\n');

				if(text === this.lastReport){return;}

				this.lastReport = text;
				console.log(text);
			},

			/**
			 * Name a crew type the way the voyage asked for it
			 *
			 * "Stowaway, Stowaway" says nothing about which two, and the levels
			 * are the whole of what you need to go looking for them.
			 *
			 * @param  {string} name
			 * @param  {object} found
			 * @return {string}
			 */
			describe(name, found){
				let want = (found.wanted || {})[name];

				if(!want){return name;}

				let levels = (want.levels || []).slice().sort((a, b) => a - b);

				if(!levels.length){return want.count > 1 ? `${name} x${want.count}` : name;}

				return `${name} lvl ${levels.join(' and ')}`;
			},

			/**
			 * Say why a hover produced no verdict, once per reason
			 * @param  {string} key
			 * @param  {string} reason
			 * @return {void}
			 */
			why(key, reason){
				let said = `${key}: ${reason}`;

				if(this.lastWhy === said){return;}

				this.lastWhy = said;
				this.note(`hovered ${said}`);
			},

			/**
			 * Put a line where it can be read without opening a console
			 * @param  {string} line
			 * @return {void}
			 */
			note(line){
				console.log('Pointing  ' + line);

				this.notes.unshift(line);
				this.notes = this.notes.slice(0, 4);
			},

			/**
			 * Is this the very crew member the voyage was calculated on?
			 *
			 * Type and level are not enough. Two Stowaways both at level 3 sat
			 * at 0/91/40 and 0/141/30 — fifty combat between them, and a
			 * different voyage depending which one sails. The stats are the only
			 * thing that tells them apart, and the panel gives them.
			 *
			 * Where the roster never recorded stats there is nothing to compare,
			 * so the level is allowed to answer alone rather than refusing every
			 * candidate.
			 *
			 * @param  {object} pick   what the calculator chose
			 * @param  {object} seen   what the panel is showing
			 * @return {boolean}
			 */
			sameCrew(pick, seen){
				if(Number(pick.level) !== Number(seen.level)){return false;}

				let stats = ['morale', 'combat', 'seafaring'];
				let recorded = stats.filter(stat => Number(pick[stat]));

				if(!recorded.length){return true;}

				return recorded.every(stat => Number(pick[stat]) === Number(seen[stat]));
			},

			/**
			 * What level a picked crew member is
			 *
			 * The roster record is the authority. A pick is a copy made for the
			 * sums, and a copy is only as complete as whoever wrote it — the
			 * level went missing from one for exactly that reason, and every
			 * crew member on screen was then compared against nothing.
			 *
			 * @param  {object} member
			 * @return {int|string|undefined}
			 */
			levelOf(member){
				if(member.level){return member.level;}

				let record = this.$root.crew.find(crew => crew.id === member.id);

				return record ? record.level : undefined;
			},

			/**
			 * The crew types the roster could possibly be holding
			 *
			 * Asking which of the fifteen types you own a tile is beats asking
			 * which of all fifty-eight, because several of the fifty-eight are
			 * near enough identical to each other.
			 *
			 * @return {array}
			 */
			candidates(){
				let names = this.$root.crew
					.concat(this.$root.result.crew || [])
					.filter(member => member.type && member.type.name)
					.map(member => member.type.name);

				return names.filter((name, i) => names.indexOf(name) === i);
			},

			/**
			 * Say what the boxes on screen mean
			 * @param  {object} found
			 * @return {string}
			 */
			summarise(found){
				let notes = [];

				// Without levels the picks cannot be told from their look-alikes
				// at all, and the roster is the only place that knows them
				let unlevelled = this.$root.result.crew
					.filter(member => member.type && member.type.name && !this.levelOf(member)).length;

				if(unlevelled){
					notes.push(`${unlevelled} of the picks have no level recorded — sweep the roster`);
				}

				// The ship's row says how many more crew can actually be taken.
				// More boxes than that means some of the crew already aboard
				// could not be named, so their picks are still being asked for —
				// worth saying, rather than quietly pointing at crew there is no
				// room for.
				let room = found.room;

				if(found.spares.length){
					let unsure = found.spares.filter(s => !s.certain).length;

					notes.push(`${found.spares.length} aboard the voyage does not want`
						+ ` (${found.spares.map(s => `${s.type}${s.level ? ' lvl ' + s.level : ''}`).join(', ')})`
						+ ' — take them off'
						+ (unsure ? ', hover to be sure' : ''));
				}

				if(room && found.marks.length > room.free && !found.spares.length){
					notes.push(`${room.free === 0 ? 'no' : room.free} slot${room.free === 1 ? '' : 's'} free on the ship`
						+ (room.unknown ? `, and ${room.unknown} aboard not recognised — hover the ship's row` : ''));
				}
				let unsure = found.marks.filter(mark => !mark.certain).length;
				let sure = found.marks.length - unsure;

				if(sure){
					notes.push(`${sure} green to click`);
				}

				if(unsure){
					let settled = found.marks.filter(mark => mark.verdict === true).length;
					let ruled = found.marks.filter(mark => mark.verdict === false).length;
					let open = unsure - settled - ruled;

					let levels = found.marks
						.filter(mark => !mark.certain && mark.verdict === undefined)
						.reduce((all, mark) => all.concat(mark.levels), [])
						.filter((level, i, all) => level && all.indexOf(level) === i);

					if(open){
						// Hovering the candidates cannot settle an ambiguous
						// type, however long you spend on them: the pick they
						// answer is the one already aboard as easily as the one
						// still wanted. Send them to the tile that can answer.
						let stuck = found.marks
							.filter(mark => mark.ambiguous && mark.verdict === undefined)
							.map(mark => mark.type)
							.filter((type, i, all) => all.indexOf(type) === i);

						notes.push(stuck.length
							? `${open} to tell apart — hover the ${stuck.join(' and ')}`
								+ ` already on the ship, which is what says who is still wanted`
							: `${open} to tell apart — hover them`
								+ (levels.length ? `; any at the wrong level are already gone, so the stats decide` : ''));
					}

					if(settled){notes.push(`${settled} confirmed by hovering`);}
					if(ruled){notes.push(`${ruled} ruled out`);}
				}

				if(found.missing.length){
					notes.push(`not on screen: ${found.missing.map(name => this.describe(name, found)).join(', ')}`);
				}

				if(found.unknown){
					notes.push(`${found.unknown} unrecognised`);
				}

				return notes.join('; ');
			},

			/**
			 * Mark this captain and crew as sailing on the given ship, which
			 * takes them out of the next calculation without discarding them.
			 *
			 * This used to wipe the whole roster afterwards, throwing away the
			 * assignment it had just worked out along with every crew member the
			 * player had entered. Excluding a ship's crew is what the "Clear
			 * ship" buttons on the main screen undo.
			 *
			 * @param  {int} number
			 * @return {void}
			 */
			assignToShip(number){
				this.$root.captains.forEach(captain => {	
					if(captain.ship == number && captain.id !== this.$root.result.captain.id){
						captain.ship = 0;
					}

					if(captain.id == this.$root.result.captain.id){
						captain.ship = number;
					}
				});

				let ids = this.$root.result.crew.map(c => c.id);

				this.$root.crew.forEach(crew => {
					if(crew.ship == number && !ids.includes(crew.id)){
						crew.ship = 0;
					}

					if(ids.includes(crew.id)){
						crew.ship = number;
					}
				});

				this.$root.save();
				this.hide();
			},

			/**
			 * Hide the results 
			 * @return {void} 
			 */
			hide(){
	    		this.show = false;

				this.$root.result = {
	    			success_chance: 0,
	    			captain: null,
	    			crew: [],
	    			solidarity: 0,
	    			solidarity_bearer: null,
	    			solidarity_value: 0,
	    			parts: {
	    				ram: null,
	    				deckItem1: null,
	    				deckItem2: null,
	    				hull: null,
	    			}
	    		};
			}
		}
	}
</script>