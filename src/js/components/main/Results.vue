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
				hovering: null,
				pending: null,
				agreeing: 0,
				layout: '',

				// What the voyage is after, and the last few things hovering
				// settled — on screen, because a console object is no use to
				// anyone reading it off a screenshot
				looking: '',
				notes: [],
				warned: false,
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
				this.hovering = null;
				this.pending = null;
				this.agreeing = 0;
				this.layout = '';
				this.notes = [];
				this.warned = false;

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
					.map(member => ({type: member.type.name, level: this.levelOf(member)}));

				if(!picks.length){
					this.message = 'Nothing to find';
					return this.stopFinding();
				}

				let scanner = rosterScanner();
				let scan = scanner.scan(this.candidates());

				if(!scan){
					return this.message = 'Open the ship\'s crew interface';
				}

				// Anything settled by hovering only holds while the roster
				// stands still. Clicking a crew member onto the ship shuffles
				// everyone behind them, and an answer about a tile is worthless
				// once somebody else is in it.
				let layout = scan.tiles.map(tile => tile.type || '?').join('|');

				if(layout !== this.layout){
					this.layout = layout;
					this.confirmed = {};
					this.onShip = {};

					// Whoever was under the mouse may not be there any more
					this.hovering = null;
				}

				let found = scanner.find(scan, picks, RosterScanner.aboard(scan, this.onShip));

				found.room = RosterScanner.room(scan, this.onShip);

				this.askThePanel(scan, found);

				found.marks.forEach(mark => {
					mark.verdict = this.confirmed[`${mark.tile.column},${mark.tile.row}`];
				});

				if(!found.marks.length && !found.missing.length && !found.spares.length){
					this.message = 'All aboard — nothing left to click';
					return this.stopFinding();
				}

				scanner.show(found.marks, 0.7, found.spares);

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
			askThePanel(scan, found){
				let reader = crewReader();
				let tile = scan.location.skin.grid.tile;

				let where = RosterScanner.tileAt(
					scan.location.gridX, scan.location.gridY, tile, a1lib.mousePosition()
				);

				this.releaseHover(scan, where);

				if(!where || where.column < 2){return;}

				let key = `${where.column},${where.row}`;
				let onShip = where.row === 1;

				let mark = onShip ? null : found.marks.find(m => !m.certain
					&& m.tile.column === where.column && m.tile.row === where.row);

				// Nothing to settle here: a tile that is already certain, or one
				// no pick is asking about
				if(!onShip && !mark){return;}

				// The scan has already found the interface this tick
				if(!reader.read(scan.location)){return;}

				let result = reader.result;

				if(!result.type.found || !result.type.name || result.type.name === 'captain'){return;}

				// The panel lags the mouse, so a reading taken mid-move belongs
				// to the tile just left rather than the one arrived at. Without
				// this the same ship tile reported a Brimhaven Pirate one moment
				// and an empty slot the next, and the count of who was aboard
				// flapped with it.
				let settled = `${key}:${result.type.name}:${result.level}`;

				if(settled !== this.pending){
					this.pending = settled;
					this.agreeing = 1;
					return;
				}

				this.agreeing++;

				// Two agreeing reads was not enough. The panel can lag the mouse
				// by longer than that, and a stale reading holds still while it
				// does — which is how a tile holding a First Mate was recorded
				// as an empty slot, twice running, and then learned as one.
				if(this.agreeing < 3){return;}

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

					if(!held || held.type !== result.type.name || held.level !== level){
						this.onShip[key] = {type: result.type.name, level: level};
						this.note(`${key} aboard: ${result.type.name} level ${result.level}`);
					}

					return;
				}

				// The panel is showing something else, most likely because the
				// mouse has moved on since. Better no answer than a wrong one.
				if(result.type.name !== mark.type){return;}

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

				let verdict = wanted.indexOf(level) !== -1;

				if(this.confirmed[key] !== verdict){
					this.note(`${key} is a ${mark.type} level ${result.level}`
						+ `, wanted ${wanted.length ? wanted.join(' or ') : '(none recorded)'}`
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
					notes.push(`${found.spares.length} aboard the voyage does not want`
						+ ` (${found.spares.map(s => `${s.type} lvl ${s.level}`).join(', ')}) — take them off`);
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
						notes.push(`${open} to tell apart — hover them, or read the level`
							+ (levels.length ? ` (want ${levels.sort().join(', ')})` : ''));
					}

					if(settled){notes.push(`${settled} confirmed by hovering`);}
					if(ruled){notes.push(`${ruled} ruled out`);}
				}

				if(found.missing.length){
					notes.push(`not in the roster: ${found.missing.join(', ')}`);
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