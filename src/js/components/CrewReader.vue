<template>
	<modal v-if="showModal" @close="showModal = false" w="80%">
		<h3 slot="title">Could not read the crew type</h3>
		<div class="p-4">
			<p class="text-white">The stats were read, but the type was not. Click this crew member and pick the type from the dropdown &mdash; it will be recognised automatically from now on.</p>

			<p class="text-white text-sm mt-3 opacity-75">The reader saw:</p>
			<textarea v-html="attempts" class="text-gray-800 mt-1 w-full" rows="5" @click.prevent="selectText"></textarea>

			<button class="inline-block text-white border border-white p-1 mt-6" @click.prevent="showModal = false;">Done, close</button>
		</div>
	</modal>
</template>

<script>
	import RosterScanner from '../ports/scripts/RosterScanner.js';
	import { crewReader, rosterScanner } from '../ports/scripts/readers.js';

	export default {
		data(){
			return {
				reader: null,
				scanner: null,

				showModal: false,
				attempts: '',

				// Sweeping: reading the whole roster by running the mouse over it
				sweeping: false,
				timer: null,
				pending: null,
				stable: 0,
				swept: {},

				// The captains, counted apart from the crew. There are five of
				// them against twenty five crew, and they are read differently
				// enough — no type, no portrait — that one total covering both
				// would say nothing about whether either half was finished.
				sweptCaptains: {},
				captainsRead: [],

				// What the portraits said against what the panel said, which is
				// the only way to check the scanner against the real client
				agreed: 0,
				disagreed: 0,
				captured: 0,
				portraits: [],

				// The tile confirmed just before this one, waiting for the mouse
				// to leave it, and the grid it sits in
				previous: null,
				grid: null,

				// Tiles the panel would not name, and what the OCR saw there
				missed: {},
			}
		},

		mounted(){
			window.events.$on('alt-1', this.read);
			window.events.$on('roster-sweep-start', this.startSweeping);
			window.events.$on('roster-sweep-stop', this.stopSweeping);

			this.reader = crewReader();
			this.scanner = rosterScanner();
		},

		beforeDestroy(){
			this.stopSweeping();
		},

		computed: {
			captains(){return this.$root.captains},
			crew(){return this.$root.crew},
			types(){return this.$root.crewTypes},
		},

		methods: {
			read(){
				let found = this.reader.read();

				if(!found){
					return;
				}

				let result = this.reader.result;

				console.log('CrewReaderResult', result);

				// An unreadable type is only worth reporting for crew. Captains
				// have personal names ("Walter Teach") which can never match a
				// crew type, so the warning is checked further down, once we
				// know which of the two we are looking at.

				// If there's a selected crew member, edit their stats instead.
				// Worth saying out loud: a box left selected in the app grid
				// sends the read there whatever the mouse is over, which looks
				// exactly like the reader picking the wrong tile.
				if(this.$root.selected){
					console.log(`Alt1Read  writing to the box selected in the app (id ${this.$root.selected.id}), not the tile under the mouse`);

					let selected = this.$root.selected;
					let crew = null;

					if('name' in selected){
						crew = this.$root.captains.find(captain => captain.id == selected.id);
					} else {
						crew = this.$root.crew.find(member => member.id == selected.id);
					}

					if(!('name' in selected)){
						if(result.type.found){
							this.types.forEach(type => {
								if(type.name == result.type.name){
									crew.type = type;
								}
							});
						} else {
							this.showMissingTypeModal(result.type);
						}
					}

					crew.morale = result.morale;
					crew.combat = result.combat;
					crew.seafaring = result.seafaring;
					crew.level = result.level;

					this.$root.selected = null;
					return this.$root.save();
				}

				let tile = this.tileUnderMouse(result);
				let mouse = a1lib.mousePosition();

				console.log(
					`Alt1Read  mouse ${mouse.x},${mouse.y}  grid ${result.foundX},${result.foundY}`
					+ `  tile ${result.tile}  ->  column ${tile ? tile.column : '-'} row ${tile ? tile.row : '-'}`
					+ `  slot ${tile ? RosterScanner.slotAt(tile.column, tile.row) : '-'}`
					+ `  read "${result.type.name || ''}" ${result.morale}/${result.combat}/${result.seafaring}/${result.speed} lvl ${result.level}`
				);

				if(!tile){
					return;
				}

				if(tile.column == 1){
					return this.applyToCaptain(tile.row, result);
				}

				this.applyToSlot(RosterScanner.slotAt(tile.column, tile.row), result);

				if(result.type.found){
					this.correctPortrait(result, tile, result.type.name);
				}
			},

			/**
			 * Which roster tile the mouse is sitting on
			 *
			 * The reader can only see the details panel, which says nothing
			 * about who it belongs to, so the tile under the mouse is what ties
			 * a read to a crew member.
			 *
			 * @param  {object} result
			 * @return {object|null}  1 based column and row, as the grid counts
			 */
			tileUnderMouse(result){
				let position = a1lib.mousePosition();

				if(!position){return null;}

				// Tile size comes from whichever interface skin was matched
				let tile = result.tile || 52;

				let column = Math.ceil((position.x - result.foundX) / tile);
				let row = Math.ceil((position.y - result.foundY) / tile);

				if(column < 1 || column > 6 || row < 1 || row > 5){return null;}

				return {column: column, row: row};
			},

			/**
			 * Write a read into one of the captain slots
			 * @param  {int} id
			 * @param  {object} result
			 * @return {void}
			 */
			applyToCaptain(id, result){
				let captain = this.captains.find(captain => captain.id == id);

				if(!captain){return;}

				if(!captain.name.length){
					captain.name = `Captain #${id}`;
				}

				captain.morale = result.morale;
				captain.combat = result.combat;
				captain.seafaring = result.seafaring;
				captain.level = result.level;

				this.$root.save();
			},

			/**
			 * Write a read into one of the twenty five crew slots
			 * @param  {int} id
			 * @param  {object} result
			 * @return {void}
			 */
			applyToSlot(id, result){
				let crew = this.crew.find(member => member.id == id);

				if(!crew){return;}

				crew.morale = result.morale;
				crew.combat = result.combat;
				crew.seafaring = result.seafaring;
				crew.level = result.level;

				if(result.type.found){
					this.types.forEach(type => {
						if(type.name == result.type.name){
							crew.type = type;
						}
					});
				} else {
					// Note which slot needs naming, so that picking
					// its type teaches the reader this garbling
					// Only remember attempts specific enough to
					// identify this crew and no other
					this.$root.unidentified = {
						id: crew.id,
						attempts: (result.type.attempts || [])
							.filter(a => this.reader.constructor.teachable(a)),
					};

					this.showMissingTypeModal(result.type);
				}

				this.$root.save();
			},

			/**
			 * Note what this crew type looks like on this client
			 *
			 * The scanner already knows all 58 portraits from the bundled art,
			 * so this is only an escape hatch: if the client draws something the
			 * files do not predict, a read of it says so, and the read costs
			 * nothing because both halves are already to hand — the type from
			 * the panel, the tile from the mouse.
			 *
			 * @param  {object} result
			 * @param  {object} tile
			 * @param  {string} name
			 * @return {void}
			 */
			correctPortrait(result, tile, name){
				let buffer = this.scanner.captureAt(result.foundX, result.foundY, result.tile);

				if(!buffer){return;}

				this.scanner.remember(name, this.scanner.signature(buffer, tile.column, tile.row, result.tile));
			},

			/**
			 * Read the whole roster by running the mouse across it
			 *
			 * Hovering fills in the Compare block, and unlike clicking it leaves
			 * the roster alone, so the whole thing can be read in one sweep with
			 * nothing to press per crew member. It fills in every stat and level
			 * and, along the way, checks each portrait against what the panel
			 * says that crew member actually is.
			 *
			 * The captains' column counts as part of the roster here. Their
			 * details come from the same Compare block under the same mouse, so
			 * leaving them out only meant the one column of the interface the
			 * sweep passes over had to be gone round again by hand afterwards.
			 *
			 * @return {void}
			 */
			startSweeping(){
				if(this.sweeping){return;}

				this.sweeping = true;
				this.pending = null;
				this.stable = 0;
				this.swept = {};
				this.sweptCaptains = {};
				this.captainsRead = [];
				this.agreed = 0;
				this.disagreed = 0;
				this.captured = 0;
				this.previous = null;
				this.grid = null;
				this.portraits = [];
				this.missed = {};

				this.progress('Getting the portraits ready…');

				this.scanner.prepare().then(() => {
					if(!this.sweeping){return;}

					// One scan first, so the portraits are aligned before any
					// of them are judged against the panel
					this.scanner.scan(this.owned());

					this.timer = setInterval(this.poll, 120);
					this.progress('Run the mouse over each crew member and captain');
				});
			},

			stopSweeping(){
				if(this.sweeping && (this.portraits.length || this.captainsRead.length)){
					// One flat string rather than an object. A console object has
					// to be expanded branch by branch before it can be read or
					// copied, and half of it comes out as unevaluated getters.
					let offset = this.scanner.offset || {x: 0, y: 0};

					let lines = [
						`RosterSweep  read ${this.portraits.length}  captains ${this.captainsRead.length}`
							+ `  agreed ${this.agreed}  disagreed ${this.disagreed}`
							+ `  captured ${this.captured}  art offset ${offset.x},${offset.y}`
							+ `  compare offset ${this.reader.compareOffset}`,
					];

					if(this.portraits.length){
						lines.push('tile   panel                     portrait               lvl        stats  dist  runnerUp');
					}

					this.portraits.forEach(p => {
						lines.push(
							p.tile.padEnd(6)
							+ String(p.panel).padEnd(26)
							+ String(p.portrait).padEnd(22)
							+ String(p.level).padStart(4)
							+ String(p.stats).padStart(13)
							+ String(p.distance).padStart(6)
							+ String(p.runnerUp).padStart(10)
							+ (p.panel === p.portrait ? '' : '   <- disagreed')
							+ (p.level ? '' : '   <- no level')
						);
					});

					if(this.captainsRead.length){
						lines.push('');
						lines.push(`${this.captainsRead.length} of 5 captains read:`);

						this.captainsRead.forEach(c => {
							lines.push(
								`  row ${c.row}  ${String(c.name || '(unnamed)').padEnd(20)}`
								+ ` lvl ${String(c.level).padEnd(4)} ${c.stats}`
							);
						});
					}

					let missed = Object.keys(this.missed);

					if(missed.length){
						lines.push('');
						lines.push(`${missed.length} tiles the panel could not name. What the OCR saw:`);

						missed.forEach(key => {
							let m = this.missed[key];

							lines.push(
								`  ${m.tile.padEnd(6)} stats ${m.stats.padEnd(18)} lvl ${String(m.level).padEnd(4)}`
								+ (m.captain ? ' read as a captain' : '')
								+ (m.attempts.length ? ` saw: ${m.attempts.map(a => JSON.stringify(a)).join(' ')}` : ' saw: nothing at all')
							);
						});
					}

					console.log(lines.join('\n'));
				}

				if(this.sweeping){this.offerUnseen();}

				this.sweeping = false;

				if(this.timer){
					clearInterval(this.timer);
					this.timer = null;
				}

				this.progress('');
			},

			/**
			 * Say which saved crew the sweep never laid eyes on
			 *
			 * The roster the app has saved outlives the one on screen. Crew you
			 * no longer have sit in it indefinitely, and no amount of sweeping
			 * removes them: where the roster stops being drawn there is no tile
			 * to hover and nothing to read, so those slots are never written to.
			 * This is the one moment the two can be compared, the sweep having
			 * just been over everything there is to see.
			 *
			 * It offers and never acts. Unseen is not proof of gone — a crew
			 * member away on a voyage is taken out of the roster by the game,
			 * and a sweep the mouse did not finish leaves the rest unseen too.
			 *
			 * @return {void}
			 */
			offerUnseen(){
				let seen = {};

				Object.keys(this.swept).forEach(key => {
					let parts = key.split(':');

					seen[RosterScanner.slotAt(Number(parts[0]), Number(parts[1]))] = true;
				});

				let unseen = this.crew
					.filter(member => member.type && member.type.name && member.type.name !== 'Empty')
					.filter(member => !seen[member.id])
					.map(member => ({id: member.id, name: member.type.name, level: member.level}));

				window.events.$emit('roster-sweep-unseen', {
					unseen: unseen,
					read: Object.keys(this.swept).length,
				});
			},

			/**
			 * Look at whatever the mouse is hovering, once per tick
			 * @return {void}
			 */
			poll(){
				if(!this.reader.read()){
					// Moving off the roster entirely still frees the tile just
					// left, which is how the last crew member of a sweep gets
					// captured at all
					this.releasePrevious(null);
					return this.progress('Hover a crew member');
				}

				let result = this.reader.result;

				// Where the grid is, so a tile can still be captured on a tick
				// where nothing is being hovered
				this.grid = {x: result.foundX, y: result.foundY, tile: result.tile};

				let tile = this.tileUnderMouse(result);

				if(!tile){
					this.releasePrevious(null);
					return this.progress('Hover a crew member in the roster');
				}

				this.releasePrevious(tile);

				// The captains sit in their own column down the left and are
				// read as themselves rather than as a crew type, so the checks
				// below — which are all about naming a type — do not apply to
				// them. This is why they used to be skipped: the sweep only ever
				// looked at what a portrait could name.
				if(tile.column === 1){
					return this.sweepCaptain(tile, result);
				}

				if(!result.type.found || !result.type.name || result.type.name === 'captain'){
					this.note(tile, result);

					return this.progress('That one was not recognised — set its type by hand');
				}

				delete this.missed[`${tile.column},${tile.row}`];

				// The panel takes a frame or two to follow the mouse, so the
				// same answer has to come back twice running before it can be
				// tied to the tile the mouse is on. Crediting a stale panel to
				// a new tile would file a crew member under the wrong slot.
				let key = [
					tile.column, tile.row, result.type.name,
					result.morale, result.combat, result.seafaring, result.level,
				].join(':');

				if(key !== this.pending){
					this.pending = key;
					this.stable = 1;
					return;
				}

				this.stable++;

				// Act once, on the poll that settles it
				if(this.stable !== 2){return;}

				this.applyToSlot(RosterScanner.slotAt(tile.column, tile.row), result);
				this.checkPortrait(result, tile, result.type.name);

				this.swept[`${tile.column}:${tile.row}`] = true;
				this.progress('');
			},

			/**
			 * Take a captain's reading from the panel
			 *
			 * The same hover and the same settling as a crew member, and then
			 * nothing to do with portraits: the scanner names crew types, and a
			 * captain is not one of them. Their column is not scanned, no
			 * signature is captured from it, and the scanner refuses to learn
			 * anything under the name "captain" in any case.
			 *
			 * Which captain this is comes from the row, exactly as it does for a
			 * single read — the panel shows a personal name ("Walter Teach")
			 * that nothing here reads, so the tile under the mouse is the only
			 * thing tying the reading to one of the five.
			 *
			 * @param  {object} tile
			 * @param  {object} result
			 * @return {void}
			 */
			sweepCaptain(tile, result){
				// A slot with no captain in it. Nothing to read, and nothing
				// wrong either, so it is not worth saying anything about.
				if(result.type.name === 'Empty'){return this.progress('');}

				// The panel is naming one of the 58 crew types, and a captain is
				// never one of them: this is the Compare block still showing the
				// crew member the mouse was over a moment ago. Reading it here
				// would file their stats under a captain.
				//
				// What is deliberately not asked for is the captain's hat icon.
				// It only matches on the old blue interface — the reference for
				// it was captured there and findsubimg is exact, and unlike the
				// other two references it never got a counterpart taken from the
				// current skin. Requiring it rejected every captain on a modern
				// client. The column is the better answer in any case: it is the
				// captains' column, which is why a single Alt+1 read has always
				// trusted it and never consulted the icon either.
				if(result.type.found && result.type.name !== 'captain'){
					return this.progress('Still showing a crew member — hold on the captain a moment');
				}

				// A captain has stats. A block that gave up none of them is a
				// panel that is not really there, whatever else was read off it.
				if(!result.morale && !result.combat && !result.seafaring){
					return this.progress('Hold on the captain until their details show');
				}

				// Settled twice running before it is credited, for the same
				// reason the crew are: the panel takes a frame or two to follow
				// the mouse, and a stale one would be filed under the captain
				// the mouse has just arrived at.
				let key = [
					tile.column, tile.row, 'captain',
					result.morale, result.combat, result.seafaring, result.level,
				].join(':');

				if(key !== this.pending){
					this.pending = key;
					this.stable = 1;
					return;
				}

				this.stable++;

				if(this.stable !== 2){return;}

				this.applyToCaptain(tile.row, result);

				// Named after applying, since a captain with no name of their own
				// is given one there
				let captain = this.captains.find(one => one.id == tile.row);

				// One line per captain rather than one per hover. There are only
				// five of them and passing back over one is easily done, which
				// would otherwise fill the report with the same captain.
				let line = {
					row: tile.row,
					name: captain ? captain.name : '',
					level: result.level,
					stats: `${result.morale}/${result.combat}/${result.seafaring}/${result.speed}`,
				};

				let at = this.captainsRead.findIndex(read => read.row === tile.row);

				if(at === -1){this.captainsRead.push(line);} else {this.captainsRead.splice(at, 1, line);}

				this.sweptCaptains[tile.row] = true;
				this.progress('');
			},

			/**
			 * Record why a tile would not read, once per tile
			 *
			 * "Not recognised" on its own says nothing about whether the name
			 * failed to read at all or read and failed to match, and those want
			 * opposite fixes.
			 *
			 * @param  {object} tile
			 * @param  {object} result
			 * @return {void}
			 */
			note(tile, result){
				let key = `${tile.column},${tile.row}`;

				if(this.missed[key]){return;}

				this.missed[key] = {
					tile: key,
					attempts: (result.type.attempts || []).slice(0, 4),
					stats: `${result.morale}/${result.combat}/${result.seafaring}/${result.speed}`,
					level: result.level,
					captain: result.type.name === 'captain',
				};
			},

			/**
			 * Ask the scanner what it makes of the tile being hovered
			 *
			 * The panel is the truth here, so this only records what the
			 * portraits made of it rather than acting on the answer. The
			 * hovered tile is also the one carrying the hover glow, so a
			 * disagreement on it is worth seeing before it is trusted.
			 *
			 * @param  {object} result
			 * @param  {object} tile
			 * @param  {string} name
			 * @return {void}
			 */
			checkPortrait(result, tile, name){
				let buffer = this.scanner.captureAt(result.foundX, result.foundY, result.tile);

				if(!buffer){return;}

				let signature = this.scanner.signature(buffer, tile.column, tile.row, result.tile);

				if(!signature){return;}

				let nearest = this.scanner.nearest(signature, this.scanner.known(this.owned()));

				if(nearest.name === name){this.agreed++;} else {this.disagreed++;}

				this.portraits.push({
					tile: `${tile.column},${tile.row}`,
					panel: name,
					portrait: nearest.name,
					level: result.level,
					stats: `${result.morale}/${result.combat}/${result.seafaring}/${result.speed}`,
					distance: Math.round(nearest.distance * 10) / 10,
					runnerUp: Math.round(nearest.runnerUp * 10) / 10,
				});

				this.previous = {column: tile.column, row: tile.row, name: name, level: result.level};
			},

			/**
			 * Capture a tile the mouse has moved off
			 *
			 * Once it is no longer hovered it is the same crew member without
			 * the hover glow, and it still carries a name the panel gave us
			 * rather than a guess. That is the one moment a portrait can be
			 * taken from this client and be certain whose it is — hovering does
			 * not reorder the roster, so the tile is still who it was.
			 *
			 * It matters because the bundled art lands ten to twenty units from
			 * what the client draws: close enough to rank correctly, too far to
			 * clear the margin. Captured, a tile sits on its own record at zero.
			 *
			 * Moving anywhere else is enough, including off the roster
			 * altogether. Waiting for the next crew member to be confirmed
			 * instead meant the last one swept was never captured.
			 *
			 * @param  {object|null} tile  where the mouse is now
			 * @return {void}
			 */
			releasePrevious(tile){
				let previous = this.previous;

				if(!previous || !this.grid){return;}
				if(tile && tile.column === previous.column && tile.row === previous.row){return;}

				this.previous = null;

				let buffer = this.scanner.captureAt(this.grid.x, this.grid.y, this.grid.tile);

				if(!buffer){return;}

				let plain = this.scanner.signature(buffer, previous.column, previous.row, this.grid.tile);

				if(plain && this.scanner.remember(previous.name, plain)){this.captured++;}

				// The corner where the level is printed, taken at the same
				// moment. It is what tells two crew of one type apart later,
				// and this is the only time both halves are to hand: the
				// portrait says which type, the panel said which level.
				let corner = this.scanner.corner(buffer, previous.column, previous.row, this.grid.tile);

				this.scanner.rememberBadge(previous.name, previous.level, corner);
			},

			/**
			 * The crew types this roster is known to hold
			 * @return {array}
			 */
			owned(){
				let names = this.crew
					.filter(member => member.type && member.type.name)
					.map(member => member.type.name);

				return names.filter((name, i) => names.indexOf(name) === i);
			},

			/**
			 * Tell the rest of the app how the sweep is going
			 * @param  {string} message
			 * @return {void}
			 */
			progress(message){
				window.events.$emit('roster-sweep', {
					sweeping: this.sweeping,
					tiles: Object.keys(this.swept).length,
					captains: Object.keys(this.sweptCaptains).length,
					agreed: this.agreed,
					disagreed: this.disagreed,
					missed: Object.keys(this.missed).length,
					message: message || '',
				});
			},

			/**
			 * When the reader can't find the type, make a hash and check it
			 * against our records. If it's a new unknown, show the modal with
			 * the debugging data
			 * @param  {object} type
			 * @return {void}
			 */
			showMissingTypeModal(type){
				let attempts = type.attempts;

				if(!attempts || !attempts.length){
					return;
				}

				attempts = attempts.join('\n');
				let hash = this.hash(attempts);

				// Don't bug the user every single time for the same missing time
				if(this.$root.attempts.indexOf(hash) != -1){
					return;
				}

				// Show the modal with the debug data
				this.attempts = attempts;
				this.showModal = true;

				// Add this to the record of known missing types
				this.$root.attempts.push(hash);
			},

			/**
			 * Converts a string to an Int32 hash
			 * @param  {string} string
			 * @return {int}
			 */
			hash(string){
				var hash = 0, i, chr;
				if (string.length === 0) return hash;
				for (i = 0; i < string.length; i++) {
					chr   = string.charCodeAt(i);
					hash  = ((hash << 5) - hash) + chr;
				    hash |= 0;
				}
				return hash;
			}
		}
	}
</script>
