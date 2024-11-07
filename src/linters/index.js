const Clippy = require("./clippy");
const RustFmt = require("./rustfmt");
const TSC = require("./tsc");
const Prettier = require("./prettier");

const linters = {
	clippy: Clippy,
	rustfmt: RustFmt,
	tsc: TSC,
	prettier: Prettier,
};
module.exports = linters;
