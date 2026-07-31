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

				// Tiles settled by hovering them, and the roster layout those
				// answers were true of
				confirmed: {},
				layout: '',
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
				this.layout = '';

				let picks = this.$root.result.crew
					.filter(member => member.type && member.type.name)
					.map(member => `${member.type.name} lvl ${member.level}`);

				// What the voyage is actually asking for. If a level here does
				// not match anything in the roster, the picks are describing
				// crew as they were before the roster last moved — recalculating
				// after a sweep is what puts that right.
				console.log(`Pointing  looking for: ${picks.join(', ')}`);

				rosterScanner().prepare().then(() => {
					if(!this.finding){return;}

					this.point();
					this.timer = setInterval(this.point, 400);
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
					.map(member => ({type: member.type.name, level: member.level}));

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
				}

				let found = scanner.find(scan, picks, RosterScanner.aboard(scan));

				this.askThePanel(scan, found);

				found.marks.forEach(mark => {
					mark.verdict = this.confirmed[`${mark.tile.column},${mark.tile.row}`];
				});

				if(!found.marks.length && !found.missing.length){
					this.message = 'All aboard — nothing left to click';
					return this.stopFinding();
				}

				scanner.show(found.marks);

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

				if(!where){return;}

				let mark = found.marks.find(m => !m.certain
					&& m.tile.column === where.column && m.tile.row === where.row);

				if(!mark){return;}

				// The scan has already found the interface this tick
				if(!reader.read(scan.location)){return;}

				let result = reader.result;

				// The panel is showing something else, most likely because the
				// mouse has moved on since. Better no answer than a wrong one.
				if(!result.type.found || result.type.name !== mark.type){return;}

				let level = Number(result.level);
				let wanted = mark.levels.map(Number);
				let verdict = wanted.indexOf(level) !== -1;
				let key = `${where.column},${where.row}`;

				if(this.confirmed[key] !== verdict){
					console.log(`Pointing  ${key} is a ${mark.type} level ${result.level}`
						+ `  wanted ${wanted.length ? wanted.join(' or ') : '(no level recorded)'}`
						+ `  -> ${verdict ? 'this one' : 'not this one'}`);
				}

				this.confirmed[key] = verdict;
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