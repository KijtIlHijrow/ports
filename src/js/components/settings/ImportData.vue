<template>
	<div class="mt-8">
		<h2>Import data</h2>
		<p>Import your data saved from another computer</p>

		<input ref="input" type="file" name="file" id="file" class="mt-4" @change="importData">
	</div>
</template>

<script>
	export default {
		methods: {
			importData(){
				let files = this.$refs.input.files;

				if(!files.length){return;}

				const fileReader = new FileReader();
				fileReader.readAsBinaryString(files[0]);

				fileReader.onload = () => {
					let data = JSON.parse(fileReader.result);

					// Only take what the file actually carries. Assigning a key
					// that is absent replaces good data with undefined, which
					// makes a partial file, such as one restoring only a roster,
					// destroy everything it does not mention.
					['captains', 'crew', 'parts', 'shipwright'].forEach(key => {
						if(data[key] === undefined){return;}

						// An exported roster carries its own copy of each crew
						// type, so an old file would bring back the portraits
						// that were wrong when it was written — and a file older
						// than traits brings back captains with no slots to fill.
						if(key === 'crew'){
							this.$root.crew = data.crew.map(member => this.$root.refreshType(member));
						} else if(key === 'captains'){
							this.$root.captains = data.captains.map(captain => this.$root.refreshCaptain(captain));
						} else {
							this.$root[key] = data[key];
						}
					});

					this.$root.save();
				}
			}
		}
	}
</script>