# Player-Owned Ports calculator

This a Played-Owned Ports calculator for the [Alt-1 toolkit](https://runeapps.org/alt1).

> **This is a fork** of [leejay10/ports](https://github.com/leejay10/ports) with Solidarity
> support added — see [Solidarity](#solidarity) below. Everything else is unchanged.

## Installation

To add the plugin to Alt1, copy the following and paste into your address bar.
`alt1://addapp/https://kijtilhijrow.github.io/ports/public/appconfig.json`

Once added, you will need to accept the permissions to complete the installation process.

## Usage
To activate the plugin, you can right click your Captain's Log, hover over Read and press Alt + 1

![](https://i.imgur.com/MZj4bXW.png)

The plugin will only read data from the **_Edit Ship -> Edit Crew_** interface.

![](https://i.imgur.com/562pcU1.png)

**It will not currently read the data from the _Crew Roster_ interface**

To get started, simply put your mouse over a crew member and press the Alt + 1 key combination. The reader will find the data on the screen and automatically fill it in the corresponding box on the plugin interface.

Once you have entered your crew, go to the Voyage List and select you voyage you want to calculate and press Alt + 1. The reader will automatically fill your required voyage targets on the plugin interface. 

![](https://i.imgur.com/kmdKUCa.png)

Press Calculate on the plugin interface and it will display your best combination of crew for this voyage. ~~You can then assign this crew to a particular ship~~ **Whilst in development, you will need to clear your roster before calculating another journey due to the re-positioning of crew members once a journey has been sent off. Currently working on a solution for this**

![](https://i.imgur.com/5JBs1mr.png)

### Solidarity

The calculator accounts for the Solidarity trait, which adds a flat amount to Morale, Combat
and Seafaring for every unique unit type aboard, the captain included. Five crew carry it:

| Crew | Region | Solidarity |
| --- | --- | --- |
| First Mate | The Arc | +25 |
| Eastern Overseer | The Skull | +50 |
| Bureaucrat | The Scythe | +75 |
| Judge of Dice | The Bowl | +100 |
| Kharidian Exile | The Shield | +125 |

Because the captain counts, a full ship of five distinct crew gives six types, so a Kharidian
Exile is worth up to +750 to each stat. That is large enough to change which crew is optimal,
which is why the result now factors it in.

The trait does not stack, and the game resolves traits left to right — a weaker bearer placed
to the left suppresses a stronger one. The calculator therefore assumes the strongest bearer
sits leftmost, and the result panel names the unit to put in the first crew slot. **Place it
there or you will not get the bonus shown.**

Values are per the [RuneScape Wiki](https://runescape.wiki/w/Player-owned_port/Captains_and_crew)
and live in `src/js/ports/data/solidarity.json`.

### Missing crew types

While the app is in development, many crew types will be missing. When the reader cannot find the proper crew type, it will display a popup like this: 

![](https://i.imgur.com/8WgRHpP.png)

Click on the textarea to automatically select the text, copy it and send it to leejay10 on Discord.

The message will only be displayed one per unknown type.

## Bug reporting

If you find any issue with the plugin, please open an issue here on Github.

## Contributing

If you'd like to contribute, feel free to submit a Pull Request!

Feel free to message me on Discord if you have any questions!
