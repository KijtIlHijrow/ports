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
		// The art is 37px in a 53px tile, centred, and measuring it in
		// fractions rather than pixels keeps this independent of the interface
		// scale in the same way the tile pitch already is.
		this.portrait = {from: 8 / 53, to: 45 / 53};

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
		this.search = 3;
		this.offset = null;

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
		this.key = 'crewPortraits';
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
	signature(buffer, column, row, tile, offset){
		let nudge = offset || this.offset || {x: 0, y: 0};

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

		return this.offset;
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

		// Where the art sits in a tile is the same every time, so this is paid
		// once rather than on every pass
		if(!this.offset){this.calibrate(buffer, tile, known);}

		let tiles = [];

		for(let row = 1; row <= this.rows; row++){
			for(let column = this.captainColumn + 1; column <= this.columns; column++){
				let signature = this.signature(buffer, column, row, tile);
				let match = signature ? this.identify(signature, known) : null;

				// What the tile looked like regardless of whether it cleared the
				// gates, so a scan that names nothing can still say why
				let near = signature ? this.nearest(signature, known) : null;

				tiles.push({
					slot: RosterScanner.slotAt(column, row),
					column: column,
					row: row,
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

		return {location: location, tiles: tiles, offset: this.offset};
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
	 * @param  {array} picks  crew type names the calculator chose
	 * @param  {array} crewed types already sitting in the ship's row, which
	 *                        are picks that no longer need clicking
	 * @return {object}
	 */
	find(scan, picks, crewed){
		if(!scan){return {found: false, reason: 'interface'};}

		let wanted = {};

		picks.forEach(name => {
			if(!name || name === 'Empty'){return;}
			wanted[name] = (wanted[name] || 0) + 1;
		});

		// Anything already aboard is one fewer to go and find
		(crewed || []).forEach(name => {
			if(wanted[name]){wanted[name]--;}
			if(!wanted[name]){delete wanted[name];}
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

		let marks = [], missing = [];

		Object.keys(wanted).forEach(name => {
			let tiles = holding[name] || [];

			if(!tiles.length){return missing.push(name);}

			// Only as many tiles as the voyage needs means each one is going,
			// so there is nothing left to be unsure about
			let certain = tiles.length <= wanted[name];

			tiles.forEach(tile => marks.push({tile: tile, type: name, certain: certain}));
		});

		return {
			found: true,
			scan: scan,
			marks: marks,
			missing: missing,
			unknown: unknown,
		};
	}

	/**
	 * What the ship's own row is currently crewed with
	 * @param  {object} scan
	 * @return {array}
	 */
	static aboard(scan){
		if(!scan){return [];}

		return scan.tiles.filter(tile => tile.row === 1 && tile.type).map(tile => tile.type);
	}

	/**
	 * Draw boxes on the game screen around the tiles we found
	 * @param  {array} marks    from find()
	 * @param  {int} seconds
	 * @return {void}
	 */
	show(marks, seconds = 0.7){
		if(!window.alt1 || !alt1.overLayRect){return;}

		let green = a1lib.mixcolor(80, 255, 80);
		let amber = a1lib.mixcolor(255, 190, 60);

		marks.forEach(mark => {
			let tile = mark.tile;

			alt1.overLayRect(
				mark.certain ? green : amber,
				tile.x + 1, tile.y + 1,
				tile.size - 2, tile.size - 2,
				seconds * 1000, 2
			);
		});
	}
}
