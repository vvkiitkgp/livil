-- create_group: security definer RPC so clients can create a group conversation
-- without hitting the conv_select RLS policy on the RETURNING clause.
create or replace function create_group(
  p_name      text,
  p_member_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   uuid;
  v_me   uuid := auth.uid();
  v_uid  uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  insert into conversations (kind, name, created_by)
  values ('group', p_name, v_me)
  returning id into v_id;

  -- Insert creator as admin first
  insert into conversation_members (conversation_id, user_id, role)
  values (v_id, v_me, 'admin');

  -- Insert the selected members (skip creator if included)
  foreach v_uid in array p_member_ids loop
    if v_uid <> v_me then
      insert into conversation_members (conversation_id, user_id, role)
      values (v_id, v_uid, 'member')
      on conflict (conversation_id, user_id) do nothing;
    end if;
  end loop;

  return v_id;
end;
$$;
