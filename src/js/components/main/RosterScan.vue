<template>
	<div class="text-white text-sm mb-2">
		<div class="flex items-center">
			<button class="text-white border border-white p-1" @click.prevent="toggle">
				{{ sweeping ? 'Stop sweeping' : 'Sweep roster' }}
			</button>

			<button class="text-white border border-white p-1 ml-2" @click.prevent="check" v-if="!sweeping">
				Read roster
			</button>

			<button class="text-white border border-white p-1 ml-2" @click.prevent="forget" v-if="!sweeping">
				Forget learning
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
				missed: 0,
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
				this.missed = state.missed;
				this.message = state.message;
			});
		},

		computed: {
			status(){
				if(this.sweeping){
					// The count always shows. It used to be replaced by whatever
					// the last poll had to say, so a single tile that would not
					// read looked exactly like a sweep reading nothing at all.
					return `${this.tiles} of 25 read`
						+ (this.missed ? `, ${this.missed} not recognised` : '')
						+ (this.message ? ` — ${this.message}` : '');
				}

				if(this.tiles){
					return `${this.tiles} read, portraits agreed on ${this.agreed} of ${this.agreed + this.disagreed}`
						+ (this.missed ? `, ${this.missed} unnamed (see console)` : '');
				}

				return this.read;
			},
		},

		methods: {
			/**
			 * Throw away everything learned from this client
			 *
			 * A reading credited to the wrong tile teaches a crew member's face
			 * as something else, and nothing afterwards can tell that it did.
			 * Starting again from the bundled art is the only way back.
			 *
			 * @return {void}
			 */
			forget(){
				let scanner = rosterScanner();

				// Say what went, and say what did not. The crew grid below is
				// the roster — who you own and what their stats are — and this
				// never touches it. Only what the scanner worked out about how
				// this client draws them is thrown away.
				let portraits = Object.keys(scanner.library()).length;
				let badges = Object.keys(scanner.badges()).length;

				scanner.forget();

				try {
					localStorage.removeItem(scanner.badgeKey);
				} catch(e) {}

				this.read = `Forgot ${portraits} learned portrait${portraits === 1 ? '' : 's'}`
					+ ` and ${badges} level badge${badges === 1 ? '' : 's'}.`
					+ ' Your roster is untouched — sweep to learn them again.';
			},

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

					if(!scan){
						return this.read = 'Open the ship\'s crew interface first';
					}

					// Flat text, because a console object has to be expanded
					// branch by branch before any of it can be read or copied
					let offset = scan.offset || {x: 0, y: 0};
					let named = scan.tiles.filter(tile => tile.type);

					let lines = [
						`RosterRead  ${named.length} of ${scan.tiles.length} named  art offset ${offset.x},${offset.y}`
							+ (scan.rowOffsets ? '  per row ' + Object.keys(scan.rowOffsets)
								.map(r => `${r}:${scan.rowOffsets[r].x},${scan.rowOffsets[r].y}`).join(' ') : ''),
						'tile   named                     nearest                lvl  dist  runnerUp',
					];

					scan.tiles.forEach(t => {
						lines.push(
							`${t.column},${t.row}`.padEnd(6)
							+ (t.type || '-').padEnd(26)
							+ (t.nearest || '-').padEnd(22)
							+ String(t.level === null || t.level === undefined ? '-' : t.level).padStart(4)
							+ (t.nearestDistance === null ? '' : t.nearestDistance.toFixed(1)).padStart(5)
							+ (t.runnerUp === null || t.runnerUp === Infinity ? '' : t.runnerUp.toFixed(1)).padStart(10)
							+ (t.type ? '' : '   <- declined')
						);
					});

					console.log(lines.join('\n'));

					if(!named.length){
						return this.read = 'Nothing cleared the thresholds — see the console';
					}

					let worst = named.reduce((far, tile) => Math.max(far, tile.distance), 0);

					this.read = `${named.length} of ${scan.tiles.length} recognised, worst match ${worst.toFixed(1)}`;
				});
			},
		}
	}
</script>
