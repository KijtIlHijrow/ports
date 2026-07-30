<template>
	<div class="text-white text-sm mb-2 flex items-center">
		<button class="text-white border border-white p-1" @click.prevent="check">Read roster</button>
		<span class="ml-3 opacity-75">{{ message }}</span>
	</div>
</template>

<script>
	import { rosterScanner } from '../../ports/scripts/readers.js';

	export default {
		data(){
			return {
				message: '',
			}
		},

		methods: {
			/**
			 * Say who the scanner can see in the roster, without touching it
			 *
			 * Nothing here clicks, because a click in the ship's crew interface
			 * puts that crew member on the ship. This is only here to show that
			 * the portraits are being recognised before a voyage depends on it.
			 *
			 * @return {void}
			 */
			check(){
				this.message = 'Reading…';

				rosterScanner().prepare().then(() => {
					let owned = this.$root.crew
						.filter(member => member.type && member.type.name)
						.map(member => member.type.name);

					let scan = rosterScanner().scan(owned.filter((n, i) => owned.indexOf(n) === i));

					console.log('RosterRead', scan);

					if(!scan){
						return this.message = 'Open the crew interface first';
					}

					let named = scan.tiles.filter(tile => tile.type);

					if(!named.length){
						return this.message = 'No tiles recognised';
					}

					let worst = named.reduce((far, tile) => Math.max(far, tile.distance), 0);

					this.message = `${named.length} of 25 tiles recognised, worst match ${worst.toFixed(1)}`;
				});
			},
		}
	}
</script>
