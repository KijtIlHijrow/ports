import CrewReader from './CrewReader';
import RosterScanner from './RosterScanner';

/**
 * One reader shared by everything that needs it.
 *
 * Building a CrewReader decodes its reference images and parses two OCR fonts,
 * and three components now want one. They also want the same one: the scanner
 * asks the reader where the interface is, and a second copy would only be a
 * second answer to the same question.
 */
let reader = null;
let scanner = null;

export function crewReader(){
	if(!reader){reader = new CrewReader();}

	return reader;
}

export function rosterScanner(){
	if(!scanner){scanner = new RosterScanner(crewReader());}

	return scanner;
}
