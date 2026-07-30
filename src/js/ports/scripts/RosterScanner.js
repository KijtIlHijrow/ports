/**
 * Works out which crew member is sitting in each roster tile, from the
 * portraits alone.
 *
 * The reader can only ever see one crew member, because the details panel
 * shows whoever was last clicked. Everything the calculator knows is filed
 * under a slot number instead, and RuneScape reorders the roster, so after a
 * reshuffle the app's idea of slot 12 and the game's have nothing to do with
 * one another. That is what turns "send the Cyclops" into clicking every tile
 * until one of them is a Cyclops.
 *
 * Portraits do not move with the crew, though. A Cyclops draws the same
 * whichever tile it lands in, so matching the art says where everyone is
 * without a single click.
 *
 * The library of portraits is learned from the reads the app already does,
 * rather than shipped, for the same reason the digits are: a reference
 * captured anywhere but this client, at this interface scale, would not match.
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

		// Sample the middle of a tile only. The frame around it is redrawn
		// when a crew member is selected or hovered, and that says nothing
		// about who is in the tile.
		this.inset = 9;

		// A portrait is reduced to the average colour of each cell of a 6x6
		// grid: coarse enough to shrug off a pixel of drift, fine enough that
		// no two of the 58 crew collapse onto the same numbers.
		this.blocks = 6;

		// Mean per-channel difference. Further away than this is not the same
		// portrait...
		this.accept = 30;

		// ...and the winner has to be this much closer than the runner up, or
		// the tile goes unidentified. A guess here sends you clicking on the
		// wrong crew member, which is worse than no answer at all — the same
		// reason the type reader abstains.
		this.margin = 1.4;

		// The margin is a ratio, and a ratio cannot separate two candidates
		// that are both an exact match: 0 is not 1.4 times further away than 0.
		// Two types whose portraits agree to the pixel have to be declined, so
		// the runner up must also clear this many units of daylight.
		this.separation = 4;

		// Appearances remembered per crew type. A tile is drawn differently
		// selected and unselected, and both are worth having.
		this.samples = 4;

		// Two signatures this close are the same appearance already learned
		this.duplicate = 6;

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
	 * Reduce one tile's portrait to the numbers we compare
	 * @param  {ImageData} buffer  the whole grid, from captureAt
	 * @param  {int} column        1 based
	 * @param  {int} row           1 based
	 * @param  {int} tile
	 * @return {array|null}
	 */
	signature(buffer, column, row, tile){
		let left = ((column - 1) * tile) + this.inset;
		let top = ((row - 1) * tile) + this.inset;
		let size = tile - (this.inset * 2);

		if(size <= 0){return null;}
		if(left < 0 || top < 0){return null;}
		if(left + size > buffer.width || top + size > buffer.height){return null;}

		let signature = [];

		for(let by = 0; by < this.blocks; by++){
			for(let bx = 0; bx < this.blocks; bx++){
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

		return signature;
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
	 * Every portrait learned so far, keyed by crew type
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
	 * How many crew types have a portrait on file
	 * @return {int}
	 */
	learned(){
		return Object.keys(this.library()).length;
	}

	/**
	 * Remember what this crew type looks like in the roster
	 * @param  {string} name
	 * @param  {array} signature
	 * @return {boolean}  whether this was an appearance we did not already have
	 */
	remember(name, signature){
		if(!name || !signature || name === 'captain'){return false;}

		let library = this.library();
		let samples = library[name] || [];

		// An appearance we already hold teaches nothing, and keeping it would
		// push a genuinely different one out of the list
		for(let i = 0; i < samples.length; i++){
			if(RosterScanner.distance(signature, samples[i]) < this.duplicate){return false;}
		}

		samples.unshift(signature);
		library[name] = samples.slice(0, this.samples);

		localStorage.setItem(this.key, JSON.stringify(library));

		return true;
	}

	/**
	 * Throw the whole library away, for when the interface scale changes and
	 * every portrait on file is the wrong size
	 * @return {void}
	 */
	forget(){
		localStorage.removeItem(this.key);
	}

	/**
	 * Name the crew type whose portrait this is
	 * @param  {array} signature
	 * @param  {object} library  passed in so a scan reads storage once
	 * @return {object|null}
	 */
	identify(signature, library){
		let names = Object.keys(library);
		let best = null, bestDistance = Infinity, runnerUp = Infinity;

		for(let i = 0; i < names.length; i++){
			let samples = library[names[i]] || [];
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

		if(best === null || bestDistance > this.accept){return null;}

		// Too close to call. Two crew types this similar means the portrait on
		// file is not specific enough to point at a tile with.
		if((bestDistance * this.margin) + this.separation > runnerUp){return null;}

		return {name: best, distance: bestDistance};
	}

	/**
	 * Read the whole roster
	 * @return {object|null}  null when the crew interface is not on screen
	 */
	scan(){
		let location = this.reader.locate();

		if(!location){return null;}

		let tile = location.skin.grid.tile;
		let buffer = this.captureAt(location.gridX, location.gridY, tile);

		if(!buffer){return null;}

		let library = this.library();
		let tiles = [];

		for(let row = 1; row <= this.rows; row++){
			for(let column = this.captainColumn + 1; column <= this.columns; column++){
				let signature = this.signature(buffer, column, row, tile);
				let match = signature ? this.identify(signature, library) : null;

				tiles.push({
					slot: RosterScanner.slotAt(column, row),
					column: column,
					row: row,
					x: location.gridX + ((column - 1) * tile),
					y: location.gridY + ((row - 1) * tile),
					size: tile,
					type: match ? match.name : '',
					distance: match ? match.distance : null,
				});
			}
		}

		return {location: location, tiles: tiles};
	}

	/**
	 * Find where the voyage's picks are sitting right now
	 *
	 * A portrait names a crew type, not an individual, so a type the roster
	 * holds more than one of can only be narrowed to "one of these". Where the
	 * voyage wants every one it can see, that ambiguity disappears: all of them
	 * are going.
	 *
	 * @param  {array} picks  crew type names the calculator chose
	 * @return {object}
	 */
	find(picks){
		let scan = this.scan();

		if(!scan){return {found: false, reason: 'interface'};}

		let wanted = {};

		picks.forEach(name => {
			if(!name || name === 'Empty'){return;}
			wanted[name] = (wanted[name] || 0) + 1;
		});

		let holding = {};
		let unknown = 0;

		scan.tiles.forEach(tile => {
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
	 * Draw boxes on the game screen around the tiles we found
	 * @param  {array} marks    from find()
	 * @param  {int} seconds
	 * @return {void}
	 */
	show(marks, seconds = 12){
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
