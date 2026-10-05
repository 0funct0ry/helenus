import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DropTableDialog } from "./DropTableDialog";
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
        statement: "DROP TABLE payments.merchants;",
        errors: [],
        notes: ["A note"],
      },
    },
    "POST /p/local/query": {
      body: rowsResponse({
        kind: "schema_change",
        executed_cql: "DROP TABLE payments.merchants;",
      }),
    },
  });
  const done = vi.fn();
  const onClose = vi.fn();
  render(
    <DropTableDialog
      keyspace="payments"
      table="merchants"
      views={[]}
      onDropped={done}
      onClose={onClose}
    />,
  );
  return { calls, done, onClose };
}

describe("DropTableDialog", () => {
  it("requires the exact name and runs the statement once", async () => {
    const { calls, done, onClose } = setup();
    const btn = screen.getByRole("button", { name: "Drop table" });
    await screen.findByText("DROP TABLE payments.merchants;");
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

describe("DropTableDialog with views", () => {
  it("names the blocking views and disables Drop", async () => {
    connectedWorkspace();
    mockSchemaApi({
      "POST /p/local/tables/preview": {
        body: {
          statement: "",
          errors: [{ field: "name", message: "Drop the views first: v1" }],
          notes: [],
        },
      },
    });
    render(
      <DropTableDialog
        keyspace="payments"
        table="merchants"
        views={["v1"]}
        onDropped={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Drop table" })).toBeDisabled();
    expect(screen.queryByLabelText('Type "merchants" to confirm')).toBeNull();
  });
});
