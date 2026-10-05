import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TriggersSheet } from "./TriggersSheet";
import { renderWithClient as render } from "../test/api";
import { connectedWorkspace, mockSchemaApi } from "../test/schemaFixture";
import type { Table } from "../lib/schemaModel";

const table: Table = {
  name: "users",
  keyspace: "shop",
  options: {},
  views: [],
  columns: [],
  indexes: [],
  triggers: [{ name: "audit", table: "users", class: "org.example.Audit" }],
};

describe("TriggersSheet", () => {
  beforeEach(() => {
    connectedWorkspace();
    mockSchemaApi({ "POST /p/local/triggers/preview": { body: { statement: "DROP TRIGGER audit ON shop.users;", errors: [], notes: [] } } });
  });

  it("lists triggers with their class", () => {
    render(<TriggersSheet table={table} onChanged={vi.fn()} />);
    expect(screen.getByText("audit")).toBeInTheDocument();
    expect(screen.getByText("org.example.Audit")).toBeInTheDocument();
  });

  it("shows an empty state", () => {
    render(<TriggersSheet table={{ ...table, triggers: [] }} onChanged={vi.fn()} />);
    expect(screen.getByText("This table has no triggers.")).toBeInTheDocument();
  });

  it("asks for confirmation before dropping", async () => {
    render(<TriggersSheet table={table} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Drop audit" }));
    expect(await screen.findByRole("button", { name: "Drop trigger" })).toBeInTheDocument();
  });

  it("hides actions when read-only", () => {
    render(<TriggersSheet table={table} readOnly onChanged={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "New trigger" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Drop audit" })).toBeNull();
  });
});
