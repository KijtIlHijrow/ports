export default class Captain
{
	constructor(id, name, morale, combat, seafaring, level){
		this.id = id;
		this.name = name;
		this.morale = morale;
		this.combat = combat;
		this.seafaring = seafaring;
		this.level = level;

		// The four trait slots. Only the ship modifier traits change a stat, so
		// a captain can leave slots empty here that the game shows as filled.
		this.traits = ['', '', '', ''];
	}
}