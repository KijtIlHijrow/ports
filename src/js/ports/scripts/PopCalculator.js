import solidarityValues from '../data/solidarity.json';

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

		// Generate the crew combinations
		this.crewCombinations = Combinatorics.combination(this.crew, 5).toArray();

		this.applySolidarity(this.crewCombinations);

		// Generate the ship combinations
		this.shipCombinations = Combinatorics.cartesianProduct(this.rams, this.deckItems, this.deckItems, this.hulls).toArray();

		// Finally, generate all the possible combinations with 1 captain, 1 crew combination and 1 ship combination
		this.combinations = Combinatorics.cartesianProduct(this.captains, this.crewCombinations, this.shipCombinations);
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

           	if(this.shipwright){
           		let morale = this.shipwright.morale == 0 ? best.morale : Math.floor(best.morale * this.shipwright.morale);
           		let combat = this.shipwright.combat == 0 ? best.combat : Math.floor(best.combat * this.shipwright.combat);
           		let seafaring = this.shipwright.seafaring == 0 ? best.seafaring : Math.floor(best.seafaring * this.shipwright.seafaring);

           		let moraleSuccessChance = moraleTarget == 0 ? 100 : morale / moraleTarget * 100;
           		let combatSuccessChance = combatTarget == 0 ? 100 : combat / combatTarget * 100;
           		let seafaringSuccessChance = seafaringTarget == 0 ? 100 : seafaring / seafaringTarget * 100;

           		best.success_chance = Math.min(moraleSuccessChance, combatSuccessChance, seafaringSuccessChance);
           	}

           	let time2 = performance.now();

			resolve({
				'success_chance' : Math.min(Math.floor(best.success_chance), 100),
				'combination': best.combination,
				'solidarity': best.combination ? best.combination[1].solidarity : 0,
				'solidarity_bearer': best.combination ? best.combination[1].solidarityBearer : null,
				'solidarity_value': best.combination ? best.combination[1].solidarityValue : 0,
				'execution_time': time2 - time1,
			});
       });		
	}
}