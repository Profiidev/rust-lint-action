/**
 * Capitalizes the first letter of a string
 * @param {string} str - String to process
 * @returns {string} - Input string with first letter capitalized
 */
export function capitalizeFirstLetter(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Removes the trailing period from the provided string (if it has one)
 * @param {string} str - String to process
 * @returns {string} - String without trailing period
 */
export function removeTrailingPeriod(str: string): string {
  return str[str.length - 1] === '.' ? str.substring(0, str.length - 1) : str;
}
