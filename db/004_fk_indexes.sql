-- ============================================================================
-- 004 — Foreign-key indexes that matter at production scale.
--
-- The linter flags all 123 unindexed FKs, but most of those are audit columns
-- (created_by / approved_by / checked_by) that are only ever read one row at a
-- time from a document already located by its primary key. Indexing all of
-- them would cost write throughput on the hot path (crate weighing) for no
-- read benefit. These are the FKs that are actually used as filters or join
-- keys on large tables.
-- ============================================================================

-- Line tables joined back to crates/pallets/products on every document open
CREATE INDEX IF NOT EXISTS tl_crate_idx        ON transfer_lines(crate_id);
CREATE INDEX IF NOT EXISTS tl_pallet_idx       ON transfer_lines(pallet_id);
CREATE INDEX IF NOT EXISTS issl_crate_idx      ON issuance_lines(crate_id);
CREATE INDEX IF NOT EXISTS issl_pallet_idx     ON issuance_lines(pallet_id);
CREATE INDEX IF NOT EXISTS dl_dispatch_idx     ON dispatch_lines(dispatch_id);
CREATE INDEX IF NOT EXISTS dl_crate_idx        ON dispatch_lines(crate_id);
CREATE INDEX IF NOT EXISTS dl_pallet_idx       ON dispatch_lines(pallet_id);
CREATE INDEX IF NOT EXISTS pl_picklist_idx     ON picklist_lines(picklist_id);
CREATE INDEX IF NOT EXISTS pp_line_idx         ON picklist_picks(picklist_line_id);
CREATE INDEX IF NOT EXISTS pp_crate_idx        ON picklist_picks(crate_id);
CREATE INDEX IF NOT EXISTS fi_fps_idx          ON fps_inputs(fps_id);
CREATE INDEX IF NOT EXISTS fi_crate_idx        ON fps_inputs(crate_id);
CREATE INDEX IF NOT EXISTS fo_fps_idx          ON fps_outputs(fps_id);
CREATE INDEX IF NOT EXISTS fo_crate_idx        ON fps_outputs(crate_id);
CREATE INDEX IF NOT EXISTS ci_run_idx          ON cutting_inputs(run_id);
CREATE INDEX IF NOT EXISTS ci_crate_idx        ON cutting_inputs(crate_id);
CREATE INDEX IF NOT EXISTS co_run_idx          ON cutting_outputs(run_id);
CREATE INDEX IF NOT EXISTS co_crate_idx        ON cutting_outputs(crate_id);
CREATE INDEX IF NOT EXISTS sal_adj_idx         ON stock_adjustment_lines(adj_id);
CREATE INDEX IF NOT EXISTS sal_crate_idx       ON stock_adjustment_lines(crate_id);

-- Crate lineage: "what came out of this crate" during cutting / FPS
CREATE INDEX IF NOT EXISTS crates_parent_idx   ON crates(parent_crate_id);

-- Document headers filtered by customer / job order in the report screens
CREATE INDEX IF NOT EXISTS dispatches_cust_idx ON dispatches(customer_id);
CREATE INDEX IF NOT EXISTS picklists_cust_idx  ON picklists(customer_id);
CREATE INDEX IF NOT EXISTS iss_cust_idx        ON issuances(customer_id);
CREATE INDEX IF NOT EXISTS iss_jo_idx          ON issuances(job_order_id);
CREATE INDEX IF NOT EXISTS fps_jo_idx          ON fps_processings(job_order_id);
CREATE INDEX IF NOT EXISTS jo_bjo_idx          ON job_orders(blanket_job_order_id);
CREATE INDEX IF NOT EXISTS pd_pallet_idx       ON pallet_dispositions(pallet_id);

-- Storage map draws locations grouped by room
CREATE INDEX IF NOT EXISTS locations_room_idx  ON locations(storage_room_id);

-- Byproduct + weighing reporting by product
CREATE INDEX IF NOT EXISTS bpe_product_idx     ON byproduct_entries(product_id);
CREATE INDEX IF NOT EXISTS wr_product_idx      ON weighing_records(product_id);

-- Activity log filtered by module in the User Activity Log screen
CREATE INDEX IF NOT EXISTS al_module_idx       ON activity_logs(module, created_at DESC);
