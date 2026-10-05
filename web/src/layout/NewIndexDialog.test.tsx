import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewIndexDialog } from "./NewIndexDialog";
import { renderWithClient as render } from "../test/api";
import type { Call } from "../test/api";
import { connectedWorkspace, mockSchemaApi, rowsResponse } from "../test/schemaFixture";
import type { Table } from "../lib/schemaModel";

const table: Table = {
  name: "users",
  keyspace: "shop",
  options: {},
  views: [],
  indexes: [],
  columns: [
    { name: "id", type: "uuid", kind: "partition", desc: { name: "uuid" } },
    { name: "name", type: "text", kind: "regular", desc: { name: "text" } },
    { name: "attrs", type: "map<text, int>", kind: "regular", desc: { name: "map", args: [{ name: "text" }, { name: "int" }] } },
    { name: "hits", type: "counter", kind: "regular", desc: { name: "counter" } },
    { name: "emb", type: "vector<float, 3>", kind: "regular", desc: { name: "vector", args: [{ name: "float" }], size: 3 } },
  ],
};

function setup(serverMajor: number) {
  connectedWorkspace();
  const calls: Call[] = mockSchemaApi({
    "POST /p/local/indexes/preview": {
      body: { statement: "CREATE INDEX users_attrs_idx ON shop.users (VALUES(attrs));", errors: [], notes: ["Index builds in the background; queries may miss rows until it finishes"] },
    },
    "POST /p/local/query": { body: rowsResponse({ kind: "schema_change", executed_cql: "x" }) },
  });
  const props = { onCreated: vi.fn(), onClose: vi.fn() };
  render(<NewIndexDialog table={table} serverMajor={serverMajor} {...props} />);
  return { calls, ...props };
}

async function pick(column: string) {
  await userEvent.click(screen.getByRole("button", { name: /Column/ }));
  await userEvent.click(await screen.findByRole("option", { name: new RegExp(`^${column} ·`) }));
}

describe("NewIndexDialog", () => {
  it("disables SAI before Cassandra 5.0 with the reason", () => {
    setup(4);
    const sai = screen.getByRole("radio", { name: "SAI" });
    expect(sai).toBeDisabled();
    expect(sai).toHaveAttribute("title", "SAI needs Cassandra 5.0 or later");
  });

  it("offers every map target defaulting to Values and creates the index", async () => {
    const { calls, onCreated, onClose } = setup(4);
    await pick("attrs");
    const targets = screen.getByRole("radiogroup", { name: "Index target" });
    expect(within(targets).getByRole("radio", { name: "Values" })).toHaveAttribute("aria-checked", "true");
    expect(within(targets).getAllByRole("radio")).toHaveLength(3);
    await screen.findByText("CREATE INDEX users_attrs_idx ON shop.users (VALUES(attrs));");
    await userEvent.click(screen.getByRole("button", { name: "Create index" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    expect(calls.filter((c) => c.path.endsWith("/query"))).toHaveLength(1);
  });

  it("defaults vector columns to SAI with a similarity function and blocks legacy", async () => {
    setup(5);
    await pick("emb");
    expect(screen.getByRole("radio", { name: "SAI" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Secondary (2i)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Similarity function/ })).toBeInTheDocument();
  });

  it("dims counter and sole partition key columns with the reason", async () => {
    setup(4);
    await userEvent.click(screen.getByRole("button", { name: /Column/ }));
    expect(await screen.findByRole("option", { name: /^hits ·/ })).toHaveAttribute("title", "Counter columns cannot be indexed");
    expect(screen.getByRole("option", { name: /^id ·/ })).toHaveAttribute("title", "The only partition key column cannot have a legacy index");
  });
});
