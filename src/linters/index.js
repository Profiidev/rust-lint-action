const Clippy = require("./clippy");
const RustFmt = require("./rustfmt");
const TSC = require("./tsc");
const Prettier = require("./prettier");
const Svelte = require("./svelte");

const linters = {
	clippy: Clippy,
	rustfmt: RustFmt,
	tsc: TSC,
	prettier: Prettier,
	svelte: Svelte,
};
module.exports = linters;
