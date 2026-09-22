// Keys come from the environment, or on macOS from the Keychain. They are never printed.
import { execFileSync } from "node:child_process";

export function key(envName, keychainItem) {
  if (process.env[envName]) return process.env[envName].trim();
  try {
    return execFileSync("security", ["find-generic-password", "-s", keychainItem, "-w"]).toString().trim();
  } catch {
    throw new Error(`Set ${envName}, or store it in the macOS Keychain as "${keychainItem}".`);
  }
}
export const typesafeKey = () => key("TYPESAFE_API_KEY", "typesafe-api-key");
export const openrouterKey = () => key("OPENROUTER_API_KEY", "openrouter-api-key");
