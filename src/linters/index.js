const Clippy = require("./clippy");
const RustFmt = require("./rustfmt");

const linters = {
	// Linters
	clippy: Clippy,
	rustfmt: RustFmt,
};
module.exports = linters;
