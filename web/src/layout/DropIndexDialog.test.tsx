import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DropIndexDialog } from "./DropIndexDialog";
import { renderWithClient as render } from "../test/api";
import type { Call } from "../test/api";
import { connectedWorkspace, mockSchemaApi, rowsResponse } from "../test/schemaFixture";

function setup() {
  connectedWorkspace();
  const calls: Call[] = mockSchemaApi({
    "POST /p/local/indexes/preview": { body: { statement: "DROP INDEX payments.by_name;", errors: [], notes: [] } },
    "POST /p/local/query": { body: rowsResponse({ kind: "schema_change", executed_cql: "DROP INDEX payments.by_name;" }) },
  });
  const props = { onDropped: vi.fn(), onError: vi.fn(), onClose: vi.fn() };
  render(<DropIndexDialog keyspace="payments" index="by_name" {...props} />);
  return { calls, ...props };
}

describe("DropIndexDialog", () => {
  it("shows the planned statement and runs it without a typed confirmation", async () => {
    const { calls, onDropped, onClose } = setup();
    await screen.findByText(/DROP INDEX payments\.by_name;/);
    await userEvent.click(screen.getByRole("button", { name: "Drop index" }));
    await waitFor(() => expect(onDropped).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    expect(calls.filter((c) => c.path.endsWith("/query"))).toHaveLength(1);
  });
});
