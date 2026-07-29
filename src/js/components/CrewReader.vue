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
	import CrewReader from '../ports/scripts/CrewReader.js';

	export default {
		data(){
			return {
				reader: null,

				showModal: false,
				attempts: '',
			}
		},

		mounted(){
			window.events.$on('alt-1', this.read);
			this.reader = new CrewReader();
		},

		computed: {
			captains(){return this.$root.captains},
			crew(){return this.$root.crew},
			types(){return this.$root.crewTypes},
		},

		methods: {
			read(){
				let found = this.reader.read();

				if(found){
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

					let mousePosition = a1lib.mousePosition();

					let offsetX = mousePosition.x - result.foundX;
					let offsetY = mousePosition.y - result.foundY;

					// Tile size comes from whichever interface skin was matched
					let tile = result.tile || 53;

					let tileX = Math.ceil(offsetX / tile);
					let tileY = Math.ceil(offsetY / tile);

					if(tileX == 1){
						this.captains.forEach(captain => {
							if(captain.id == tileY){
								if(!captain.name.length){
									captain.name = `Captain #${tileY}`;
								}

								captain.morale = result.morale;
								captain.combat = result.combat;
								captain.seafaring = result.seafaring;
								captain.level = result.level;

								this.$root.save();
							}
						});

						return;
					}

					let conversions = {
						6:  {x: 2, y: 1},
						7:  {x: 3, y: 1},
						8:  {x: 4, y: 1},
						9:  {x: 5, y: 1},
						10: {x: 6, y: 1},

						11:  {x: 2, y: 2},
						12:  {x: 3, y: 2},
						13:  {x: 4, y: 2},
						14:  {x: 5, y: 2},
						15:  {x: 6, y: 2},

						16:  {x: 2, y: 3},
						17:  {x: 3, y: 3},
						18:  {x: 4, y: 3},
						19:  {x: 5, y: 3},
						20:  {x: 6, y: 3},

						21:  {x: 2, y: 4},
						22:  {x: 3, y: 4},
						23:  {x: 4, y: 4},
						24:  {x: 5, y: 4},
						25:  {x: 6, y: 4},

						26:  {x: 2, y: 5},
						27:  {x: 3, y: 5},
						28:  {x: 4, y: 5},
						29:  {x: 5, y: 5},
						30:  {x: 6, y: 5},
					};
					
					for(let conversion in conversions){
						let tiles = conversions[conversion];
						
						if(tiles.x == tileX && tiles.y == tileY){
							this.crew.forEach(crew => {
								if(crew.id == conversion){
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
								}
							});
						}						
					}
				}
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