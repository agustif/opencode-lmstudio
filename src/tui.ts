import type {
  TuiPlugin,
  TuiPluginApi,
  TuiPluginModule,
  TuiCommand,
  TuiDialogStack,
} from "@opencode-ai/plugin/tui";
import type { RGBA, Renderable } from "@opentui/core";
import { COMMAND_NAME, PLUGIN_NAME } from "./constants";
import { formatBytes, compactCount } from "./format";
import {
  collectModelGroups,
  type ModelRow,
  type ProviderGroup,
  type SdkProviderView,
} from "./tui-models";

/** Slash command that opens the dialog. */
const SHOW_SLASH = COMMAND_NAME;

/** Flags worth showing, in display order. "Temp" is omitted as near-universal. */
const DISPLAY_FLAGS = ["Vision", "Tools", "Reasoning"] as const;

/**
 * The subset of the @opentui/solid reconciler we use to build elements.
 * Loaded lazily (see `loadElementBuilder`) so that importing this module never
 * forces a top-level dependency on @opentui — command registration must
 * succeed even if the rendering layer is unavailable.
 */
interface Reconciler {
  createElement: (tag: string) => Renderable;
  setProp: (node: Renderable, name: string, value: unknown) => unknown;
  insert: (parent: Renderable, child: unknown) => unknown;
}

/** A bound element builder: `element(tag, props, ...children) => Renderable`. */
type ElementBuilder = (
  tag: string,
  props?: Record<string, unknown>,
  ...children: unknown[]
) => Renderable;

/**
 * Lazily import the @opentui/solid reconciler and return an `element` builder
 * bound to it. Throws only if @opentui/solid cannot be loaded — callers run
 * this inside the guarded dialog-open path.
 */
async function loadElementBuilder(): Promise<ElementBuilder> {
  const mod = (await import("@opentui/solid")) as unknown as Reconciler;
  const { createElement, setProp, insert } = mod;
  return (tag, props = {}, ...children) => {
    const node = createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined) continue;
      setProp(node, key, value);
    }
    for (const child of children) {
      if (child === undefined || child === null) continue;
      insert(node, child);
    }
    return node;
  };
}

/** Read the discoverable provider/model groups from the TUI's merged state. */
function readGroups(api: TuiPluginApi): ProviderGroup[] {
  // `api.state.provider` is the server's merged provider list (includes the
  // models the server plugin injected at startup). Treated as a structural
  // view so this module never hard-depends on the SDK types.
  const providers = api.state.provider as unknown as readonly SdkProviderView[];
  return collectModelGroups(providers ?? []);
}

/**
 * Compute a bounded scroll-area height that fits inside the host's centered
 * dialog panel, mirroring opencode's own scrollable dialogs (≈ half the
 * terminal height). Falls back to a sane default if dimensions are unavailable
 * and clamps toward the available rows on very small terminals to keep the
 * dialog within the screen as much as possible (host chrome aside).
 */
function scrollHeight(api: TuiPluginApi): number {
  const term = api.renderer?.terminalHeight;
  const rows = typeof term === "number" && term > 0 ? term : 40;
  // Reserve a few rows for the host's dialog chrome + our header/footer.
  const available = Math.max(1, rows - 6);
  const half = Math.floor(rows / 2) - 4;
  return Math.max(1, Math.min(available, Math.max(8, half)));
}

/** Single-space-joined detail segment for a model's metadata line. */
function modelDetail(model: ModelRow): string {
  const parts: string[] = [];
  if (model.type) parts.push(model.type);
  if (model.context !== undefined)
    parts.push(`ctx ${compactCount(model.context)}`);
  if (model.output !== undefined)
    parts.push(`out ${compactCount(model.output)}`);
  if (model.sizeBytes !== undefined) parts.push(formatBytes(model.sizeBytes));

  const flags = DISPLAY_FLAGS.filter((f) => model.flags.includes(f));
  if (flags.length > 0) parts.push(flags.join(" "));

  const provenance = [model.family, model.parameterSize, model.quantization]
    .filter((v): v is string => Boolean(v))
    .join(" ");
  if (provenance) parts.push(provenance);

  return parts.join("  ·  ");
}

/**
 * Build the whole table as a single plain-text block. Each model is two lines:
 *
 *   gemma-4-26b-a4b-it-4bit
 *     vlm  ·  ctx 262K  ·  out 32K  ·  19.2 GB  ·  Vision Tools  ·  gemma
 *
 * Rendering as one `<text content=…>` (rather than per-line elements or spans)
 * is the only structure that renders reliably in the host: text nodes take
 * their text from `content`, and spans/boxes have repeatedly collapsed or
 * thrown opentui "orphan text" errors.
 */
function buildTableText(groups: readonly ProviderGroup[]): string {
  if (groups.length === 0) {
    return "No models discovered.\n\nLocal providers may be offline, or no OpenAI-compatible provider is configured.";
  }

  const lines: string[] = [];
  for (const [index, group] of groups.entries()) {
    if (index > 0) lines.push("");
    const count = group.models.length;
    lines.push(`${group.provider} — ${count} model${count !== 1 ? "s" : ""}`);

    for (const model of group.models) {
      lines.push(`  ${model.id}`);
      const detail = modelDetail(model);
      if (detail) lines.push(`    ${detail}`);
    }
  }
  return lines.join("\n");
}

/**
 * Build the dialog content box: a header, the model table in a bounded scroll
 * area, and an "esc close" footer. The table is a single `<text>` block (the
 * only structure the host renders reliably).
 */
function buildContent(element: ElementBuilder, api: TuiPluginApi): Renderable {
  const theme = api.theme.current;
  const maxHeight = scrollHeight(api);

  let groups: ProviderGroup[] = [];
  let errorMessage: string | undefined;
  try {
    groups = readGroups(api);
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  // Content-sized column: the host wraps this in its centered, fixed-width
  // dialog panel, so we must NOT use flexGrow/minHeight (that would fill the
  // whole screen and break centering). The scroll area is bounded by maxHeight.
  const header = element(
    "box",
    { flexShrink: 0, paddingBottom: 1 },
    element("text", { fg: theme.text, content: "Actualyze" }),
  );

  const content = errorMessage
    ? `(error) ${errorMessage}`
    : buildTableText(groups);
  const color: RGBA = errorMessage ? theme.error : theme.text;

  const body = element(
    "scrollbox",
    {
      focused: true,
      maxHeight,
      scrollbarOptions: { visible: false },
    },
    element("text", { fg: color, content }),
  );

  const footer = element(
    "box",
    { flexShrink: 0, paddingTop: 1 },
    element("text", { fg: theme.textMuted, content: "esc close" }),
  );

  return element(
    "box",
    {
      flexDirection: "column",
      paddingLeft: 2,
      paddingRight: 2,
      paddingBottom: 1,
    },
    header,
    body,
    footer,
  );
}

/** Surface an error as a toast, never throwing further. */
function showError(api: TuiPluginApi, err: unknown): void {
  try {
    const message = err instanceof Error ? err.message : String(err);
    api.ui.toast({ variant: "error", title: "Actualyze", message });
  } catch {
    // Even the toast failed — swallow rather than escape.
  }
}

/**
 * Open the Actualyze dialog. The host dialog stack supplies the surrounding
 * `Dialog` chrome (backdrop, sizing, esc handling) for whatever `replace`
 * returns, so we return the content box directly. Lazily loads the @opentui
 * reconciler; any failure surfaces as a toast and never escapes the runner.
 */
function openDialog(api: TuiPluginApi): void {
  loadElementBuilder().then(
    (element) => {
      try {
        // `buildContent` returns the reconciler's `Renderable` — the concrete
        // node the host's `JSX.Element`-typed render slot accepts at runtime.
        // `@opentui/solid`'s `JSX.Element` is effectively `any`, so `as never`
        // is the narrowest cast that bridges the two without tripping eslint's
        // no-unsafe-return on that `any`.
        //
        // Pass no onClose: the host pops the stack on esc and invokes each
        // entry's onClose during clear(), so calling clear() here would recurse.
        api.ui.dialog.replace(() => buildContent(element, api) as never);
        // Must come AFTER replace: the host's replace() resets the dialog size
        // to "medium", so setting xlarge first would be overwritten.
        api.ui.dialog.setSize("xlarge");
      } catch (err) {
        showError(api, err);
      }
    },
    (err) => showError(api, err),
  );
}

/**
 * Build the legacy `TuiCommand` list. The shipped opencode runtime surfaces
 * third-party plugin slash commands through `api.command.register` (the
 * `slash.name` field); the newer `api.keymap.registerLayer` path is not yet
 * wired for external plugins. `onSelect` receives the dialog stack but we use
 * the closed-over `api.ui.dialog` for clarity.
 */
function buildCommands(api: TuiPluginApi): TuiCommand[] {
  return [
    {
      title: "Actualyze",
      value: `${COMMAND_NAME}.show`,
      category: "Actualyze",
      description: "Show discovered models with metadata",
      slash: { name: SHOW_SLASH },
      onSelect: (_dialog?: TuiDialogStack) => {
        openDialog(api);
      },
    },
  ];
}

// eslint-disable-next-line @typescript-eslint/require-await
const tui: TuiPlugin = async (api) => {
  // `api.command` is the (deprecated but currently wired) registration surface
  // for third-party plugin slash commands. Guard it so the plugin degrades
  // gracefully on hosts that drop the shim.
  if (!api.command) return;
  const dispose = api.command.register(() => buildCommands(api));
  api.lifecycle.onDispose(dispose);
};

const plugin: TuiPluginModule & { id: string } = {
  id: `${PLUGIN_NAME}:tui`,
  tui,
};

export default plugin;
