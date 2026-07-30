import _ from 'lodash';

// Configure Vue
window.Vue = require('vue');
Vue.config.productionTip = false;
Vue.config.devtools = false;

// Helper function to convert a string to a number
window.num = (number) => {	
	if(typeof number == 'string'){
		number = number.split(',').join('');
		return Number(number);
	}

	return number;	
};

// Event bus
window.events = new Vue();

Vue.mixin({
	methods: {
        /**
         * Select all the text within the clicked input
         * @param  {Event} e 
         * @return {void}   
         */
		selectText(e){
			e.target.select();
		}
	}
});

// Components
Vue.component('app', require('./components/App.vue').default);
Vue.component('modal', require('./components/global/Modal.vue').default);

// Main Vue Application
import Captain from './ports/models/Captain';
import CrewType from './ports/models/CrewType';
import Crew from './ports/models/Crew';
import Part from './ports/models/Part';

/**
 * Where a crew type's portrait is served from.
 *
 * All 58 now live in the repository. They used to be hotlinked from the wiki,
 * which had already deleted eight of them — a deleted one draws as an empty
 * box — and which cannot be read back off a canvas anyway. The roster scanner
 * needs to read their pixels to recognise a crew member on screen, and a
 * cross-origin image taints the canvas, so hosting them here is what makes
 * that possible as well as what stops them rotting.
 *
 * @param  {string} path
 * @return {string}
 */
function portrait(path){
	return '/ports/public/images/' + path;
}

const app = new Vue({
    el: '#app',

    data(){
    	return {
            // Error message
            error: '',

            // Hash of attempts for failed type checks
            attempts: [],

    		// Data
    		captains: [],
    		crewTypes: [],
    		crew: [],
    		parts: [],
            shipwright: {},

    		// Result
    		result: {
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
    		},

            // Currently selected crew member
            selected: null,

            // The last read whose crew type could not be identified, so that
            // naming it by hand can teach the reader what that garbling means
            unidentified: null,
    	}
    },

    methods: {
        /**
         * Save everything to local storage
         * @return {void} 
         */
        save(){
            localStorage.setItem('captains', JSON.stringify(this.captains));
            localStorage.setItem('crew', JSON.stringify(this.crew));
            localStorage.setItem('parts', JSON.stringify(this.parts));
            localStorage.setItem('shipwright', JSON.stringify(this.shipwright));
            localStorage.setItem('attempts', JSON.stringify(this.attempts));
        },

        /**
         * Load everything from local storage
         * @return {void} 
         */
    	load(){
    		this.loadCaptains();
    		this.loadCrewTypes();
    		this.loadCrew();
    		this.loadParts();
            this.loadPorts();
            this.loadSettings();
    	},
        clearRoster(){
            this.clearCaptains();
            this.clearCrew();
        },

        /**
         * Used for testing purposes only
         */
    	setTestingData(){
    		this.captains[0] = new Captain(1, 'John Doe', 100, 100, 100, 5);
            this.captains[0].ship = 0;

    		for(let i = 0; i < 10; i++){
    			this.crew[i] = new Crew(i + 1, this.crewTypes[1], 100, 100, 100, 1);
                this.crew[i].ship = 0;
    		}
    	},

        /**
         * Load the captains
         * @return {[type]} [description]
         */
    	loadCaptains(){
    		let captains = localStorage.getItem('captains');          

    		if(!captains){
    			captains = [];

    			for(let i = 1; i <= 5; i++){
    				let captain = new Captain(i, '', 0, 0, 0, 0);
                    captain.ship = 0;
    				captains.push(captain);
    			}

                captains = JSON.stringify(captains);
    		}

    		this.captains = JSON.parse(captains);
    	},
        clearCaptains(){
            localStorage.removeItem('captains');
            this.loadCaptains();
        },

        /**
         * Load the types of crew
         * @return {void} 
         */
    	loadCrewTypes(){
    		let regions = require('./ports/data/crew.json');

    		let emptyCrewType = new CrewType('Empty', '/ports/public/images/empty.png', 0, 0, 0, 0);
    		this.crewTypes.push(emptyCrewType);
    		
    		regions.forEach(region => {
    			region.sailors.forEach(sailor => {
    				let crewType = new CrewType(sailor[1], portrait(sailor[0]), sailor[2], sailor[3], sailor[4], 0);
    				this.crewTypes.push(crewType);
    			});
    		});
    	},

        /**
         * Load the crew
         * @return {void} 
         */
    	loadCrew(){
    		let crew = localStorage.getItem('crew');

    		if(!crew){
    			crew = [];
    			let emptyCrewType = this.crewTypes[0];

    			for(let i = 6; i <= 30; i++){
    				let member = new Crew(i, emptyCrewType, 0, 0, 0, 0);
                    member.ship = 0;
    				crew.push(member);                    
    			}

                crew = JSON.stringify(crew);
    		}

            this.crew = JSON.parse(crew).map(member => this.refreshType(member));
    	},

        /**
         * Point a saved crew member back at the current definition of its type.
         * A roster keeps its own copy of whatever the type looked like when it
         * was read, so a portrait or a base stat corrected since then would
         * never reach a roster that is already saved.
         * @param  {Object} member
         * @return {Object}
         */
        refreshType(member){
            if(!member.type || !member.type.name){return member;}

            let current = this.crewTypes.find(type => type.name === member.type.name);

            if(current){member.type = current;}

            return member;
        },
        clearCrew(){
            localStorage.removeItem('crew');
            this.loadCrew();
        },

        /**
         * Load the ship parts
         * @return {void} 
         */
    	loadParts(){
    		let parts = localStorage.getItem('parts');

    		if(!parts){
    			parts = [];
    			let startingParts = ['Weathered Ram', 'Weathered Rigging', 'Barnacled Hull'];
    			let sections = require('./ports/data/parts.json');
    			let id = 1;

    			sections.forEach(section => {
    				section.parts.forEach(part => {
    					let name = part[0];
    					let owned = startingParts.indexOf(name) != -1;

    					let shipPart = new Part(id, section.name, name, part[1], part[2], part[3], part[4], owned);
    					parts.push(shipPart);
    					id++;
    				});
    			});

                parts = JSON.stringify(parts);
    		}

    		this.parts = JSON.parse(parts);
    	},

        /**
         * Load the ports data (shipwright)
         * @return {void} 
         */
        loadPorts(){
            let shipwright = localStorage.getItem('shipwright');

            if(!shipwright){
                shipwright = {name: 'Dilapidated shipwright', morale: 0, combat: 0, seafaring: 0};
                shipwright = JSON.stringify(shipwright);
            }

            this.shipwright = JSON.parse(shipwright);
        },

        /**
         * Load the settings (for now just failed attempts)
         * @return {void} 
         */
        loadSettings(){
            let attempts = localStorage.getItem('attempts');

            if(!attempts){
                return this.attempts = [];
            }

            this.attempts = JSON.parse(attempts);
        },  

        /**
         * Remember that this crew member reads as the given type, so the reader
         * recognises it next time without being told again
         * @param  {int} id   the crew slot that was just read
         * @param  {string} name crew type the player picked
         * @return {void}
         */
        learnType(id, name){
            let pending = this.unidentified;

            if(!pending || pending.id !== id || !pending.attempts.length){return;}
            if(!name || name === 'Empty'){return;}

            let learned = {};

            try {
                learned = JSON.parse(localStorage.getItem('learnedTypes')) || {};
            } catch(e) {
                learned = {};
            }

            pending.attempts.forEach(attempt => {
                learned[attempt] = name;
            });

            localStorage.setItem('learnedTypes', JSON.stringify(learned));
            this.unidentified = null;
        },

        /**
         * Flash an error to the top of the screen
         * @param  {string} error    
         * @param  {int} duration 
         * @return {void}          
         */
        flashError(error, duration = 3500){
            this.error = error;

            setTimeout(() => {
                this.error = '';
            }, duration);
        }
    }
});