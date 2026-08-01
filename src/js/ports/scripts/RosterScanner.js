import crewRegions from '../data/crew.json';

/**
 * Works out which crew member is sitting in each roster tile, from the
 * portraits alone.
 *
 * The calculator files everyone under a slot number, and the game reorders the
 * roster constantly — crewing the ship being viewed floats those five to the
 * top row — so a slot number says nothing about where anyone is sitting. That
 * is what turns "send the Cyclops" into a hunt.
 *
 * Nothing here clicks, and that is the point. In the ship's crew interface a
 * click on an unassigned crew member *assigns* them to the ship, so walking
 * the roster to read it would rearrange the very thing being read.
 *
 * What makes that possible is that the portraits in crew.json are not merely
 * pictures of the crew: they are the same 37x37 art the game draws in the
 * roster, at the same size. So the whole library is known in advance and none
 * of it has to be learned.
 */
export default class RosterScanner
{
	constructor(reader){
		this.reader = reader;

		// Six columns of five: the captains down the left, then the twenty
		// five crew slots the calculator numbers 6 to 30
		this.columns = 6;
		this.rows = 5;
		this.captainColumn = 1;

		// Where the portrait sits inside its tile, as a fraction of the tile.
		// The art is 37px in a 52px tile, centred, and measuring it in
		// fractions rather than pixels keeps this independent of the interface
		// scale in the same way the tile pitch already is.
		this.portrait = {from: 7 / 52, to: 44 / 52};

		// Where the level is printed, as a fraction of the portrait. Kept at
		// full resolution rather than averaged into blocks: the digit is four
		// pixels wide and an average loses it in the face behind it.
		this.badge = {from: 0.58, to: 1};

		// Two badges this far apart are different levels. Measured across a
		// roster: crew of one type at the same level match to the pixel, and
		// the closest pair at different levels sat 8.4 apart.
		this.badgeAccept = 4;
		this.badgeMargin = 4;

		this.badgeKey = 'crewBadges';

		// A portrait is reduced to the average colour of each cell of a 6x6
		// grid: coarse enough to shrug off a pixel of drift and the client's
		// anti-aliasing, fine enough that no two of the 58 crew collapse onto
		// the same numbers.
		this.blocks = 6;

		// The game draws two badges over the portrait — which ship the crew
		// member is on, top left, and their level, bottom right — so those
		// corners describe the assignment rather than the crew type. Both are
		// about a third of the tile.
		this.masked = 2;

		// Mean per-channel difference. Further away than this is not the same
		// portrait...
		this.accept = 34;

		// ...and the winner has to be this much closer than the runner up, or
		// the tile goes unidentified. A guess here sends you clicking on the
		// wrong crew member — which in this interface also crews your ship
		// with them — so it is worse than no answer at all.
		this.margin = 1.4;

		// The margin is a ratio, and a ratio cannot separate two candidates
		// that are both an exact match: 0 is not 1.4 times further away than 0.
		// Two types whose portraits agree to the pixel have to be declined, so
		// the runner up must also clear this many units of daylight.
		this.separation = 4;

		// How far to hunt for the portrait inside its tile.
		//
		// Sampling a pixel off the art is far more damaging than it sounds: a
		// tile a single pixel out of place lands about 20 units from its own
		// portrait, and the closest pairs of crew are barely 4 apart, so the
		// margin check then declines half the roster. The error is a constant —
		// the grid is found by exact pixel match and the tiles are evenly
		// spaced — so it is worth finding once and then reusing.
		this.search = 8;
		this.offset = null;

		// ...and then each row again on its own. The ship's row is drawn in its
		// own container above the roster and does not sit on the same rhythm:
		// with one offset for the whole grid its tiles landed 22 to 40 from
		// every portrait, the runner up half a unit behind, which is another
		// way of saying the signature had become noise. The roster rows below
		// it were matching at 5 at the same moment.
		this.rowSearch = 6;
		this.rowOffsets = null;

		// Appearances kept per crew type. The ship's own row draws its tiles
		// differently enough to matter — the same Travelling Drunk measures 19
		// there against 12 everywhere else — so a type needs room for both.
		this.samples = 4;

		// Two captures this close are the same appearance twice
		this.duplicate = 3;

		// Signatures of the bundled art, once computed
		this.templates = null;
		this.loading = null;

		// Corrections the player has made, which outrank the bundled art
		// Bumped when the grid geometry changed: everything learned before was
		// captured at a drifting position and describes tiles that no longer exist
		this.key = 'crewPortraits2';
	}

	/**
	 * The crew slot number the calculator gives this tile
	 *
	 * Column one holds the captains, so the crew start at column two and run
	 * left to right, top to bottom, from id 6.
	 *
	 * @param  {int} column  1 based, as the reader counts them
	 * @param  {int} row     1 based
	 * @return {int}         0 for the captains' column
	 */
	static slotAt(column, row){
		if(column <= 1){return 0;}

		return 6 + ((row - 1) * 5) + (column - 2);
	}

	/**
	 * Every crew type with a portrait, and where that portrait is served from
	 * @return {array}
	 */
	static portraits(){
		// An empty slot is drawn from art like any other, and it is not in
		// crew.json because it is not a crew type. Without it the scanner has
		// nothing to answer an empty tile with and reaches for the nearest real
		// crew member instead — one read as a Travelling Drunk from 47 away.
		let all = [{name: 'Empty', src: '/ports/public/images/empty.png'}];

		crewRegions.forEach(region => {
			region.sailors.forEach(sailor => {
				all.push({name: sailor[1], src: '/ports/public/images/' + sailor[0]});
			});
		});

		return all;
	}

	/**
	 * Reduce the bundled art to the same numbers a tile produces
	 *
	 * Every portrait has to be loaded and measured once before a scan can name
	 * anything, so this hands back a promise rather than pretending to be
	 * instant.
	 *
	 * @return {Promise}
	 */
	prepare(){
		if(this.templates){return Promise.resolve(this.templates);}
		if(this.loading){return this.loading;}

		let portraits = RosterScanner.portraits();

		this.loading = Promise.all(portraits.map(portrait => this.measure(portrait)))
			.then(measured => {
				this.templates = {};

				measured.forEach(entry => {
					if(!entry || !entry.signature){return;}

					this.templates[entry.name] = [entry.signature];
				});

				return this.templates;
			});

		return this.loading;
	}

	/**
	 * Load one portrait and sign it
	 * @param  {object} portrait
	 * @return {Promise}
	 */
	measure(portrait){
		return new Promise(resolve => {
			let image = new Image();

			image.onload = () => {
				try {
					let canvas = document.createElement('canvas');
					canvas.width = image.width;
					canvas.height = image.height;

					let context = canvas.getContext('2d');
					context.drawImage(image, 0, 0);

					let buffer = context.getImageData(0, 0, image.width, image.height);

					resolve({
						name: portrait.name,
						signature: this.sign(buffer, 0, 0, image.width),
					});
				} catch(e) {
					// A portrait served from anywhere but this app taints the
					// canvas and cannot be read back. They are all local now,
					// so this only fires if one goes missing.
					resolve(null);
				}
			};

			image.onerror = () => resolve(null);
			image.src = portrait.src;
		});
	}

	/**
	 * Which tile a screen position falls on
	 * @param  {int} gridX
	 * @param  {int} gridY
	 * @param  {int} tile
	 * @param  {object} position  from a1lib.mousePosition()
	 * @return {object|null}  1 based column and row
	 */
	static tileAt(gridX, gridY, tile, position){
		if(!position || position.x < 0 || position.y < 0){return null;}

		let column = Math.ceil((position.x - gridX) / tile);
		let row = Math.ceil((position.y - gridY) / tile);

		if(column < 1 || column > 6 || row < 1 || row > 5){return null;}

		return {column: column, row: row};
	}

	/**
	 * Grab the whole roster grid in one capture
	 * @param  {int} gridX  screen position of the grid, from the reader
	 * @param  {int} gridY
	 * @param  {int} tile   pitch of one tile, which the skin decides
	 * @return {ImageData|null}
	 */
	captureAt(gridX, gridY, tile){
		let width = this.columns * tile;
		let height = this.rows * tile;

		let region = a1lib.bindregion(gridX, gridY, width, height);

		if(!region){return null;}

		return region.toData(gridX, gridY, width, height);
	}

	/**
	 * Average each cell of a square region, skipping the badge corners
	 *
	 * Tiles and bundled art go through the same measurement, over the same
	 * fraction of themselves, which is what lets a 37px file be compared with
	 * whatever the client happens to be drawing.
	 *
	 * @param  {ImageData} buffer
	 * @param  {int} left
	 * @param  {int} top
	 * @param  {int} size
	 * @return {array|null}
	 */
	sign(buffer, left, top, size){
		if(size <= this.blocks){return null;}
		if(left < 0 || top < 0){return null;}
		if(left + size > buffer.width || top + size > buffer.height){return null;}

		let signature = [];

		for(let by = 0; by < this.blocks; by++){
			for(let bx = 0; bx < this.blocks; bx++){
				if(RosterScanner.badged(bx, by, this.blocks, this.masked)){continue;}

				let x0 = left + Math.floor((bx * size) / this.blocks);
				let x1 = left + Math.floor(((bx + 1) * size) / this.blocks);
				let y0 = top + Math.floor((by * size) / this.blocks);
				let y1 = top + Math.floor(((by + 1) * size) / this.blocks);

				let r = 0, g = 0, b = 0, count = 0;

				for(let y = y0; y < y1; y++){
					for(let x = x0; x < x1; x++){
						let i = ((y * buffer.width) + x) * 4;

						r += buffer.data[i];
						g += buffer.data[i + 1];
						b += buffer.data[i + 2];
						count++;
					}
				}

				if(!count){return null;}

				signature.push(Math.round(r / count), Math.round(g / count), Math.round(b / count));
			}
		}

		return signature.length ? signature : null;
	}

	/**
	 * Is this cell under one of the two badges?
	 * @param  {int} bx
	 * @param  {int} by
	 * @param  {int} blocks
	 * @param  {int} masked
	 * @return {boolean}
	 */
	static badged(bx, by, blocks, masked){
		let ship = bx < masked && by < masked;
		let level = bx >= (blocks - masked) && by >= (blocks - masked);

		return ship || level;
	}

	/**
	 * Sign one tile of a captured grid
	 * @param  {ImageData} buffer  the whole grid, from captureAt
	 * @param  {int} column        1 based
	 * @param  {int} row           1 based
	 * @param  {int} tile
	 * @param  {object} offset     where the art sits, once calibrated
	 * @return {array|null}
	 */
	/**
	 * Where the art sits in a given row
	 * @param  {int} row
	 * @return {object}
	 */
	offsetFor(row){
		if(this.rowOffsets && this.rowOffsets[row]){return this.rowOffsets[row];}

		return this.offset || {x: 0, y: 0};
	}

	signature(buffer, column, row, tile, offset){
		let nudge = offset || this.offsetFor(row);

		let left = ((column - 1) * tile) + Math.round(tile * this.portrait.from) + nudge.x;
		let top = ((row - 1) * tile) + Math.round(tile * this.portrait.from) + nudge.y;
		let size = Math.round(tile * (this.portrait.to - this.portrait.from));

		return this.sign(buffer, left, top, size);
	}

	/**
	 * Work out exactly where in a tile the portrait is drawn
	 *
	 * Every candidate offset is scored on the whole grid rather than one tile,
	 * because a single tile could be an empty slot or a crew type whose art
	 * happens to be forgiving. The right offset names the most tiles, and
	 * among ties, names them most closely.
	 *
	 * @param  {ImageData} buffer
	 * @param  {int} tile
	 * @param  {object} known
	 * @return {object}
	 */
	calibrate(buffer, tile, known){
		let best = null;

		for(let dy = -this.search; dy <= this.search; dy++){
			for(let dx = -this.search; dx <= this.search; dx++){
				let named = 0, total = 0;

				for(let row = 1; row <= this.rows; row++){
					for(let column = this.captainColumn + 1; column <= this.columns; column++){
						let signature = this.signature(buffer, column, row, tile, {x: dx, y: dy});

						if(!signature){continue;}

						let nearest = this.nearest(signature, known);

						if(nearest.distance <= this.accept){
							named++;
							total += nearest.distance;
						}
					}
				}

				if(!named){continue;}

				let mean = total / named;

				if(!best || named > best.named || (named === best.named && mean < best.mean)){
					best = {named: named, mean: mean, x: dx, y: dy};
				}
			}
		}

		this.offset = best ? {x: best.x, y: best.y} : {x: 0, y: 0};

		// Now each row on its own, starting from what the grid as a whole
		// settled on. Rows drawn on the same rhythm land back where they
		// started; the ship's row does not, and this is the only way it ever
		// gets read as well as the roster is.
		this.rowOffsets = {};

		for(let row = 1; row <= this.rows; row++){
			let bestRow = null;

			for(let dy = -this.rowSearch; dy <= this.rowSearch; dy++){
				for(let dx = -this.rowSearch; dx <= this.rowSearch; dx++){
					let nudge = {x: this.offset.x + dx, y: this.offset.y + dy};
					let named = 0, total = 0;

					for(let column = this.captainColumn + 1; column <= this.columns; column++){
						let signature = this.signature(buffer, column, row, tile, nudge);

						if(!signature){continue;}

						let nearest = this.nearest(signature, known);

						if(nearest.distance <= this.accept){
							named++;
							total += nearest.distance;
						}
					}

					if(!named){continue;}

					let mean = total / named;

					if(!bestRow || named > bestRow.named || (named === bestRow.named && mean < bestRow.mean)){
						bestRow = {named: named, mean: mean, x: nudge.x, y: nudge.y};
					}
				}
			}

			this.rowOffsets[row] = bestRow ? {x: bestRow.x, y: bestRow.y} : this.offset;
		}

		return this.offset;
	}

	/**
	 * The corner of a tile where its level is printed
	 *
	 * A portrait names a crew type and can never do better, so four Travelling
	 * Drunks are four identical answers. The level is the only thing on the
	 * tile that separates them, and reading the digit needs a font we do not
	 * have: the badge is drawn a size smaller than the details panel, a "5"
	 * being 4x8 there against 5x9 in the panel, and every panel template scores
	 * it below threshold.
	 *
	 * It does not have to be read, though. Two crew of one type have identical
	 * portraits, so their corners can only differ by the number printed on
	 * them — which makes "is this the level 3 one" answerable without ever
	 * knowing what a 3 looks like.
	 *
	 * @param  {ImageData} buffer  the whole grid
	 * @param  {int} column        1 based
	 * @param  {int} row           1 based
	 * @param  {int} tile
	 * @return {array|null}
	 */
	corner(buffer, column, row, tile){
		let nudge = this.offsetFor(row);

		let art = Math.round(tile * this.portrait.from);
		let size = Math.round(tile * (this.portrait.to - this.portrait.from));

		let left = ((column - 1) * tile) + art + nudge.x + Math.round(size * this.badge.from);
		let top = ((row - 1) * tile) + art + nudge.y + Math.round(size * this.badge.from);
		let box = Math.round(size * (this.badge.to - this.badge.from));

		if(left < 0 || top < 0){return null;}
		if(left + box > buffer.width || top + box > buffer.height){return null;}

		let out = [];

		for(let y = top; y < top + box; y++){
			for(let x = left; x < left + box; x++){
				let i = ((y * buffer.width) + x) * 4;

				out.push(buffer.data[i], buffer.data[i + 1], buffer.data[i + 2]);
			}
		}

		return out;
	}

	/**
	 * Corners seen before, keyed by crew type and level
	 * @return {object}
	 */
	badges(){
		try {
			return JSON.parse(localStorage.getItem(this.badgeKey)) || {};
		} catch(e) {
			return {};
		}
	}

	/**
	 * Remember what this crew type looks like at this level
	 * @param  {string} type
	 * @param  {int|string} level
	 * @param  {array} corner
	 * @return {boolean}
	 */
	rememberBadge(type, level, corner){
		if(!type || type === 'Empty' || type === 'captain' || !level || !corner){return false;}

		let badges = this.badges();
		let key = `${type}|${level}`;
		let samples = badges[key] || [];

		for(let i = 0; i < samples.length; i++){
			if(RosterScanner.distance(corner, samples[i]) < this.badgeAccept){return false;}
		}

		badges[key] = [corner].concat(samples).slice(0, this.samples);

		localStorage.setItem(this.badgeKey, JSON.stringify(badges));

		return true;
	}

	/**
	 * What level the crew member in this tile is
	 *
	 * Only levels seen before for this crew type can be answered, which is all
	 * that is ever asked: the question is only ever which of the ones in the
	 * roster this is.
	 *
	 * @param  {array} corner
	 * @param  {string} type
	 * @param  {object} badges  passed in so a scan reads storage once
	 * @return {int|null}
	 */
	levelOf(corner, type, badges){
		if(!corner || !type){return null;}

		let best = null, bestDistance = Infinity, runnerUp = Infinity;

		Object.keys(badges).forEach(key => {
			if(key.indexOf(type + '|') !== 0){return;}

			let level = key.slice(type.length + 1);
			let distance = (badges[key] || []).reduce(
				(closest, sample) => Math.min(closest, RosterScanner.distance(corner, sample)), Infinity
			);

			if(distance < bestDistance){
				runnerUp = bestDistance;
				bestDistance = distance;
				best = level;
			} else if(distance < runnerUp){
				runnerUp = distance;
			}
		});

		if(best === null || bestDistance > this.badgeAccept){return null;}

		// Only one level of this type has ever been seen, so there is nothing
		// to have told it apart from
		if(runnerUp === Infinity){return Number(best);}

		return (runnerUp - bestDistance) >= this.badgeMargin ? Number(best) : null;
	}

	/**
	 * Mean per-channel difference between two signatures
	 * @param  {array} a
	 * @param  {array} b
	 * @return {number}
	 */
	static distance(a, b){
		if(!a || !b || a.length !== b.length || !a.length){return Infinity;}

		let total = 0;

		for(let i = 0; i < a.length; i++){
			total += Math.abs(a[i] - b[i]);
		}

		return total / a.length;
	}

	/**
	 * Corrections the player has made by hand
	 *
	 * The bundled art answers for every crew type already, so this only exists
	 * for the case where the client draws something the file does not predict.
	 *
	 * @return {object}
	 */
	library(){
		try {
			return JSON.parse(localStorage.getItem(this.key)) || {};
		} catch(e) {
			return {};
		}
	}

	/**
	 * Everything available to match against, corrections first
	 *
	 * Narrowing this to the crew types actually in the roster is worth doing
	 * wherever the caller knows them. Several of the 58 are near enough
	 * identical — Fireworks Enthusiast and Firework Expert sit about four units
	 * apart — and asking whether a tile is one of the fifteen types you own is
	 * a far easier question than asking which of all fifty-eight it is.
	 *
	 * @param  {array} candidates  crew type names, or nothing for all of them
	 * @return {object}
	 */
	known(candidates){
		let known = Object.assign({}, this.templates || {});
		let corrections = this.library();

		Object.keys(corrections).forEach(name => {
			known[name] = (corrections[name] || []).concat(known[name] || []);
		});

		if(!candidates || !candidates.length){return known;}

		let narrowed = {};

		candidates.forEach(name => {
			if(known[name]){narrowed[name] = known[name];}
		});

		// An empty slot is always a possibility, whatever the roster holds
		if(known.Empty){narrowed.Empty = known.Empty;}

		// A narrowed field needs at least two real types in it. With only one
		// candidate there is no runner up, so the margin check — the thing
		// that stops a tile being named on a weak resemblance — has nothing to
		// weigh against, and every tile would come back as that one type.
		let real = Object.keys(narrowed).filter(name => name !== 'Empty');

		return real.length >= 2 ? narrowed : known;
	}

	/**
	 * How many crew types can be named on sight
	 * @return {int}
	 */
	learned(){
		return Object.keys(this.known()).length;
	}

	/**
	 * Remember what this crew type looks like on this client
	 * @param  {string} name
	 * @param  {array} signature
	 * @return {boolean}  whether this was an appearance we did not already have
	 */
	remember(name, signature){
		if(!name || !signature || name === 'captain'){return false;}

		let corrections = this.library();
		let samples = corrections[name] || [];

		// Measured against what has already been captured from this client, and
		// only a near-identical capture counts as one we have.
		//
		// This used to measure against the bundled art as well, at half the
		// accept threshold, which is what stopped it learning anything: the
		// whole reason to capture is that the client draws a portrait ten to
		// twenty units away from the art, and that was exactly the distance
		// being read as "already had it". Nineteen crew read, five kept.
		for(let i = 0; i < samples.length; i++){
			if(RosterScanner.distance(signature, samples[i]) < this.duplicate){return false;}
		}

		corrections[name] = [signature].concat(samples).slice(0, this.samples);

		localStorage.setItem(this.key, JSON.stringify(corrections));

		return true;
	}

	/**
	 * Throw away the corrections, leaving the bundled art
	 * @return {void}
	 */
	forget(){
		localStorage.removeItem(this.key);
	}

	/**
	 * The closest crew type to this signature, and the next closest
	 * @param  {array} signature
	 * @param  {object} known
	 * @return {object}
	 */
	nearest(signature, known){
		let names = Object.keys(known);
		let best = null, bestDistance = Infinity, runnerUp = Infinity;

		for(let i = 0; i < names.length; i++){
			let samples = known[names[i]] || [];
			let distance = Infinity;

			for(let s = 0; s < samples.length; s++){
				distance = Math.min(distance, RosterScanner.distance(signature, samples[s]));
			}

			if(distance < bestDistance){
				runnerUp = bestDistance;
				bestDistance = distance;
				best = names[i];
			} else if(distance < runnerUp){
				runnerUp = distance;
			}
		}

		return {name: best, distance: bestDistance, runnerUp: runnerUp};
	}

	/**
	 * Name the crew type whose portrait this is
	 * @param  {array} signature
	 * @param  {object} known  passed in so a scan builds the list once
	 * @return {object|null}
	 */
	identify(signature, known){
		let nearest = this.nearest(signature, known);

		if(nearest.name === null || nearest.distance > this.accept){return null;}

		// With only one type to compare against there is no runner up, and
		// nothing then shows the answer is *distinctive* — only that it is
		// close. Everything on the roster would come back as that one type, so
		// it has to be near enough exact instead.
		if(nearest.runnerUp === Infinity){
			return nearest.distance <= this.separation
				? {name: nearest.name, distance: nearest.distance}
				: null;
		}

		// Too close to call. Two crew types this similar means the portrait is
		// not specific enough to point at a tile with.
		if((nearest.distance * this.margin) + this.separation > nearest.runnerUp){return null;}

		return {name: nearest.name, distance: nearest.distance};
	}

	/**
	 * Read the whole roster
	 * @param  {array} candidates  crew types the roster is known to hold
	 * @return {object|null}  null when the crew interface is not on screen
	 */
	scan(candidates){
		let location = this.reader.locate();

		if(!location){return null;}

		let tile = location.skin.grid.tile;
		let buffer = this.captureAt(location.gridX, location.gridY, tile);

		if(!buffer){return null;}

		let known = this.known(candidates);
		let badges = this.badges();

		// Where the art sits in a tile is the same every time, so this is paid
		// once rather than on every pass
		if(!this.offset || !this.rowOffsets){this.calibrate(buffer, tile, known);}

		let tiles = [];

		for(let row = 1; row <= this.rows; row++){
			for(let column = this.captainColumn + 1; column <= this.columns; column++){
				let signature = this.signature(buffer, column, row, tile);
				let match = signature ? this.identify(signature, known) : null;

				// What the tile looked like regardless of whether it cleared the
				// gates, so a scan that names nothing can still say why
				let near = signature ? this.nearest(signature, known) : null;

				// Which of several identical crew this is, where the corner has
				// been seen before
				let level = match ? this.levelOf(this.corner(buffer, column, row, tile), match.name, badges) : null;

				tiles.push({
					slot: RosterScanner.slotAt(column, row),
					column: column,
					row: row,
					level: level,
					x: location.gridX + ((column - 1) * tile),
					y: location.gridY + ((row - 1) * tile),
					size: tile,
					type: match ? match.name : '',
					distance: match ? match.distance : null,
					nearest: near ? near.name : '',
					nearestDistance: near ? near.distance : null,
					runnerUp: near ? near.runnerUp : null,
				});
			}
		}

		return {location: location, tiles: tiles, offset: this.offset, rowOffsets: this.rowOffsets};
	}

	/**
	 * Find where the voyage's picks are sitting right now
	 *
	 * A portrait names a crew type, not an individual, so a type the roster
	 * holds more than one of can only be narrowed to "one of these". Where the
	 * voyage wants every one it can see, that ambiguity disappears: all of them
	 * are going.
	 *
	 * @param  {object} scan   from scan(), passed in so a pass captures once
	 * @param  {array} picks  the crew the calculator chose, {type, level}
	 * @param  {array} crewed types already sitting in the ship's row, which
	 *                        are picks that no longer need clicking
	 * @return {object}
	 */
	find(scan, picks, crewed){
		if(!scan){return {found: false, reason: 'interface'};}

		let remaining = (picks || [])
			.filter(pick => pick && pick.type && pick.type !== 'Empty')
			.map(pick => ({type: pick.type, level: pick.level}));

		let aboard = (crewed || []).map(entry => ({
			type: entry.type,
			level: entry.level,
			tile: entry.tile,
			certain: entry.certain,
			matched: false,
		}));

		// Each crew member already aboard settles one of the picks. A level we
		// know has to match exactly — a Brimhaven Pirate at level 4 does not
		// satisfy a voyage asking for one at level 5, it is simply occupying the
		// slot that one needs.
		aboard.forEach(entry => {
			if(!entry.level){return;}

			let at = remaining.findIndex(pick => pick.type === entry.type
				&& Number(pick.level) === Number(entry.level));

			if(at === -1){return;}

			remaining.splice(at, 1);
			entry.matched = true;
		});

		// A pick with no level recorded cannot be matched exactly by anybody, so
		// the type is all there is to go on for it too. Without this, a crew
		// member aboard whose level *is* known matched nothing and was declared
		// surplus — telling you to take off the First Mate the voyage wanted.
		aboard.forEach(entry => {
			if(entry.matched){return;}

			let at = remaining.findIndex(pick => pick.type === entry.type && !pick.level);

			if(at === -1){return;}

			remaining.splice(at, 1);
			entry.matched = true;
		});

		// Without a level, all that is known is that one of this type is aboard.
		// It cannot be called surplus, and it cannot be matched to a particular
		// pick either — choosing one would send you hunting for a crew member
		// already on the ship.
		let covered = {};
		let outstanding = {};

		remaining.forEach(pick => {
			outstanding[pick.type] = (outstanding[pick.type] || 0) + 1;
		});

		aboard.forEach(entry => {
			if(entry.matched || entry.level){return;}

			// Only as many as the voyage actually asked for. Without the count
			// coming down, every crew member of that type aboard answered the
			// same single pick — so a second Brimhaven Pirate on a ship wanting
			// one looked accounted for, and never showed up as surplus.
			if(!outstanding[entry.type]){return;}

			outstanding[entry.type]--;
			covered[entry.type] = (covered[entry.type] || 0) + 1;
			entry.matched = true;
		});

		// Anyone aboard still unmatched is holding a slot the voyage needs.
		// Every pick has had its pick of them by now, so whoever is left over
		// is left over.
		//
		// This used to be claimed only for crew that had been hovered, out of
		// caution about trusting a portrait — but the same portraits are already
		// trusted to satisfy a pick, and refusing to trust them here meant that
		// a full ship with picks outstanding said nothing at all. That is the
		// one moment the advice is the only thing that helps.
		let spares = aboard.filter(entry => entry.tile && !entry.matched);

		// Levels wanted per type, not just a count. A portrait cannot separate
		// four Travelling Drunks, but the game prints each one's level on its
		// tile, so saying which level to look for turns a guess into a glance.
		let wanted = {};

		remaining.forEach(pick => {
			wanted[pick.type] = wanted[pick.type] || {count: 0, levels: []};
			wanted[pick.type].count++;

			if(pick.level){wanted[pick.type].levels.push(pick.level);}
		});

		// One fewer of that type to go and find, but every level stays on the
		// list, since which of them is aboard is exactly what is not known
		Object.keys(covered).forEach(type => {
			if(!wanted[type]){return;}

			wanted[type].count -= covered[type];

			if(wanted[type].count <= 0){delete wanted[type];}
		});

		let holding = {};
		let unknown = 0;

		scan.tiles.forEach(tile => {
			// The top row is the ship's own crew, not somewhere to click
			if(tile.row === 1){return;}
			if(!tile.type){return unknown++;}

			holding[tile.type] = holding[tile.type] || [];
			holding[tile.type].push(tile);
		});

		// A tile whose level is known answers the question a portrait cannot,
		// so it needs no hovering and no reading of the number by eye
		Object.keys(holding).forEach(name => {
			if(!wanted[name] || !wanted[name].levels.length){return;}

			let named = holding[name].filter(tile => tile.level);

			if(!named.length){return;}

			let matching = named.filter(tile => wanted[name].levels.some(
				level => Number(level) === Number(tile.level)
			));

			// Every level wanted has been found by its own badge, so the rest
			// of that type are not candidates at all
			if(matching.length >= wanted[name].count){holding[name] = matching;}
		});

		let marks = [], missing = [];

		Object.keys(wanted).forEach(name => {
			let tiles = holding[name] || [];

			if(!tiles.length){return missing.push(name);}

			// Only as many tiles as the voyage needs means each one is going,
			// so there is nothing left to be unsure about
			let certain = tiles.length <= wanted[name].count;

			// Which levels to look for, when the portrait alone cannot say
			let levels = certain ? [] : wanted[name].levels.slice().sort((a, b) => a - b);

			// Every one of them holds a level the voyage wants and there are
			// more than it needs, so they are the same crew member as far as
			// this voyage is concerned. Saying "check the level" there sends
			// you to compare two numbers that are equal.
			let interchangeable = !certain && levels.length
				&& tiles.every(tile => tile.level
					&& levels.some(level => Number(level) === Number(tile.level)));

			tiles.forEach(tile => marks.push({
				tile: tile,
				type: name,
				certain: certain,
				interchangeable: !!interchangeable,
				levels: interchangeable ? [] : levels,
			}));
		});

		return {
			found: true,
			scan: scan,
			marks: marks,
			spares: spares,
			missing: missing,
			unknown: unknown,

			// How the decision was reached, for the report
			aboard: aboard,
			wanted: wanted,
			remaining: remaining,
		};
	}

	/**
	 * What the ship's own row is currently crewed with
	 *
	 * Portraits give the type and no more. A level appears here only for tiles
	 * that have been hovered, since only the panel knows which of several
	 * identical crew is the one sitting up there.
	 *
	 * @param  {object} scan
	 * @param  {object} known  levels learned by hovering, keyed "column,row"
	 * @return {array}  {type, level}
	 */
	static aboard(scan, known){
		if(!scan){return [];}

		return scan.tiles
			.filter(tile => tile.row === 1)
			.map(tile => {
				let seen = known && known[`${tile.column},${tile.row}`];

				// Hovering says outright who is up there, and that stands on its
				// own. Requiring the portrait to agree first threw the answer
				// away for exactly the crew it was needed for: someone just
				// moved into the ship's row has never been seen in it, the row
				// draws its tiles differently, so the portrait cannot place them
				// — and the crew member you had only just put aboard went on
				// being asked for.
				if(seen && (!tile.type || seen.type === tile.type)){
					// Hovered, so this is who it is whether or not the level
					// came through with it
					return seen.type === 'Empty'
						? null
						: {type: seen.type, level: seen.level, tile: tile, certain: true};
				}

				if(!tile.type || tile.type === 'Empty'){return null;}

				return {type: tile.type, level: null, tile: tile};
			})
			.filter(entry => entry);
	}

	/**
	 * How much room is left on the ship
	 *
	 * The ship's row is the ground truth about how many more crew can be taken,
	 * whoever we can or cannot name. An unrecognised tile counts as occupied:
	 * an empty slot has art like anything else, so a tile we cannot place is
	 * far more likely to be a crew member drawn in a way we have not seen than
	 * an empty slot we would have matched.
	 *
	 * @param  {object} scan
	 * @param  {object} known  levels learned by hovering
	 * @return {object|null}  {free, unknown}
	 */
	static room(scan, known){
		if(!scan){return null;}

		let row = scan.tiles.filter(tile => tile.row === 1);

		if(!row.length){return null;}

		let free = 0, unknown = 0;

		row.forEach(tile => {
			let seen = known && known[`${tile.column},${tile.row}`];
			let type = (seen && (!tile.type || seen.type === tile.type)) ? seen.type : tile.type;

			if(type === 'Empty'){free++;}
			else if(!type){unknown++;}
		});

		return {free: free, unknown: unknown};
	}

	/**
	 * Draw boxes on the game screen around the tiles we found
	 * @param  {array} marks    from find()
	 * @param  {int} seconds
	 * @return {void}
	 */
	show(marks, seconds = 0.7, spares){
		if(!window.alt1 || !alt1.overLayRect){return;}

		let green = a1lib.mixcolor(80, 255, 80);
		let amber = a1lib.mixcolor(255, 190, 60);
		let red = a1lib.mixcolor(255, 80, 80);
		let blue = a1lib.mixcolor(120, 190, 255);

		// Crew aboard that this voyage has no use for. Without these the boxes
		// can ask for two more crew members when the ship has one slot left,
		// which is arithmetic nobody can act on.
		(spares || []).forEach(spare => {
			let tile = spare.tile;

			alt1.overLayRect(blue, tile.x + 1, tile.y + 1, tile.size - 2, tile.size - 2, seconds * 1000, 2);

			if(!alt1.overLayTextEx){return;}

			alt1.overLayTextEx('take off', blue, 10, tile.x + 2, tile.y - 10, seconds * 1000, null, false, true);
		});

		marks.forEach(mark => {
			let tile = mark.tile;

			// A verdict comes from hovering the tile and reading the panel,
			// which knows exactly who is there — so it settles what a portrait
			// never can, and outranks it.
			let colour = amber, label = '';

			if(mark.certain || mark.verdict === true){
				colour = green;
				label = mark.verdict === true ? 'this one' : '';
			} else if(mark.interchangeable){
				colour = green;
				label = 'any of these';
			} else if(mark.verdict === false){
				colour = red;
				label = 'not this one';
			} else if(mark.levels.length){
				// The game prints the level on every tile, so saying which
				// level is wanted is the difference between checking four crew
				// members and reading one number
				label = 'want ' + mark.levels.join(' or ');
			}

			alt1.overLayRect(
				colour,
				tile.x + 1, tile.y + 1,
				tile.size - 2, tile.size - 2,
				seconds * 1000, 2
			);

			if(!label || !alt1.overLayTextEx){return;}

			alt1.overLayTextEx(label, colour, 10, tile.x + 2, tile.y - 10, seconds * 1000, null, false, true);
		});
	}
}
