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
			}
		},

		mounted(){
			window.events.$on('alt-1', this.read);

			this.reader = crewReader();
			this.scanner = rosterScanner();
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
			 * Note what this crew type looks like on this client
			 *
			 * The scanner already knows all 58 portraits from the bundled art,
			 * so this is only an escape hatch: if the client draws something the
			 * files do not predict, a read of it says so, and the read costs
			 * nothing because both halves are already to hand — the type from
			 * the details panel, the tile from the mouse.
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
