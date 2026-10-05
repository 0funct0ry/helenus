import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewTriggerDialog } from "./NewTriggerDialog";
import { renderWithClient as render } from "../test/api";
import type { Call } from "../test/api";
import { connectedWorkspace, mockSchemaApi, rowsResponse } from "../test/schemaFixture";
import type { Table } from "../lib/schemaModel";

const table: Table = { name: "users", keyspace: "shop", options: {}, views: [], indexes: [], columns: [] };
const NOTE = "The class must be in a JAR in every node's triggers directory; Helenus cannot check this";

function setup(preview: unknown, query: unknown) {
  connectedWorkspace();
  const calls: Call[] = mockSchemaApi({ "POST /p/local/triggers/preview": { body: preview }, "POST /p/local/query": query as never });
  const props = { onCreated: vi.fn(), onClose: vi.fn() };
  render(<NewTriggerDialog table={table} {...props} />);
  return { calls, ...props };
}

describe("NewTriggerDialog", () => {
  it("blocks Create on an invalid class and shows the field error", async () => {
    setup({ statement: "", errors: [{ field: "class", message: "Use a fully qualified Java class name such as com.example.Audit" }], notes: [] }, {});
    await userEvent.type(screen.getByLabelText("Name"), "audit");
    await userEvent.type(screen.getByLabelText("Class"), "com..Audit");
    await screen.findByText(/fully qualified Java class name/);
    expect(screen.getByRole("button", { name: "Create trigger" })).toBeDisabled();
  });

  it("previews with the JAR note and creates the trigger", async () => {
    const { calls, onCreated, onClose } = setup(
      { statement: "CREATE TRIGGER audit ON shop.users USING 'com.example.Audit';", errors: [], notes: [NOTE] },
      { body: rowsResponse({ kind: "schema_change", executed_cql: "x" }) },
    );
    await userEvent.type(screen.getByLabelText("Name"), "audit");
    await userEvent.type(screen.getByLabelText("Class"), "com.example.Audit");
    await screen.findByText(NOTE);
    await waitFor(() => expect(screen.getByRole("button", { name: "Create trigger" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Create trigger" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    expect(calls.filter((c) => c.path.endsWith("/query"))).toHaveLength(1);
  });

  it("shows the server error inline and stays open", async () => {
    const { onCreated, onClose } = setup(
      { statement: "CREATE TRIGGER audit ON shop.users USING 'com.example.Missing';", errors: [], notes: [NOTE] },
      { status: 400, body: { error: { code: "query_failed", message: "Trigger class 'com.example.Missing' doesn't exist" } } },
    );
    await userEvent.type(screen.getByLabelText("Name"), "audit");
    await userEvent.type(screen.getByLabelText("Class"), "com.example.Missing");
    await waitFor(() => expect(screen.getByRole("button", { name: "Create trigger" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Create trigger" }));
    expect(await screen.findByText(/doesn't exist/)).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
