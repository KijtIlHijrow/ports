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

				// Roster scan: clicking through every crew member in one pass
				scanning: false,
				timer: null,

				// The read waiting to be believed, and how many polls have
				// agreed with it so far
				pending: null,
				stable: 0,

				// The tile read just before this one, which has now lost its
				// selection highlight
				previous: null,

				// Tiles this pass has recorded
				taught: {},
			}
		},

		mounted(){
			window.events.$on('alt-1', this.read);
			window.events.$on('roster-scan-start', this.startScanning);
			window.events.$on('roster-scan-stop', this.stopScanning);

			this.reader = crewReader();
			this.scanner = rosterScanner();
		},

		beforeDestroy(){
			this.stopScanning();
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

				// If there's a selected crew member, edit their stats instead
				if(this.$root.selected){
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

				if(!tile){
					return;
				}

				if(tile.column == 1){
					return this.applyToCaptain(tile.row, result);
				}

				this.applyToSlot(RosterScanner.slotAt(tile.column, tile.row), result);

				if(result.type.found){
					this.learnPortrait(result, tile, result.type.name);
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
				let tile = result.tile || 53;

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
			 * Record what this crew type looks like in the roster grid
			 *
			 * The read already knows both halves of the answer — the type, from
			 * the details panel, and the tile, from the mouse — so the portrait
			 * costs nothing beyond one capture.
			 *
			 * @param  {object} result
			 * @param  {object} tile
			 * @param  {string} name
			 * @return {void}
			 */
			learnPortrait(result, tile, name){
				let buffer = this.scanner.captureAt(result.foundX, result.foundY, result.tile);

				if(!buffer){return;}

				this.scanner.remember(name, this.scanner.signature(buffer, tile.column, tile.row, result.tile));

				// During a scan the tile read a moment ago has just lost its
				// selection, so it is now the same crew member drawn plainly.
				// Both appearances are needed, because a scan sees one selected
				// tile and twenty four plain ones, and this is the only moment
				// a plain one can be named with any certainty.
				//
				// Only during a scan: between two ordinary reads the roster may
				// have been reordered, and that tile could belong to anyone.
				if(this.scanning && this.previous
					&& (this.previous.column !== tile.column || this.previous.row !== tile.row)){
					this.scanner.remember(
						this.previous.name,
						this.scanner.signature(buffer, this.previous.column, this.previous.row, result.tile)
					);
				}

				this.previous = {column: tile.column, row: tile.row, name: name};
			},

			/**
			 * Start a pass over the whole roster
			 *
			 * Clicking a crew member is the only way to bring up their details,
			 * so the roster has to be walked by hand once. Watching for it means
			 * the walk is only clicking, with no key to press per crew member,
			 * and it fills in every stat as well as every portrait.
			 *
			 * @return {void}
			 */
			startScanning(){
				if(this.scanning){return;}

				this.scanning = true;
				this.pending = null;
				this.stable = 0;
				this.previous = null;
				this.taught = {};

				this.timer = setInterval(this.poll, 150);
				this.progress('Click each crew member in turn');
			},

			stopScanning(){
				this.scanning = false;

				if(this.timer){
					clearInterval(this.timer);
					this.timer = null;
				}

				this.progress('');
			},

			/**
			 * Look at whoever the details panel is showing, once per tick
			 * @return {void}
			 */
			poll(){
				if(!this.reader.read()){
					return this.progress('Waiting for the crew roster');
				}

				let result = this.reader.result;
				let tile = this.tileUnderMouse(result);

				if(!tile || tile.column < 2){
					return this.progress('Keep the mouse on the crew member you clicked');
				}

				if(!result.type.found || !result.type.name){
					return this.progress('That one was not recognised — set its type by hand');
				}

				// The details panel lags the click by a frame or two, so the
				// same answer has to come back several times running before it
				// can be tied to the tile the mouse is on. Attributing a stale
				// panel to a new tile would teach the wrong portrait.
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
				if(this.stable !== 3){return;}

				this.applyToSlot(RosterScanner.slotAt(tile.column, tile.row), result);
				this.learnPortrait(result, tile, result.type.name);

				this.taught[`${tile.column}:${tile.row}`] = true;
				this.progress('');
			},

			/**
			 * Tell the rest of the app how the pass is going
			 * @param  {string} message
			 * @return {void}
			 */
			progress(message){
				window.events.$emit('roster-scan', {
					scanning: this.scanning,
					tiles: Object.keys(this.taught).length,
					types: this.scanner.learned(),
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
