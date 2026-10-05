import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DropViewDialog } from "./DropViewDialog";
import { renderWithClient as render } from "../test/api";
import type { Call } from "../test/api";
import {
  connectedWorkspace,
  mockSchemaApi,
  rowsResponse,
} from "../test/schemaFixture";

function setup() {
  connectedWorkspace();
  const calls: Call[] = mockSchemaApi({
    "POST /p/local/tables/preview": {
      body: {
        statement: "DROP MATERIALIZED VIEW payments.v;",
        errors: [],
        notes: ["A note"],
      },
    },
    "POST /p/local/query": {
      body: rowsResponse({
        kind: "schema_change",
        executed_cql: "DROP MATERIALIZED VIEW payments.v;",
      }),
    },
  });
  const done = vi.fn();
  const onClose = vi.fn();
  render(
    <DropViewDialog
      keyspace="payments"
      view="v"
      onDropped={done}
      onClose={onClose}
    />,
  );
  return { calls, done, onClose };
}

describe("DropViewDialog", () => {
  it("requires the exact name and runs the statement once", async () => {
    const { calls, done, onClose } = setup();
    const btn = screen.getByRole("button", { name: "Drop view" });
    await screen.findByText("DROP MATERIALIZED VIEW payments.v;");
    await userEvent.type(screen.getByLabelText('Type "v" to confirm'), "vx");
    expect(btn).toBeDisabled();
    await userEvent.clear(screen.getByLabelText('Type "v" to confirm'));
    await userEvent.type(screen.getByLabelText('Type "v" to confirm'), "v");
    expect(btn).toBeEnabled();
    await userEvent.dblClick(btn);
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    expect(calls.filter((c) => c.path.endsWith("/query"))).toHaveLength(1);
  });
});
