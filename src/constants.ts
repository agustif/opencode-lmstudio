/** Plugin name — used in package.json, README, error messages. */
export const PLUGIN_NAME = "opencode-actualyze";

/**
 * Slash command name (without leading slash). Registered in the TUI process via
 * `api.command.register` (`slash.name`), so `/actualyze` opens a dialog with no
 * model turn.
 */
export const COMMAND_NAME = "actualyze";
