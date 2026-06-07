-- Drops the new-fans summary RPCs and their tracking column.
-- The NewFansBanner was removed and its functionality folded into the
-- Activity notification center (Slice 3), leaving these unused. Nothing
-- in src/ or any other migration references them.

drop function if exists get_new_fans_summary();
drop function if exists mark_fans_seen();

alter table profiles drop column if exists fans_seen_at;
