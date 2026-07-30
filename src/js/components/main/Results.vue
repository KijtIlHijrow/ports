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
			<button class="text-white border border-white p-1" @click.prevent="findOnScreen">Find on screen</button>
			<span class="ml-3 text-sm opacity-75">{{ finding }}</span>
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
	import { rosterScanner } from '../../ports/scripts/readers.js';

	export default {
		data(){
			return {
				show: false,
				finding: '',
			}
		},

		mounted(){
			window.events.$on('result-calculated', data => {
				this.$root.selected = null;
				this.show = true;
				this.finding = '';
			});
		},

		methods: {
			/**
			 * Box the picked crew where they are sitting in the game's roster
			 *
			 * The calculator picks crew by slot number, and RuneScape reorders
			 * the roster, so a slot number is no help in finding anyone. Their
			 * portraits are, and the scan knows those.
			 *
			 * @return {void}
			 */
			findOnScreen(){
				let picks = this.$root.result.crew
					.filter(member => member.type && member.type.name)
					.map(member => member.type.name);

				if(!picks.length){
					return this.finding = 'Nothing to find';
				}

				let found = rosterScanner().find(picks);

				console.log('RosterScan', found);

				if(!found.found){
					return this.finding = 'Open the crew roster first';
				}

				if(!found.marks.length){
					return this.finding = found.unknown == 25
						? 'No portraits learned yet — run a roster scan'
						: 'None of the picked crew were recognised';
				}

				rosterScanner().show(found.marks);

				this.finding = this.summarise(found);
			},

			/**
			 * Say what the boxes on screen mean
			 * @param  {object} found
			 * @return {string}
			 */
			summarise(found){
				let notes = [];
				let unsure = found.marks.filter(mark => !mark.certain).length;

				if(unsure){
					notes.push(`${unsure} amber: more of that type than the voyage needs`);
				}

				if(found.missing.length){
					notes.push(`not found: ${found.missing.join(', ')}`);
				}

				if(found.unknown){
					notes.push(`${found.unknown} ${found.unknown == 1 ? 'tile' : 'tiles'} unrecognised`);
				}

				return notes.length ? notes.join('; ') : 'All picked crew boxed in green';
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