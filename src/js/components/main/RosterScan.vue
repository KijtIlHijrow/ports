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
			Run the mouse over each crew member, and over the captains down the left. Nothing to press, and hovering will not put anyone on the ship.
		</p>

		<div v-if="unseen.length" class="mt-2 p-2 border border-white">
			<p>The sweep never saw {{ unseen.length }} of the {{ unseen.length === 1 ? 'crew member' : 'crew' }} this app has saved:</p>

			<p class="mt-1 opacity-75">{{ listed }}</p>

			<p class="mt-2">
				That happens for three different reasons, and only one of them means they should go.
				You no longer have them &mdash; or they are <strong>away at sea</strong>, since the game takes a ship's
				crew out of the roster while it sails, so nothing here can reach them &mdash; or the mouse simply
				did not pass over them this time. You read {{ readCount }} of 25 on this sweep.
			</p>

			<p class="mt-2">
				Emptying these slots throws their stats away. Do it only for crew you genuinely no longer have.
				For anyone merely away, leave them alone and mark them <em>Sent on ship</em> instead &mdash;
				that keeps their stats for when they come back, and the calculator skips them meanwhile.
			</p>

			<div class="mt-2">
				<button class="text-white border border-white p-1" @click.prevent="emptyUnseen">
					Empty {{ unseen.length === 1 ? 'that slot' : ('those ' + unseen.length + ' slots') }}
				</button>

				<button class="text-white border border-white p-1 ml-2" @click.prevent="unseen = []">
					Leave them alone
				</button>
			</div>
		</div>

		<p v-if="emptied" class="mt-2 opacity-75">
			Emptied {{ emptied }} {{ emptied === 1 ? 'slot' : 'slots' }}. Calculate again to pick from who is left.
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
				captains: 0,
				agreed: 0,
				disagreed: 0,
				missed: 0,
				message: '',

				read: '',

				// Saved crew the sweep just finished never got a look at, and
				// how much of the roster it did read — which is what says
				// whether "unseen" means gone or means unfinished
				unseen: [],
				readCount: 0,
				emptied: 0,
			}
		},

		mounted(){
			window.events.$on('roster-sweep', state => {
				this.sweeping = state.sweeping;
				this.tiles = state.tiles;
				this.captains = state.captains;
				this.agreed = state.agreed;
				this.disagreed = state.disagreed;
				this.missed = state.missed;
				this.message = state.message;
			});

			window.events.$on('roster-sweep-unseen', state => {
				this.unseen = state.unseen;
				this.readCount = state.read;
			});
		},

		computed: {
			status(){
				if(this.sweeping){
					// The count always shows. It used to be replaced by whatever
					// the last poll had to say, so a single tile that would not
					// read looked exactly like a sweep reading nothing at all.
					//
					// Both counts show from the start, including at nought. The
					// captains are the column easiest to walk past, and a total
					// that only appeared once one had been read would give no
					// hint that they were wanted.
					return `${this.tiles} of 25 crew, ${this.captains} of 5 captains`
						+ (this.missed ? `, ${this.missed} not recognised` : '')
						+ (this.message ? ` — ${this.message}` : '');
				}

				if(this.tiles || this.captains){
					return `${this.tiles} crew and ${this.captains} captains read,`
						+ ` portraits agreed on ${this.agreed} of ${this.agreed + this.disagreed}`
						+ (this.missed ? `, ${this.missed} unnamed (see console)` : '');
				}

				return this.read;
			},

			/**
			 * The unseen crew, named the way you would go looking for them
			 * @return {string}
			 */
			listed(){
				return this.unseen
					.map(entry => entry.name + (entry.level ? ` lvl ${entry.level}` : ''))
					.join(', ');
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
				// Last sweep's offer does not apply to this one, and an offer
				// left standing while the roster is being read again would be
				// answering for a roster that has moved on
				this.unseen = [];
				this.emptied = 0;

				window.events.$emit(this.sweeping ? 'roster-sweep-stop' : 'roster-sweep-start');
			},

			/**
			 * Give back the slots of crew the sweep never saw
			 *
			 * Only ever reached by asking for it. What it throws away is the
			 * stats, which is why the crew away at sea have to be kept out of
			 * it — they are still yours, and the roster is where their numbers
			 * live until they sail home.
			 *
			 * @return {void}
			 */
			emptyUnseen(){
				let blank = this.$root.crewTypes.find(type => type.name === 'Empty');

				if(!blank){return;}

				let gone = 0;

				this.unseen.forEach(entry => {
					let member = this.$root.crew.find(one => one.id === entry.id);

					if(!member){return;}

					member.type = blank;
					member.morale = 0;
					member.combat = 0;
					member.seafaring = 0;
					member.level = 0;
					member.ship = 0;

					gone++;
				});

				this.$root.save();

				this.emptied = gone;
				this.unseen = [];
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
