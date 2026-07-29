import digits from '../data/digits.json';

/**
 * Reads the numbers in the port interfaces by template-matching digits.
 *
 * The OCR library cannot help here. Its fonts describe the old client's crisp
 * glyphs, and the current one anti-aliases its text: the same "0" is a 5x8
 * rectangle in the font and a 5x9 oval on screen. Every stock font was tried,
 * old and current, at every unblend mode and match threshold down to 0.5, and
 * none reads a single value.
 *
 * The values we need are only ever digits, though, which is a small enough
 * alphabet to match directly against templates taken from the client itself.
 * That also makes this independent of the interface skin and scale.
 */
export default class DigitReader
{
	constructor(){
		this.digits = digits;

		// Glyphs are 9px tall; a value never spans more than this
		this.height = 9;
		this.width = 70;

		// A pixel belongs to a digit if it is bright AND unsaturated. Brightness
		// alone is not enough: the orange stat labels sit immediately left of the
		// values, and the adversity percentages are drawn over a green bar.
		this.threshold = 105;
		this.saturation = 45;
	}

	/**
	 * Is this pixel part of the white text?
	 * @param  {ImageData} buffer
	 * @param  {int} x
	 * @param  {int} y
	 * @return {boolean}
	 */
	lit(buffer, x, y){
		if(x < 0 || y < 0 || x >= buffer.width || y >= buffer.height){return false;}

		let i = (y * buffer.width + x) * 4;
		let r = buffer.data[i], g = buffer.data[i + 1], b = buffer.data[i + 2];

		if(Math.max(r, g, b) - Math.min(r, g, b) > this.saturation){return false;}

		return (r * 0.299 + g * 0.587 + b * 0.114) > this.threshold;
	}

	/**
	 * Split a band of the image into glyphs on its blank columns
	 * @param  {ImageData} buffer
	 * @param  {int} x0
	 * @param  {int} x1
	 * @param  {int} y0
	 * @param  {int} y1
	 * @return {array}
	 */
	segment(buffer, x0, x1, y0, y1){
		let columns = [];

		for(let x = x0; x <= x1; x++){
			let any = false;

			for(let y = y0; y <= y1; y++){
				if(this.lit(buffer, x, y)){any = true; break;}
			}

			columns.push(any);
		}

		let spans = [], start = null;

		for(let i = 0; i <= columns.length; i++){
			if(columns[i] && start === null){start = i;}

			if((!columns[i] || i === columns.length) && start !== null){
				spans.push({from: x0 + start, to: x0 + i - 1});
				start = null;
			}
		}

		return spans.map(span => {
			let top = y1, bottom = y0;

			for(let x = span.from; x <= span.to; x++){
				for(let y = y0; y <= y1; y++){
					if(!this.lit(buffer, x, y)){continue;}
					if(y < top){top = y;}
					if(y > bottom){bottom = y;}
				}
			}

			let bits = [];

			for(let y = top; y <= bottom; y++){
				let row = '';

				for(let x = span.from; x <= span.to; x++){
					row += this.lit(buffer, x, y) ? '1' : '0';
				}

				bits.push(row);
			}

			return {bits: bits, width: span.to - span.from + 1, height: bottom - top + 1};
		});
	}

	/**
	 * Overlap between two glyph bitmaps, 0 to 1
	 * @param  {array} a
	 * @param  {array} b
	 * @return {number}
	 */
	score(a, b){
		let height = Math.max(a.length, b.length);
		let width = Math.max(a[0].length, b[0].length);
		let same = 0, total = 0;

		for(let y = 0; y < height; y++){
			for(let x = 0; x < width; x++){
				let pa = !!(a[y] && a[y][x] === '1');
				let pb = !!(b[y] && b[y][x] === '1');

				if(!pa && !pb){continue;}

				total++;
				if(pa === pb){same++;}
			}
		}

		return total ? same / total : 0;
	}

	/**
	 * Identify a single glyph
	 * @param  {object} glyph
	 * @return {string|null}
	 */
	classify(glyph){
		let best = null, bestScore = 0;

		for(let digit in this.digits){
			let template = this.digits[digit];

			// Anti-aliasing can add or drop an edge row, but nothing more
			if(Math.abs(template.h - glyph.height) > 1){continue;}

			let score = this.score(glyph.bits, template.bits);

			if(score > bestScore){
				bestScore = score;
				best = digit;
			}
		}

		return bestScore >= 0.8 ? best : null;
	}

	/**
	 * Read the number whose glyphs sit on the given baseline
	 * @param  {ImageData} buffer
	 * @param  {int} x        left edge to start scanning from
	 * @param  {int} baseline y of the bottom row of the digits
	 * @param  {boolean} lenient  drop unreadable glyphs instead of failing
	 * @return {string}
	 */
	read(buffer, x, baseline, lenient){
		let glyphs = this.segment(buffer, x, x + this.width, baseline - this.height - 1, baseline + 2);
		let value = '';

		for(let i = 0; i < glyphs.length; i++){
			let digit = this.classify(glyphs[i]);

			if(digit === null){
				// A half-read number is worse than none, so give up unless the
				// caller only wants whatever digits are in there
				if(!lenient){return '';}
				continue;
			}

			value += digit;
		}

		return value;
	}
}
