<template>
	<div class="text-white text-sm mb-2">
		<div class="flex items-center">
			<button class="text-white border border-white p-1" @click.prevent="toggle">
				{{ sweeping ? 'Stop sweeping' : 'Sweep roster' }}
			</button>

			<button class="text-white border border-white p-1 ml-2" @click.prevent="check" v-if="!sweeping">
				Read roster
			</button>

			<span class="ml-3 opacity-75">{{ status }}</span>
		</div>

		<p v-if="sweeping" class="mt-2 opacity-75">
			Run the mouse over each crew member. Nothing to press, and hovering will not put anyone on the ship.
		</p>
	</div>
</template>

<script>
	import { rosterScanner } from '../../ports/scripts/readers.js';

	export default {
		data(){
			return {
				sweeping: false,
				tiles: 0,
				agreed: 0,
				disagreed: 0,
				message: '',

				read: '',
			}
		},

		mounted(){
			window.events.$on('roster-sweep', state => {
				this.sweeping = state.sweeping;
				this.tiles = state.tiles;
				this.agreed = state.agreed;
				this.disagreed = state.disagreed;
				this.message = state.message;
			});
		},

		computed: {
			status(){
				if(this.sweeping){
					return this.message || `${this.tiles} of 25 read`
						+ (this.disagreed ? `, ${this.disagreed} portraits disagreed` : '');
				}

				if(this.tiles){
					return `${this.tiles} read, portraits agreed on ${this.agreed} of ${this.agreed + this.disagreed}`;
				}

				return this.read;
			},
		},

		methods: {
			toggle(){
				window.events.$emit(this.sweeping ? 'roster-sweep-stop' : 'roster-sweep-start');
			},

			/**
			 * Say who the scanner can see, without touching the roster at all
			 *
			 * Nothing here hovers or clicks. It is the quick check that the
			 * portraits are being recognised before a voyage depends on it.
			 *
			 * @return {void}
			 */
			check(){
				this.read = 'Reading…';

				rosterScanner().prepare().then(() => {
					let owned = this.$root.crew
						.filter(member => member.type && member.type.name)
						.map(member => member.type.name);

					let scan = rosterScanner().scan(owned.filter((n, i) => owned.indexOf(n) === i));

					console.log('RosterRead', scan);

					if(!scan){
						return this.read = 'Open the ship\'s crew interface first';
					}

					let named = scan.tiles.filter(tile => tile.type);

					if(!named.length){
						return this.read = 'No tiles recognised';
					}

					let worst = named.reduce((far, tile) => Math.max(far, tile.distance), 0);

					this.read = `${named.length} of 25 recognised, worst match ${worst.toFixed(1)}`;
				});
			},
		}
	}
</script>
