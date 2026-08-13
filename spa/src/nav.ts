export type NavItem = {
  label: string;
  href: string;
  permission?: string;
};

export type NavSection = {
  title: string | null;
  items: NavItem[];
};

/** Mirrors the module structure of the existing PMAI warehouse system. */
export const NAV: NavSection[] = [
  {
    title: null,
    items: [{ label: "Dashboard", href: "/dashboard" }],
  },
  {
    title: "Basic Dressing",
    items: [
      { label: "Live Bird Receiving", href: "/bd/live-bird-receiving", permission: "bd.live_bird.view" },
      { label: "BD Weighing Entry", href: "/bd/weighing", permission: "bd.weighing.view" },
      { label: "Byproducts", href: "/bd/byproducts", permission: "bd.byproducts.view" },
      { label: "BD Scan Station", href: "/bd/scan-station", permission: "bd.scan.use" },
      { label: "Import", href: "/bd/import", permission: "bd.import.use" },
    ],
  },
  {
    title: "Further Processing",
    items: [
      { label: "FPS Entry", href: "/fps/entry", permission: "fps.entry.view" },
      { label: "FPS Station", href: "/fps/station", permission: "fps.station.use" },
      { label: "FPS Pallets", href: "/fps/pallets", permission: "fps.pallets.manage" },
    ],
  },
  {
    title: "Warehouse",
    items: [
      { label: "FPS Receiving", href: "/wh/fps-receiving", permission: "wh.receiving.view" },
      { label: "FPS Receiving Station", href: "/wh/fps-receiving-station", permission: "wh.receiving.manage" },
      { label: "BD Pallet Creation", href: "/wh/pallet-creation", permission: "wh.pallet.manage" },
      { label: "Location Transfer", href: "/wh/location-transfer", permission: "wh.transfer.view" },
      { label: "Pallet Transfer", href: "/wh/pallet-transfer", permission: "wh.transfer.view" },
      { label: "Stock Transfer", href: "/wh/stock-transfer", permission: "wh.transfer.view" },
      { label: "Storage Map", href: "/wh/storage-map", permission: "wh.storage_map.view" },
      { label: "Picklist", href: "/wh/picklist", permission: "wh.picklist.view" },
      { label: "Issuance", href: "/wh/issuance", permission: "wh.issuance.view" },
      { label: "Dispatch", href: "/wh/dispatch", permission: "wh.dispatch.view" },
    ],
  },
  {
    title: "Planning",
    items: [
      { label: "Pallet Disposition", href: "/planning/pallet-disposition", permission: "plan.disposition.view" },
      { label: "Blanket Job Order", href: "/planning/blanket-job-order", permission: "plan.bjo.view" },
    ],
  },
  {
    title: "Report",
    items: [
      { label: "Basic Dressing Report", href: "/reports/basic-dressing", permission: "report.view" },
      { label: "FPS Production Output", href: "/reports/fps-output", permission: "report.view" },
      { label: "Pallets", href: "/reports/pallets", permission: "report.view" },
      { label: "Stock on Hand", href: "/reports/stock-on-hand", permission: "report.view" },
      { label: "Warehouse Records", href: "/reports/warehouse-records", permission: "report.view" },
      { label: "Storage Rooms", href: "/reports/storage-rooms", permission: "report.view" },
      { label: "Production Summary", href: "/reports/production-summary", permission: "report.view" },
      { label: "Issuance Summary", href: "/reports/issuance-summary", permission: "report.view" },
      { label: "Dispatch Summary", href: "/reports/dispatch-summary", permission: "report.view" },
      { label: "Crate Audit", href: "/reports/crate-audit", permission: "report.view" },
      { label: "Unscanned Crates", href: "/reports/unscanned-crates", permission: "report.view" },
      { label: "Job Order List", href: "/reports/job-orders", permission: "report.view" },
      { label: "User Activity Log", href: "/reports/activity-log", permission: "sys.activity.view" },
    ],
  },
  {
    title: "System",
    items: [
      { label: "My Account", href: "/system/account" },
      { label: "Admin", href: "/system/admin", permission: "sys.users.view" },
      { label: "Customers & SKUs", href: "/system/master-data", permission: "sys.masterdata.manage" },
      { label: "Locked Records", href: "/system/locked-records", permission: "sys.locks.manage" },
      { label: "RBAC", href: "/system/rbac", permission: "sys.rbac.manage" },
    ],
  },
];

export const CRATE_STATUS_LABEL: Record<string, string> = {
  production: "Production",
  warehouse: "Warehouse",
  storage: "Storage",
  cutting: "Cutting",
  issued_to_fps: "Issued to FPS",
  fps_processed: "FPS Processed",
  wh_received_cut: "WH Received Cut",
  picked: "Picked",
  dispatched: "Dispatched",
  voided: "Voided",
};

export const CRATE_STATUS_TONE: Record<string, string> = {
  production: "amber",
  warehouse: "blue",
  storage: "indigo",
  cutting: "green",
  issued_to_fps: "purple",
  fps_processed: "pink",
  wh_received_cut: "teal",
  picked: "orange",
  dispatched: "slate",
  voided: "red",
};
