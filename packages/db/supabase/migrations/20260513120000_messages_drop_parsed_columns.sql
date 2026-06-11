-- Plan 07 step 7b — drop the parsed columns now that the `message`
-- jsonb is canonical and all writers/readers operate on it directly.
--
-- The trigger introduced in 20260513000000 stops being useful: it
-- was needed when writers still populated parsed columns; now the
-- route writes `message` straight, and the parsed columns are gone.

drop trigger if exists messages_sync_uimessage_trg on messages;
drop function if exists messages_sync_uimessage();
drop function if exists messages_to_uimessage(messages);

-- Tear down the legacy parsed columns. Surviving columns:
-- id, project_id, issue_id, status, stream_id, created_at, message.
alter table messages drop column if exists content;
alter table messages drop column if exists reasoning;
alter table messages drop column if exists agent;
alter table messages drop column if exists role;
alter table messages drop column if exists proposal_tool_call;
alter table messages drop column if exists completed_at;

-- `message` is now the canonical payload; make it NOT NULL so the
-- type-system can assume it's always populated.
alter table messages alter column message set not null;

-- `message_role` enum has no remaining columns referencing it. The
-- `agent_kind` enum stays (still used by issues.raised_by).
drop type if exists message_role;
