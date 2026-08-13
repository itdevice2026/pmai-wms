import Link from "next/link";
import { q } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { Card, Badge, DataTable, type Column } from "@/components/ui";
import { kg, num } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customers & SKUs · PMAI Warehouse" };

type Customer = {
  id: number;
  code: string;
  name: string;
  address: string | null;
  contact_person: string | null;
  contact_no: string | null;
  terms_days: number | null;
  is_active: boolean;
};

type Sku = {
  id: number;
  sku: string;
  name: string;
  class_code: string | null;
  band_code: string | null;
  band_min_kg: string | null;
  band_max_kg: string | null;
  stage: string;
  uom: string;
  shelf_life_days: number | null;
  is_active: boolean;
  on_hand_crates: number;
};

const TABS = [
  { key: "skus", label: "SKUs" },
  { key: "customers", label: "Customers" },
  { key: "growers", label: "Growers" },
  { key: "crate-types", label: "Crate Types" },
];

export default async function MasterDataPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requirePermission("sys.masterdata.manage");
  const { tab } = await searchParams;
  const active = TABS.some((t) => t.key === tab) ? tab! : "skus";

  const header = (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Customers &amp; SKUs</h1>
        <p className="mt-1 text-sm text-slate-500">
          Reference data behind weighing, picking and dispatch.
        </p>
      </div>
      <div className="no-print mb-6 border-b border-slate-200">
        <nav className="-mb-px flex gap-6">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/system/master-data?tab=${t.key}`}
              className={`border-b-2 px-1 pb-3 text-sm font-medium transition ${
                t.key === active
                  ? "border-brand-600 text-brand-700"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </div>
    </>
  );

  if (active === "customers") {
    const rows = await q<Customer>(
      `SELECT id, code, name, address, contact_person, contact_no, terms_days, is_active
         FROM customers ORDER BY is_active DESC, name`
    );
    const cols: Column<Customer>[] = [
      { key: "code", header: "Code" },
      { key: "name", header: "Name" },
      { key: "contact_person", header: "Contact" },
      { key: "contact_no", header: "Phone" },
      { key: "address", header: "Address" },
      { key: "terms_days", header: "Terms", align: "right", render: (r) => `${r.terms_days ?? 0} days` },
      {
        key: "is_active",
        header: "Status",
        render: (r) => <Badge tone={r.is_active ? "green" : "slate"}>{r.is_active ? "Active" : "Inactive"}</Badge>,
      },
    ];
    return (
      <>
        {header}
        <Card title={`Customers (${rows.length})`} padded={false}>
          <DataTable columns={cols} rows={rows} rowKey={(r) => String(r.id)} />
        </Card>
      </>
    );
  }

  if (active === "growers") {
    const rows = await q<{
      id: number; code: string; name: string; farm_address: string | null;
      contact_person: string | null; contact_no: string | null;
      accreditation_no: string | null; is_active: boolean; receipts: number;
    }>(
      `SELECT g.*, (SELECT count(*) FROM live_bird_receipts r WHERE r.grower_id = g.id)::int AS receipts
         FROM growers g ORDER BY g.is_active DESC, g.name`
    );
    return (
      <>
        {header}
        <Card title={`Growers (${rows.length})`} padded={false}>
          <DataTable
            columns={[
              { key: "code", header: "Code" },
              { key: "name", header: "Farm" },
              { key: "farm_address", header: "Location" },
              { key: "contact_person", header: "Contact" },
              { key: "contact_no", header: "Phone" },
              { key: "accreditation_no", header: "Accreditation" },
              { key: "receipts", header: "Receipts", align: "right", render: (r) => num(r.receipts) },
            ]}
            rows={rows}
            rowKey={(r) => String(r.id)}
          />
        </Card>
      </>
    );
  }

  if (active === "crate-types") {
    const rows = await q<{
      id: number; code: string; name: string; tare_kg: string;
      default_heads: number | null; is_partial: boolean; is_active: boolean; used: number;
    }>(
      `SELECT ct.*, (SELECT count(*) FROM crates c WHERE c.crate_type_id = ct.id)::int AS used
         FROM crate_types ct ORDER BY ct.sort_order`
    );
    return (
      <>
        {header}
        <Card title={`Crate types (${rows.length})`} padded={false}>
          <DataTable
            columns={[
              { key: "code", header: "Code" },
              { key: "name", header: "Name" },
              { key: "tare_kg", header: "Tare (kg)", align: "right", render: (r) => kg(r.tare_kg, 3) },
              { key: "default_heads", header: "Default heads", align: "right", render: (r) => r.default_heads ?? "—" },
              { key: "is_partial", header: "Partial", render: (r) => (r.is_partial ? "Yes" : "No") },
              { key: "used", header: "Crates", align: "right", render: (r) => num(r.used) },
            ]}
            rows={rows}
            rowKey={(r) => String(r.id)}
          />
          <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
            Tare is subtracted from the scale reading to give net weight. It defaults to 0, which
            assumes operators tare the scale physically — set real values here if that changes.
          </p>
        </Card>
      </>
    );
  }

  const rows = await q<Sku>(
    `SELECT p.id, p.sku, p.name, pc.code AS class_code, p.band_code,
            p.band_min_kg, p.band_max_kg, p.stage, p.uom, p.shelf_life_days, p.is_active,
            (SELECT count(*) FROM crates c
              WHERE c.product_id = p.id AND NOT c.is_voided
                AND c.status IN ('warehouse','storage','fps_processed','wh_received_cut'))::int
              AS on_hand_crates
       FROM products p LEFT JOIN product_classes pc ON pc.id = p.class_id
      ORDER BY p.stage, pc.sort_order NULLS FIRST, p.sort_order, p.sku`
  );

  const cols: Column<Sku>[] = [
    { key: "sku", header: "SKU" },
    { key: "name", header: "Description" },
    { key: "class_code", header: "Class", render: (r) => (r.class_code ? <Badge>{r.class_code}</Badge> : "—") },
    {
      key: "band",
      header: "Band (per head)",
      align: "right",
      render: (r) =>
        r.band_min_kg
          ? `${Number(r.band_min_kg).toFixed(2)}–${Number(r.band_max_kg).toFixed(2)} kg`
          : "—",
    },
    { key: "stage", header: "Stage", render: (r) => <Badge>{r.stage}</Badge> },
    { key: "shelf_life_days", header: "Shelf life", align: "right", render: (r) => (r.shelf_life_days ? `${r.shelf_life_days} d` : "—") },
    { key: "on_hand_crates", header: "On hand", align: "right", render: (r) => num(r.on_hand_crates) },
    {
      key: "is_active",
      header: "Status",
      render: (r) => <Badge tone={r.is_active ? "green" : "slate"}>{r.is_active ? "Active" : "Inactive"}</Badge>,
    },
  ];

  return (
    <>
      {header}
      <Card title={`SKUs (${rows.length})`} padded={false}>
        <DataTable columns={cols} rows={rows} rowKey={(r) => String(r.id)} />
      </Card>
    </>
  );
}
