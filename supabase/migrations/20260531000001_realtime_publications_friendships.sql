-- Enable Realtime on friendships so RelationshipContext can update its
-- pendingIncoming set live (new request arrives, request accepted/rejected,
-- friend removed) without requiring a manual refresh.

alter publication supabase_realtime add table friendships;
alter table friendships replica identity full;
