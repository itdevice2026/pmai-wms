-- ============================================================================
-- 003 — Reference seed: roles, permissions, plant, storage map, products
-- Idempotent: safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ROLES
-- ---------------------------------------------------------------------------
INSERT INTO roles (code, name, description, is_system) VALUES
  ('admin',      'Administrator',   'Full system access',                         true),
  ('manager',    'Plant Manager',   'Approves documents, sees all reports',       true),
  ('production', 'Production',      'Basic dressing: receiving, weighing, byproducts', true),
  ('fps',        'Further Processing','FPS entry, stations, pallets',             true),
  ('warehouse',  'Warehouse',       'Receiving, transfers, picking, dispatch',    true),
  ('qa',         'Quality Assurance','Temperature logs, crate audit, holds',      true),
  ('viewer',     'Viewer',          'Read-only access to reports',                true)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- PERMISSIONS — one row per module x action
-- ---------------------------------------------------------------------------
INSERT INTO permissions (code, module, action, label) VALUES
  ('bd.live_bird.view','Basic Dressing','view','View live bird receiving'),
  ('bd.live_bird.manage','Basic Dressing','edit','Record live bird receiving'),
  ('bd.weighing.view','Basic Dressing','view','View weighing entries'),
  ('bd.weighing.manage','Basic Dressing','edit','Record weighing entries'),
  ('bd.byproducts.view','Basic Dressing','view','View byproducts'),
  ('bd.byproducts.manage','Basic Dressing','edit','Record byproducts'),
  ('bd.scan.use','Basic Dressing','edit','Use the BD scan station'),
  ('bd.import.use','Basic Dressing','create','Import production data'),

  ('fps.entry.view','Further Processing','view','View FPS entries'),
  ('fps.entry.manage','Further Processing','edit','Create FPS entries'),
  ('fps.station.use','Further Processing','edit','Use FPS stations'),
  ('fps.pallets.manage','Further Processing','edit','Manage FPS pallets'),

  ('wh.receiving.view','Warehouse','view','View warehouse receiving'),
  ('wh.receiving.manage','Warehouse','edit','Receive into the warehouse'),
  ('wh.pallet.manage','Warehouse','edit','Create and edit pallets'),
  ('wh.transfer.view','Warehouse','view','View transfers'),
  ('wh.transfer.manage','Warehouse','edit','Create transfers'),
  ('wh.transfer.approve','Warehouse','approve','Approve transfers'),
  ('wh.storage_map.view','Warehouse','view','View the storage map'),
  ('wh.picklist.view','Warehouse','view','View picklists'),
  ('wh.picklist.manage','Warehouse','edit','Create and pick picklists'),
  ('wh.issuance.view','Warehouse','view','View issuances'),
  ('wh.issuance.manage','Warehouse','edit','Create issuances'),
  ('wh.issuance.approve','Warehouse','approve','Approve issuances'),
  ('wh.dispatch.view','Warehouse','view','View dispatches'),
  ('wh.dispatch.manage','Warehouse','edit','Create dispatches'),
  ('wh.dispatch.release','Warehouse','approve','Release dispatches'),
  ('wh.adjustment.manage','Warehouse','edit','Create stock adjustments'),
  ('wh.adjustment.approve','Warehouse','approve','Approve stock adjustments'),

  ('plan.disposition.view','Planning','view','View pallet dispositions'),
  ('plan.disposition.manage','Planning','edit','Plan pallet dispositions'),
  ('plan.bjo.view','Planning','view','View blanket job orders'),
  ('plan.bjo.manage','Planning','edit','Manage blanket job orders'),

  ('qa.temperature.view','Quality','view','View temperature logs'),
  ('qa.temperature.manage','Quality','edit','Record temperature logs'),
  ('qa.crate_audit.view','Quality','view','View crate audit trail'),

  ('report.view','Reports','view','View reports'),
  ('report.export','Reports','export','Export reports'),

  ('sys.users.view','System','view','View users'),
  ('sys.users.manage','System','edit','Create and edit users'),
  ('sys.rbac.manage','System','edit','Manage roles and permissions'),
  ('sys.masterdata.manage','System','edit','Manage customers, SKUs, locations'),
  ('sys.locks.manage','System','edit','Lock and unlock records'),
  ('sys.activity.view','System','view','View the activity log')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- ROLE -> PERMISSION MAPPING
-- ---------------------------------------------------------------------------
-- admin: everything
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.code = 'admin'
ON CONFLICT DO NOTHING;

-- manager: everything except RBAC/user administration
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'manager' AND p.code NOT IN ('sys.rbac.manage','sys.users.manage')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = ANY (ARRAY[
  'bd.live_bird.view','bd.live_bird.manage','bd.weighing.view','bd.weighing.manage',
  'bd.byproducts.view','bd.byproducts.manage','bd.scan.use','bd.import.use','report.view'])
WHERE r.code = 'production' ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = ANY (ARRAY[
  'fps.entry.view','fps.entry.manage','fps.station.use','fps.pallets.manage','report.view'])
WHERE r.code = 'fps' ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = ANY (ARRAY[
  'wh.receiving.view','wh.receiving.manage','wh.pallet.manage',
  'wh.transfer.view','wh.transfer.manage','wh.storage_map.view',
  'wh.picklist.view','wh.picklist.manage','wh.issuance.view','wh.issuance.manage',
  'wh.dispatch.view','wh.dispatch.manage','wh.adjustment.manage','report.view'])
WHERE r.code = 'warehouse' ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = ANY (ARRAY[
  'qa.temperature.view','qa.temperature.manage','qa.crate_audit.view',
  'wh.storage_map.view','report.view','report.export'])
WHERE r.code = 'qa' ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('report.view')
WHERE r.code = 'viewer' ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- PLANT
-- ---------------------------------------------------------------------------
INSERT INTO plants (code, name, address) VALUES
  ('PMAI', 'PMAI Dressing Plant', 'Philippines')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- SIZE CLASSES (dressed bird weight bands, kg)
-- ---------------------------------------------------------------------------
INSERT INTO size_classes (code, name, min_weight, max_weight, sort_order) VALUES
  ('XS',  'Extra Small (<0.90)',  0.000, 0.899, 1),
  ('S',   'Small (0.90-1.09)',    0.900, 1.099, 2),
  ('M',   'Medium (1.10-1.29)',   1.100, 1.299, 3),
  ('L',   'Large (1.30-1.49)',    1.300, 1.499, 4),
  ('XL',  'Extra Large (1.50-1.79)', 1.500, 1.799, 5),
  ('JMB', 'Jumbo (1.80+)',        1.800, 9.999, 6)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- PRODUCT CATEGORIES + PRODUCTS
-- ---------------------------------------------------------------------------
INSERT INTO product_categories (code, name, stage) VALUES
  ('WD',  'Whole Dressed',      'bd'),
  ('CUT', 'Cut-ups',            'cut'),
  ('BYP', 'Byproducts',         'byproduct'),
  ('FPS', 'Further Processed',  'fps')
ON CONFLICT (code) DO NOTHING;

INSERT INTO products (sku, name, category_id, stage, uom, shelf_life_days, storage_temp_min, storage_temp_max)
SELECT v.sku, v.name, c.id, v.stage, 'KG', v.shelf, v.tmin, v.tmax
FROM (VALUES
  ('WD-XS','Whole Dressed Chicken - XS','WD','bd',5,0.0,4.0),
  ('WD-S', 'Whole Dressed Chicken - S', 'WD','bd',5,0.0,4.0),
  ('WD-M', 'Whole Dressed Chicken - M', 'WD','bd',5,0.0,4.0),
  ('WD-L', 'Whole Dressed Chicken - L', 'WD','bd',5,0.0,4.0),
  ('WD-XL','Whole Dressed Chicken - XL','WD','bd',5,0.0,4.0),
  ('WD-JMB','Whole Dressed Chicken - Jumbo','WD','bd',5,0.0,4.0),
  ('CUT-BRST','Chicken Breast','CUT','cut',5,0.0,4.0),
  ('CUT-THGH','Chicken Thigh','CUT','cut',5,0.0,4.0),
  ('CUT-DRUM','Chicken Drumstick','CUT','cut',5,0.0,4.0),
  ('CUT-WING','Chicken Wing','CUT','cut',5,0.0,4.0),
  ('CUT-LEGQ','Leg Quarter','CUT','cut',5,0.0,4.0),
  ('BYP-FEET','Chicken Feet','BYP','byproduct',3,0.0,4.0),
  ('BYP-HEAD','Chicken Head','BYP','byproduct',3,0.0,4.0),
  ('BYP-GIZZ','Gizzard','BYP','byproduct',3,0.0,4.0),
  ('BYP-LIVR','Liver','BYP','byproduct',3,0.0,4.0),
  ('BYP-NECK','Neck','BYP','byproduct',3,0.0,4.0),
  ('FPS-MARI','Marinated Chicken','FPS','fps',30,-18.0,-15.0),
  ('FPS-FILL','Chicken Fillet (Frozen)','FPS','fps',180,-18.0,-15.0),
  ('FPS-GRND','Ground Chicken','FPS','fps',180,-18.0,-15.0)
) AS v(sku,name,cat,stage,shelf,tmin,tmax)
JOIN product_categories c ON c.code = v.cat
ON CONFLICT (sku) DO NOTHING;

-- ---------------------------------------------------------------------------
-- STORAGE ROOMS + LOCATIONS (grid based, drives the Storage Map screen)
-- ---------------------------------------------------------------------------
INSERT INTO storage_rooms (plant_id, code, name, kind, temp_min, temp_max, capacity_pallets, rows_count, cols_count)
SELECT p.id, v.code, v.name, v.kind::location_kind, v.tmin, v.tmax, v.cap, v.rws, v.cls
FROM plants p, (VALUES
  ('CH1','Chiller 1',        'chiller',      0.0,  4.0, 48, 6, 8),
  ('CH2','Chiller 2',        'chiller',      0.0,  4.0, 48, 6, 8),
  ('BF1','Blast Freezer 1',  'blast_freezer',-35.0,-25.0, 24, 4, 6),
  ('FZ1','Freezer 1',        'freezer',     -20.0,-15.0, 60, 6,10),
  ('STG','Staging Area',     'staging',       0.0, 10.0, 20, 4, 5)
) AS v(code,name,kind,tmin,tmax,cap,rws,cls)
WHERE p.code = 'PMAI'
ON CONFLICT (plant_id, code) DO NOTHING;

-- One location per grid cell in each room: e.g. CH1-R01C03
INSERT INTO locations (plant_id, storage_room_id, code, name, kind, zone, grid_row, grid_col, capacity_pallets, temp_min, temp_max)
SELECT sr.plant_id, sr.id,
       sr.code || '-R' || lpad(r::text,2,'0') || 'C' || lpad(c::text,2,'0'),
       sr.name || ' R' || r || 'C' || c,
       sr.kind, sr.code, r, c, 1, sr.temp_min, sr.temp_max
FROM storage_rooms sr
CROSS JOIN LATERAL generate_series(1, sr.rows_count) r
CROSS JOIN LATERAL generate_series(1, sr.cols_count) c
ON CONFLICT (plant_id, code) DO NOTHING;

-- Non-storage functional locations
INSERT INTO locations (plant_id, code, name, kind)
SELECT p.id, v.code, v.name, v.kind::location_kind
FROM plants p, (VALUES
  ('PROD-LINE','Dressing Line',        'production'),
  ('WH-RECV',  'Warehouse Receiving',  'staging'),
  ('CUT-ROOM', 'Cutting Room',         'cutting'),
  ('FPS-ROOM', 'Further Processing Room','fps'),
  ('DISPATCH', 'Dispatch Bay',         'dispatch')
) AS v(code,name,kind)
WHERE p.code = 'PMAI'
ON CONFLICT (plant_id, code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- STATIONS
-- ---------------------------------------------------------------------------
INSERT INTO stations (plant_id, code, name, kind, location_id)
SELECT p.id, v.code, v.name, v.kind, l.id
FROM plants p
CROSS JOIN (VALUES
  ('BDW-01','BD Weighing Station 1','bd_weighing','PROD-LINE'),
  ('BDW-02','BD Weighing Station 2','bd_weighing','PROD-LINE'),
  ('BDS-01','BD Scan Station',      'bd_scan',    'PROD-LINE'),
  ('WHR-01','WH Receiving Station', 'wh_receiving','WH-RECV'),
  ('FPS-01','FPS Station 1',        'fps_station','FPS-ROOM'),
  ('FPS-02','FPS Station 2',        'fps_station','FPS-ROOM'),
  ('CUT-01','Cutting Station 1',    'cutting',    'CUT-ROOM')
) AS v(code,name,kind,loc)
LEFT JOIN locations l ON l.code = v.loc
WHERE p.code = 'PMAI'
ON CONFLICT (plant_id, code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- GROWERS + CUSTOMERS
-- ---------------------------------------------------------------------------
INSERT INTO growers (code, name, farm_address, contact_person, contact_no) VALUES
  ('GR-001','San Miguel Contract Farm - Bulacan','Bulacan','Rey Domingo','0917-000-0001'),
  ('GR-002','Pacific Farms - Batangas','Batangas','Elena Cruz','0917-000-0002'),
  ('GR-003','Northwind Poultry - Nueva Ecija','Nueva Ecija','Ben Aquino','0917-000-0003')
ON CONFLICT (code) DO NOTHING;

INSERT INTO customers (code, name, address, contact_person, contact_no, terms_days) VALUES
  ('CU-001','Meatplus Trading - Main','Metro Manila','Nomer Sta Ana','0917-100-0001',30),
  ('CU-002','Jollibee Commissary','Metro Manila','Purchasing Desk','0917-100-0002',30),
  ('CU-003','SM Supermarket - NCR','Metro Manila','Receiving','0917-100-0003',45),
  ('CU-004','Public Market Wholesale','Bulacan','Walk-in','',0)
ON CONFLICT (code) DO NOTHING;
