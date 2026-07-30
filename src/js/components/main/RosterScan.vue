<template>
	<div class="text-white text-sm mb-2">
		<div class="flex items-center">
			<button class="text-white border border-white p-1" @click.prevent="toggle">
				{{ scanning ? 'Stop scanning' : 'Scan roster' }}
			</button>

			<span class="ml-3 opacity-75">{{ status }}</span>
		</div>

		<p v-if="scanning" class="mt-2 opacity-75">
			Click each crew member in turn. Nothing else to press, and the roster must not be reordered until you stop.
		</p>
	</div>
</template>

<script>
	import { rosterScanner } from '../../ports/scripts/readers.js';

	export default {
		data(){
			return {
				scanning: false,
				tiles: 0,
				types: 0,
				message: '',
			}
		},

		mounted(){
			window.events.$on('roster-scan', state => {
				this.scanning = state.scanning;
				this.tiles = state.tiles;
				this.types = state.types;
				this.message = state.message;
			});

			this.types = rosterScanner().learned();
		},

		computed: {
			/**
			 * What to say to the right of the button
			 * @return {string}
			 */
			status(){
				if(this.message){return this.message;}

				if(this.scanning){
					return `${this.tiles} of 25 read`;
				}

				if(!this.types){
					return 'No portraits learned yet';
				}

				return `${this.types} crew ${this.types == 1 ? 'type' : 'types'} recognised on sight`;
			},
		},

		methods: {
			toggle(){
				window.events.$emit(this.scanning ? 'roster-scan-stop' : 'roster-scan-start');
			},
		}
	}
</script>
