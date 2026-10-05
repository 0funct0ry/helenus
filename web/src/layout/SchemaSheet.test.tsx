import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SchemaSheet } from "./SchemaSheet";
import { transactionsByMerchant as t } from "../mocks/schema";
import { connectedWorkspace, mockSchemaApi } from "../test/schemaFixture";
import { renderWithClient } from "../test/api";

describe("SchemaSheet", () => {
  it("shows key layout, columns, options and indexes", () => {
    render(
      <SchemaSheet
        columns={t.columns}
        options={t.options}
        indexes={t.indexes}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Primary key" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByLabelText(/Partition key/).length,
    ).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("risk_embedding")).toBeInTheDocument();
    expect(screen.getByText("gc_grace_seconds")).toBeInTheDocument();
    expect(screen.getByText("txn_by_currency_sai")).toBeInTheDocument();
  });

  it("edit mode: rename on key columns, drop on others, type change disabled, add column row", async () => {
    connectedWorkspace();
    mockSchemaApi({});
    renderWithClient(
      <SchemaSheet
        columns={t.columns}
        options={t.options}
        edit={{
          keyspace: "payments",
          table: "t",
          udts: [],
          serverMajor: 5,
          onChanged: vi.fn(),
        }}
      />,
    );
    const key = t.columns.find((c) => c.kind === "partition")!;
    const reg = t.columns.find((c) => c.kind === "regular")!;
    expect(
      screen.getByRole("button", { name: `Rename ${key.name}` }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: `Drop ${key.name}` }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: `Drop ${reg.name}` }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: `Rename ${reg.name}` }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: `Change type of ${reg.name}` }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add column…" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Column 1 name"), "phone");
    expect(screen.getByRole("button", { name: "Add column…" })).toBeEnabled();
  });
  it("has no edit controls by default", () => {
    render(<SchemaSheet columns={t.columns} options={t.options} />);
    expect(screen.queryByRole("button", { name: /^Drop / })).toBeNull();
  });
});
