import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DropTriggerDialog } from "./DropTriggerDialog";
import { renderWithClient as render } from "../test/api";
import type { Call } from "../test/api";
import { connectedWorkspace, mockSchemaApi, rowsResponse } from "../test/schemaFixture";

describe("DropTriggerDialog", () => {
  it("shows the planned statement and runs it on confirm", async () => {
    connectedWorkspace();
    const calls: Call[] = mockSchemaApi({
      "POST /p/local/triggers/preview": { body: { statement: "DROP TRIGGER audit ON shop.users;", errors: [], notes: [] } },
      "POST /p/local/query": { body: rowsResponse({ kind: "schema_change", executed_cql: "x" }) },
    });
    const props = { onDropped: vi.fn(), onError: vi.fn(), onClose: vi.fn() };
    render(<DropTriggerDialog keyspace="shop" table="users" trigger="audit" {...props} />);
    await screen.findByText(/DROP TRIGGER audit ON shop\.users;/);
    await userEvent.click(screen.getByRole("button", { name: "Drop trigger" }));
    await waitFor(() => expect(props.onDropped).toHaveBeenCalled());
    expect(props.onClose).toHaveBeenCalled();
    expect(calls.filter((c) => c.path.endsWith("/query"))).toHaveLength(1);
  });
});
