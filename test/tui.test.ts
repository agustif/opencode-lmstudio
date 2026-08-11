import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the opentui reconciler so element construction does not require a live
// renderer context. The builder logic itself (createElement/setProp/insert) is
// exercised; we only stub the native renderable creation.
vi.mock("@opentui/solid", () => {
  return {
    createElement: (tag: string) => ({
      tag,
      props: {} as Record<string, unknown>,
      children: [] as unknown[],
    }),
    setProp: (
      node: { props: Record<string, unknown> },
      name: string,
      value: unknown,
    ) => {
      node.props[name] = value;
      return value;
    },
    insert: (node: { children: unknown[] }, child: unknown) => {
      node.children.push(child);
      return child;
    },
  };
});

import type {
  TuiPluginApi,
  TuiPluginMeta,
  TuiCommand,
} from "@opencode-ai/plugin/tui";
import tuiPlugin from "../src/tui";
import { COMMAND_NAME, PLUGIN_NAME } from "../src/constants";

/** Invoke the plugin's tui entrypoint with a structurally-typed mock api. */
function runTui(api: unknown): Promise<void> {
  return tuiPlugin.tui(api as TuiPluginApi, undefined, {} as TuiPluginMeta);
}

/**
 * The command runners open the dialog asynchronously (they lazily import the
 * @opentui reconciler, which is mocked here). Poll until `predicate` holds so
 * the wait is timing-independent under parallel test load. Returns `true` once
 * satisfied, `false` if it never becomes true within the budget.
 */
async function waitUntil(predicate: () => boolean): Promise<boolean> {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  return predicate();
}

function rgba() {
  return { r: 0, g: 0, b: 0, a: 1 };
}

type MockNode = {
  tag?: string;
  props?: Record<string, unknown>;
  children?: unknown[];
};

/** opentui text-node tags that must be parented by a `<text>`, never a `<box>`. */
const TEXT_NODE_TAGS = new Set([
  "span",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "a",
  "br",
]);

/**
 * Find any opentui "orphan text" violation: a text-node element (span/b/i/…)
 * placed as a direct child of a non-text element. opentui throws at render time
 * for these ("Orphan text error: … must have a <text> as a parent"), so guard
 * against it structurally since the mock reconciler does not enforce it.
 */
function findOrphanSpan(node: unknown, parentTag?: string): string | undefined {
  if (!node || typeof node !== "object") return undefined;
  const n = node as MockNode;
  const tag = n.tag;
  if (
    tag &&
    TEXT_NODE_TAGS.has(tag) &&
    parentTag !== undefined &&
    parentTag !== "text" &&
    !TEXT_NODE_TAGS.has(parentTag)
  ) {
    return `<${tag}> under <${parentTag}>`;
  }
  for (const child of n.children ?? []) {
    const found = findOrphanSpan(child, tag);
    if (found) return found;
  }
  return undefined;
}

function createMockApi(providers: unknown[] = [], withCommand = true) {
  const dialog = {
    replace: vi.fn(),
    clear: vi.fn(),
    setSize: vi.fn(),
    size: "medium" as const,
    depth: 0,
    open: false,
  };
  const registered: Array<() => TuiCommand[]> = [];
  const dispose = vi.fn();
  const onDispose = vi.fn();
  const toast = vi.fn();

  const api = {
    command: withCommand
      ? {
          register: vi.fn((cb: () => TuiCommand[]) => {
            registered.push(cb);
            return dispose;
          }),
          trigger: vi.fn(),
          show: vi.fn(),
        }
      : undefined,
    ui: {
      Dialog: vi.fn((props: unknown) => ({ dialog: props })),
      dialog,
      toast,
    },
    theme: {
      current: {
        text: rgba(),
        textMuted: rgba(),
        error: rgba(),
        primary: rgba(),
        secondary: rgba(),
        accent: rgba(),
        info: rgba(),
        warning: rgba(),
        success: rgba(),
      },
    },
    state: { provider: providers },
    lifecycle: { onDispose },
  };

  const commands = (): TuiCommand[] => registered[0]?.() ?? [];
  const commandBySlash = (slash: string) =>
    commands().find((c) => c.slash?.name === slash);

  return { api, dialog, registered, dispose, onDispose, toast, commandBySlash };
}

describe("tui plugin module", () => {
  it("exposes a namespaced id and a tui entrypoint", () => {
    expect(tuiPlugin.id).toBe(`${PLUGIN_NAME}:tui`);
    expect(typeof tuiPlugin.tui).toBe("function");
  });
});

describe("tui command registration", () => {
  let mock: ReturnType<typeof createMockApi>;

  beforeEach(async () => {
    mock = createMockApi([
      {
        id: "omlx",
        name: "oMLX",
        options: { baseURL: "http://localhost:8000/v1" },
        models: { "qwen3-30b": { id: "qwen3-30b", name: "Qwen3 30B" } },
      },
    ]);
    await runTui(mock.api);
  });

  it("registers via api.command.register", () => {
    expect(mock.api.command?.register).toHaveBeenCalledTimes(1);
  });

  it("registers a single /actualyze slash command", () => {
    const cmds = mock.registered[0]?.() ?? [];
    expect(cmds).toHaveLength(1);
    const show = mock.commandBySlash(COMMAND_NAME);
    expect(show).toBeDefined();
    expect(show?.title).toBe("Actualyze");
    expect(show?.value).toBe(`${COMMAND_NAME}.show`);
  });

  it("wires the dispose into lifecycle.onDispose", () => {
    expect(mock.onDispose).toHaveBeenCalledTimes(1);
    expect(mock.onDispose).toHaveBeenCalledWith(mock.dispose);
  });

  it("opens the dialog (replace + xlarge) when /actualyze is selected", async () => {
    void mock.commandBySlash(COMMAND_NAME)?.onSelect?.();
    expect(
      await waitUntil(() => mock.dialog.replace.mock.calls.length > 0),
    ).toBe(true);
    expect(mock.dialog.replace).toHaveBeenCalledTimes(1);
    expect(mock.dialog.setSize).toHaveBeenCalledWith("xlarge");
  });

  it("calls setSize AFTER replace (replace resets size to medium)", async () => {
    void mock.commandBySlash(COMMAND_NAME)?.onSelect?.();
    await waitUntil(
      () =>
        mock.dialog.replace.mock.calls.length > 0 &&
        mock.dialog.setSize.mock.calls.length > 0,
    );
    const replaceOrder = mock.dialog.replace.mock.invocationCallOrder[0];
    const setSizeOrder = mock.dialog.setSize.mock.invocationCallOrder[0];
    expect(replaceOrder).toBeDefined();
    expect(setSizeOrder).toBeDefined();
    expect(replaceOrder).toBeLessThan(setSizeOrder);
  });

  it("returns the content element directly (no api.ui.Dialog double-wrap)", async () => {
    void mock.commandBySlash(COMMAND_NAME)?.onSelect?.();
    await waitUntil(() => mock.dialog.replace.mock.calls.length > 0);
    const render = mock.dialog.replace.mock.calls[0]?.[0] as () => unknown;
    expect(typeof render).toBe("function");
    expect(() => render()).not.toThrow();
    expect(mock.api.ui.Dialog).not.toHaveBeenCalled();
  });

  it("never renders a span/text-node directly under a box (opentui orphan rule)", async () => {
    void mock.commandBySlash(COMMAND_NAME)?.onSelect?.();
    await waitUntil(() => mock.dialog.replace.mock.calls.length > 0);
    const render = mock.dialog.replace.mock.calls[0]?.[0] as () => unknown;
    expect(findOrphanSpan(render())).toBeUndefined();
  });

  it("never renders a span directly under a box for the empty state", async () => {
    const empty = createMockApi([]);
    await runTui(empty.api);
    void empty.commandBySlash(COMMAND_NAME)?.onSelect?.();
    await waitUntil(() => empty.dialog.replace.mock.calls.length > 0);
    const render = empty.dialog.replace.mock.calls[0]?.[0] as () => unknown;
    expect(findOrphanSpan(render())).toBeUndefined();
  });

  it("does not throw when provider state is empty", async () => {
    const empty = createMockApi([]);
    await runTui(empty.api);
    void empty.commandBySlash(COMMAND_NAME)?.onSelect?.();
    await waitUntil(() => empty.dialog.replace.mock.calls.length > 0);
    const render = empty.dialog.replace.mock.calls[0]?.[0] as () => unknown;
    expect(() => render()).not.toThrow();
  });

  it("never throws out of onSelect: a failing replace is caught and toasted", async () => {
    mock.dialog.replace.mockImplementationOnce(() => {
      throw new Error("dialog unavailable");
    });
    expect(() => mock.commandBySlash(COMMAND_NAME)?.onSelect?.()).not.toThrow();
    expect(await waitUntil(() => mock.toast.mock.calls.length > 0)).toBe(true);
    expect(mock.toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error", title: "Actualyze" }),
    );
  });
});

describe("tui graceful degradation", () => {
  it("does nothing when api.command is unavailable", async () => {
    const mock = createMockApi([], false);
    await expect(runTui(mock.api)).resolves.toBeUndefined();
    expect(mock.onDispose).not.toHaveBeenCalled();
  });

  it("toasts (never throws) when the @opentui reconciler fails to load", async () => {
    // Re-import the plugin with @opentui/solid mocked to throw at import time,
    // exercising the loadElementBuilder() rejection arm of openDialog.
    vi.resetModules();
    vi.doMock("@opentui/solid", () => {
      throw new Error("opentui unavailable");
    });
    const fresh = (await import("../src/tui")).default;
    const mock = createMockApi([]);
    await fresh.tui(
      mock.api as unknown as TuiPluginApi,
      undefined,
      {} as TuiPluginMeta,
    );
    void mock.commandBySlash(COMMAND_NAME)?.onSelect?.();
    expect(await waitUntil(() => mock.toast.mock.calls.length > 0)).toBe(true);
    expect(mock.toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error", title: "Actualyze" }),
    );
    vi.doUnmock("@opentui/solid");
    vi.resetModules();
  });
});
