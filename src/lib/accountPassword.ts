import crypto from "node:crypto";

const UPPERCASE = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWERCASE = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%*-_=+";
const ALPHABET = UPPERCASE + LOWERCASE + DIGITS + SYMBOLS;

function randomCharacter(alphabet: string) {
  return alphabet[crypto.randomInt(0, alphabet.length)];
}

/**
 * Generates a readable cryptographically secure initial account password.
 * Ambiguous characters (0/O, 1/I/l) are intentionally excluded.
 */
export function generateAccountPassword(length = 16) {
  if (!Number.isInteger(length) || length < 12) {
    throw new Error("Generated password length must be at least 12 characters");
  }

  const characters = [
    randomCharacter(UPPERCASE),
    randomCharacter(LOWERCASE),
    randomCharacter(DIGITS),
    randomCharacter(SYMBOLS),
  ];
  while (characters.length < length) characters.push(randomCharacter(ALPHABET));

  // Fisher–Yates with crypto.randomInt keeps the required character positions random.
  for (let index = characters.length - 1; index > 0; index--) {
    const other = crypto.randomInt(0, index + 1);
    [characters[index], characters[other]] = [characters[other], characters[index]];
  }
  return characters.join("");
}
