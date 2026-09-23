// Keys come from the environment, or on macOS from the Keychain. They are never printed.
import { execFileSync } from "node:child_process";

export function key(envName, keychainItem) {
  let k;
  if (process.env[envName]) k = process.env[envName].trim();
  else {
    try {
      k = execFileSync("security", ["find-generic-password", "-s", keychainItem, "-w"]).toString().trim();
    } catch {
      throw new Error(`Set ${envName}, or store it in the macOS Keychain as "${keychainItem}".`);
    }
  }
  // A key is printable ASCII with no spaces. Anything else (a line break from a bad paste) makes fetch
  // throw a header error that quotes the whole key, so stop here with a message that doesn't.
  if (!/^[\x21-\x7e]+$/.test(k)) throw new Error(`The key from ${envName} or the Keychain item "${keychainItem}" has a space, a line break or another character a key can't have.`);
  return k;
}
export const typesafeKey = () => key("TYPESAFE_API_KEY", "typesafe-api-key");
export const openrouterKey = () => key("OPENROUTER_API_KEY", "openrouter-api-key");
