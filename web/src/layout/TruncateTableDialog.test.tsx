import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TruncateTableDialog } from "./TruncateTableDialog";
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
        statement: "TRUNCATE payments.merchants;",
        errors: [],
        notes: ["A note"],
      },
    },
    "POST /p/local/query": {
      body: rowsResponse({
        kind: "schema_change",
        executed_cql: "TRUNCATE payments.merchants;",
      }),
    },
  });
  const done = vi.fn();
  const onClose = vi.fn();
  render(
    <TruncateTableDialog
      keyspace="payments"
      table="merchants"
      onTruncated={done}
      onClose={onClose}
    />,
  );
  return { calls, done, onClose };
}

describe("TruncateTableDialog", () => {
  it("requires the exact name and runs the statement once", async () => {
    const { calls, done, onClose } = setup();
    const btn = screen.getByRole("button", { name: "Truncate" });
    await screen.findByText("TRUNCATE payments.merchants;");
    await userEvent.type(
      screen.getByLabelText('Type "merchants" to confirm'),
      "merchantsx",
    );
    expect(btn).toBeDisabled();
    await userEvent.clear(screen.getByLabelText('Type "merchants" to confirm'));
    await userEvent.type(
      screen.getByLabelText('Type "merchants" to confirm'),
      "merchants",
    );
    expect(btn).toBeEnabled();
    await userEvent.dblClick(btn);
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    expect(calls.filter((c) => c.path.endsWith("/query"))).toHaveLength(1);
  });
});
