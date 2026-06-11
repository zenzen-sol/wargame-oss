-- Step 1 of plan 07: add `message jsonb` to `messages` and keep it in
-- sync with the parsed columns via a trigger. After this migration
-- every row has both representations; later steps cut readers over
-- to `message` and step 7 drops the parsed columns + this trigger.

alter table messages add column message jsonb;

-- Build a UIMessage from a row's parsed columns. Shape matches the
-- @ai-sdk/react `UIMessage<MessageMetadata, DataParts, ToolSet>` we
-- use in app code:
--
--   { id, role, metadata, parts: [...] }
--
-- Parts are appended in the canonical order the chat route streams:
--   data-turn → reasoning → text → tool-<name>
--
-- The function is `stable` (not `immutable`): the result is purely a
-- function of the input row, but row types aren't proven immutable
-- to the planner.
create or replace function messages_to_uimessage(m messages)
returns jsonb
language plpgsql
stable
as $$
declare
  parts jsonb := '[]'::jsonb;
  ui_role text;
  tool_name text;
begin
  if m.agent = 'system' then
    ui_role := 'system';
  else
    ui_role := 'assistant';
  end if;

  if m.role in ('review', 'argument') and m.agent in ('blue', 'red') then
    parts := parts || jsonb_build_array(jsonb_build_object(
      'type', 'data-turn',
      'data', jsonb_build_object(
        'kind', m.role::text,
        'side', m.agent::text,
        'issueId', m.issue_id
      )
    ));
  end if;

  if m.reasoning is not null and length(m.reasoning) > 0 then
    parts := parts || jsonb_build_array(jsonb_build_object(
      'type', 'reasoning',
      'text', m.reasoning
    ));
  end if;

  if m.content is not null and length(m.content) > 0 then
    parts := parts || jsonb_build_array(jsonb_build_object(
      'type', 'text',
      'text', m.content
    ));
  end if;

  if m.proposal_tool_call is not null and m.proposal_tool_call ? 'name' then
    tool_name := m.proposal_tool_call ->> 'name';
    parts := parts || jsonb_build_array(jsonb_build_object(
      'type', 'tool-' || tool_name,
      'toolCallId', m.id::text,
      'state', 'input-available',
      'input', m.proposal_tool_call - 'name'
    ));
  end if;

  return jsonb_build_object(
    'id', m.id::text,
    'role', ui_role,
    'metadata', jsonb_build_object(
      'agent', m.agent::text,
      'dbRole', m.role::text,
      'issueId', m.issue_id,
      'createdAt', (extract(epoch from m.created_at) * 1000)::bigint,
      'completedAt', case
        when m.completed_at is null then null
        else (extract(epoch from m.completed_at) * 1000)::bigint
      end
    ),
    'parts', parts
  );
end;
$$;

-- Backfill existing rows.
update messages set message = messages_to_uimessage(messages.*);

-- Keep new writes in sync. The trigger fires `before insert or update`
-- so the `message` column lands in the same row write — no second
-- statement needed from the app side. Step 6 of plan 07 moves writers
-- to populate `message` directly; step 7 drops the trigger.
create or replace function messages_sync_uimessage()
returns trigger
language plpgsql
as $$
begin
  new.message := messages_to_uimessage(new.*);
  return new;
end;
$$;

create trigger messages_sync_uimessage_trg
before insert or update on messages
for each row
execute function messages_sync_uimessage();

-- `message` is logically NOT NULL after the trigger lands, but we
-- leave the constraint off so the backfill above (which ran before
-- the trigger existed) can't trip on any future hand-edits. Step 7
-- can add `not null` once the parsed columns are gone and `message`
-- is the only source of truth.
