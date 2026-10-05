import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TableActionDialog } from "./TableActionDialog";
import { RenameColumnDialog } from "./RenameColumnDialog";
import { renderWithClient as render } from "../test/api";
import type { Call } from "../test/api";
import {
  connectedWorkspace,
  mockSchemaApi,
  rowsResponse,
} from "../test/schemaFixture";

describe("TableActionDialog", () => {
  it("previews the statement and runs it", async () => {
    connectedWorkspace();
    const calls: Call[] = mockSchemaApi({
      "POST /p/local/tables/preview": {
        body: {
          statement: "ALTER TABLE payments.merchants ADD phone text;",
          errors: [],
          notes: ["n1"],
        },
      },
      "POST /p/local/query": {
        body: rowsResponse({ kind: "schema_change", executed_cql: "x" }),
      },
    });
    const onApplied = vi.fn();
    render(
      <TableActionDialog
        title="Add column"
        subtitle="payments.merchants"
        request={{
          action: "add_column",
          keyspace: "payments",
          name: "merchants",
        }}
        applyLabel="Add column"
        onApplied={onApplied}
        onClose={vi.fn()}
      />,
    );
    await screen.findByText("ALTER TABLE payments.merchants ADD phone text;");
    expect(screen.getByText("n1")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add column" }));
    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    const q = calls.find((c) => c.path.endsWith("/query"));
    expect((q?.body as { cql: string; ddl_origin: string }).ddl_origin).toBe(
      "ui",
    );
  });
  it("disables Apply and shows planner errors", async () => {
    connectedWorkspace();
    mockSchemaApi({
      "POST /p/local/tables/preview": {
        body: {
          statement: "",
          errors: [{ field: "", message: "Nothing to change" }],
          notes: [],
        },
      },
    });
    render(
      <TableActionDialog
        title="Change options"
        subtitle="s"
        request={{ action: "options", keyspace: "payments", name: "merchants" }}
        applyLabel="Apply changes"
        onApplied={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await screen.findByText("Nothing to change");
    expect(
      screen.getByRole("button", { name: "Apply changes" }),
    ).toBeDisabled();
  });
  it("rename sends from and to", async () => {
    connectedWorkspace();
    const calls: Call[] = mockSchemaApi({
      "POST /p/local/tables/preview": {
        body: {
          statement: "ALTER TABLE payments.merchants RENAME a TO b;",
          errors: [],
          notes: [],
        },
      },
    });
    render(
      <RenameColumnDialog
        keyspace="payments"
        table="merchants"
        column="a"
        onRenamed={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("New name"), "b");
    await waitFor(() =>
      expect(calls.some((c) => (c.body as { to?: string })?.to === "b")).toBe(
        true,
      ),
    );
  });
});
