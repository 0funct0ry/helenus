import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IndexesSheet } from "./IndexesSheet";
import { renderWithClient as render } from "../test/api";
import { connectedWorkspace, mockSchemaApi } from "../test/schemaFixture";
import type { Table } from "../lib/schemaModel";

const table: Table = {
  name: "users",
  keyspace: "shop",
  options: {},
  views: [],
  columns: [{ name: "name", type: "text", kind: "regular", desc: { name: "text" } }],
  indexes: [
    { name: "by_name", column: "name", kind: "Secondary index", target: "name", badge: "2i" },
    { name: "tags_sai", column: "tags", kind: "SAI", target: "values(tags)", badge: "SAI", options: { case_sensitive: "false" } },
    { name: "legacy_custom", column: "x", kind: "Custom index", target: "x", badge: "custom" },
  ],
};

describe("IndexesSheet", () => {
  beforeEach(() => {
    connectedWorkspace();
    mockSchemaApi();
  });

  it("lists indexes with badge, target and options; custom ones are read-only", () => {
    render(<IndexesSheet table={table} serverMajor={5} onChanged={vi.fn()} />);
    expect(screen.getByText("by_name")).toBeInTheDocument();
    expect(screen.getByText("SAI")).toBeInTheDocument();
    expect(screen.getByText("VALUES")).toBeInTheDocument();
    expect(screen.getByText("case_sensitive=false")).toBeInTheDocument();
    expect(screen.getByText("custom")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Drop by_name" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Drop legacy_custom" })).toBeNull();
  });

  it("opens the New index dialog and a drop confirmation", async () => {
    render(<IndexesSheet table={table} serverMajor={5} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /New index/ }));
    expect(await screen.findByText("New index", { selector: "h2, h3, [role=dialog] *" })).toBeInTheDocument();
  });

  it("hides actions for system keyspaces", () => {
    render(<IndexesSheet table={table} serverMajor={5} readOnly onChanged={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /New index/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Drop by_name" })).toBeNull();
  });
});
