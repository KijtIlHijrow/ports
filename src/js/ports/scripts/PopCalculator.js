import solidarityValues from '../data/solidarity.json';
import traitValues from '../data/traits.json';

export default class PopCalculator
{
	constructor(captains, crew, rams, deckItems, hulls, shipwright)
	{
		this.captains = captains;
		this.crew = crew;
		this.rams = rams;
		this.deckItems = deckItems;
		this.hulls = hulls;
		this.shipwright = shipwright;

		this.applyModifiers(this.captains, shipwright);

		// Generate the crew combinations
		this.crewCombinations = Combinatorics.combination(this.crew, 5).toArray();

		this.applySolidarity(this.crewCombinations);

		// Generate the ship combinations
		this.shipCombinations = Combinatorics.cartesianProduct(this.rams, this.deckItems, this.deckItems, this.hulls).toArray();

		// Finally, generate all the possible combinations with 1 captain, 1 crew combination and 1 ship combination
		this.combinations = Combinatorics.cartesianProduct(this.captains, this.crewCombinations, this.shipCombinations);
	}

	/**
	 * Work out each captain's stat multiplier up front.
	 *
	 * Two things multiply a ship's finished totals rather than adding to them:
	 * the Shipwright building, which boosts every ship in the port, and the
	 * captain's own ship modifier traits — Leader, Tactician and Seafriend at
	 * +1% each, Gloombringer, Liability and Storm Magnet at -1%, up to four
	 * slots. They stack multiplicatively and the game then rounds the pair down
	 * to a whole percent, so a Nautical Shipwright over a Seafriend captain is
	 * 1.05 x 1.01 = 1.0605, which the ship sails as a flat 6%.
	 *
	 * This is the difference between what the ship's panel adds up to and the
	 * success chance the voyage screen shows, and without it the answer here is
	 * always the pessimistic one.
	 *
	 * The traits belong to the captain, so a single figure cannot stand for the
	 * whole run — but there are only ever five captains, so it still keeps the
	 * lookups out of the main loop.
	 *
	 * @param  {array} captains
	 * @param  {object} shipwright
	 * @return {void}
	 */
	applyModifiers(captains, shipwright)
	{
		let stats = ['morale', 'combat', 'seafaring'];

		for(let i = 0; i < captains.length; i++){
			let captain = captains[i];
			let traits = captain.traits || [];

			captain.multiplier = {};

			for(let s = 0; s < stats.length; s++){
				let stat = stats[s];

				// A shipwright with no bonus is stored as 0, not as 1
				let multiplier = shipwright && shipwright[stat] ? shipwright[stat] : 1;

				traits.forEach(name => {
					let trait = traitValues.find(trait => trait.name === name);

					if(trait){
						multiplier *= 1 + trait[stat] / 100;
					}
				});

				// Down to a whole percent, as the game does. The nudge is for
				// binary fractions: 1.05 x 1.01 lands a hair under 1.0605 as
				// often as over it, and 6% must not become 5%.
				captain.multiplier[stat] = 1 + Math.floor((multiplier - 1) * 100 + 1e-9) / 100;
			}
		}
	}

	/**
	 * Work out the Solidarity bonus for every crew combination up front.
	 *
	 * Solidarity adds X to all three stats for each unique unit type aboard,
	 * counting the captain, so the most a +25 bearer can give is 6 x 25. It does
	 * not stack: with two bearers aboard only one applies, so we take the
	 * strongest and assume it is placed leftmost (the game resolves traits left
	 * to right, and a weaker bearer to the left would suppress a stronger one).
	 *
	 * The bonus depends only on the crew, not the captain or the ship parts, so
	 * caching it here keeps it out of the main loop.
	 *
	 * @param  {array} crewCombinations
	 * @return {void}
	 */
	applySolidarity(crewCombinations)
	{
		for(let i = 0; i < crewCombinations.length; i++){
			let combination = crewCombinations[i];
			let types = [];
			let strongest = 0;
			let bearer = null;

			for(let c = 0; c < combination.length; c++){
				let name = combination[c].type.name;

				if(types.indexOf(name) == -1){
					types.push(name);
				}

				let solidarity = solidarityValues[name] || 0;

				if(solidarity > strongest){
					strongest = solidarity;
					bearer = name;
				}
			}

			// + 1 for the captain, who counts towards the unique types
			combination.solidarity = strongest * (types.length + 1);
			combination.solidarityBearer = bearer;
			combination.solidarityValue = strongest;
		}
	}

	calculate(moraleTarget, combatTarget, seafaringTarget)
	{
		return new Promise((resolve, reject) => {
			let best = {
				success_chance: 0,
				combination: null,
				morale: 0,
				combat: 0,
				seafaring: 0,
			};
			
			let moraleSuccessChance = 100, combatSuccessChance = 100, seafaringSuccessChance = 100, voyageSuccessChance = 0;

			let time1 = performance.now();

			let combination;
			while(combination = this.combinations.next())
			{		
				let morale = 0, combat = 0, seafaring = 0;

	           	// Captain
	           	morale += combination[0]['morale'];
	           	combat += combination[0]['combat'];
	           	seafaring += combination[0]['seafaring'];  

	           	// Crew
	           	morale += combination[1][0]['morale'];
	           	morale += combination[1][1]['morale'];
	           	morale += combination[1][2]['morale'];
	           	morale += combination[1][3]['morale'];
	           	morale += combination[1][4]['morale'];
	           	combat += combination[1][0]['combat'];
	           	combat += combination[1][1]['combat'];
	           	combat += combination[1][2]['combat'];
	           	combat += combination[1][3]['combat'];
	           	combat += combination[1][4]['combat'];
	           	seafaring += combination[1][0]['seafaring'];
	           	seafaring += combination[1][1]['seafaring'];
	           	seafaring += combination[1][2]['seafaring'];
	           	seafaring += combination[1][3]['seafaring'];
	           	seafaring += combination[1][4]['seafaring'];

	           	// Ship parts
	           	morale += combination[2][0]['morale'];
	           	morale += combination[2][1]['morale'];
	           	morale += combination[2][2]['morale'];
	           	morale += combination[2][3]['morale'];	           	
	           	combat += combination[2][0]['combat'];
	           	combat += combination[2][1]['combat'];
	           	combat += combination[2][2]['combat'];
	           	combat += combination[2][3]['combat'];	
	           	seafaring += combination[2][0]['seafaring'];
	           	seafaring += combination[2][1]['seafaring'];
	           	seafaring += combination[2][2]['seafaring'];
	           	seafaring += combination[2][3]['seafaring'];

	           	// Solidarity, cached per crew combination by applySolidarity()
	           	morale += combination[1].solidarity;
	           	combat += combination[1].solidarity;
	           	seafaring += combination[1].solidarity;

	           	// The Shipwright and this captain's traits, worked out by
	           	// applyModifiers(). They multiply the finished totals, so they
	           	// belong here and not in any of the sums above.
	           	morale = Math.floor(morale * combination[0]['multiplier']['morale']);
	           	combat = Math.floor(combat * combination[0]['multiplier']['combat']);
	           	seafaring = Math.floor(seafaring * combination[0]['multiplier']['seafaring']);

	           	// Calculate the success chance
	           	if(moraleTarget > 0){moraleSuccessChance = morale / moraleTarget * 100};
	           	if(combatTarget > 0){combatSuccessChance = combat / combatTarget * 100};
	           	if(seafaringTarget > 0){seafaringSuccessChance = seafaring / seafaringTarget * 100};

	           	voyageSuccessChance = Math.min(moraleSuccessChance, combatSuccessChance, seafaringSuccessChance);
	           	if(voyageSuccessChance > best.success_chance){
	           		best.success_chance = voyageSuccessChance;
	           		best.combination = combination;
	           		best.morale = morale;
	           		best.combat = combat;
	           		best.seafaring = seafaring;

	           		if(best.success_chance >= 100){
	           			break;
	           		}
	           	}
           	}

           	// The Shipwright used to be applied here, to the winner alone. A
           	// multiplier that differs by stat — a Nautical Shipwright is 3%
           	// combat against 5% seafaring — can move which crew answer a
           	// two-stat voyage best, so applying it after the search had already
           	// picked could recommend a crew that was not the strongest one.

           	let time2 = performance.now();

			resolve({
				'success_chance' : Math.min(Math.floor(best.success_chance), 100),
				'combination': best.combination,
				'solidarity': best.combination ? best.combination[1].solidarity : 0,
				'solidarity_bearer': best.combination ? best.combination[1].solidarityBearer : null,
				'solidarity_value': best.combination ? best.combination[1].solidarityValue : 0,
				'multiplier': best.combination ? best.combination[0].multiplier : null,
				'execution_time': time2 - time1,
			});
       });		
	}
}