-- ---------- usage event kinds: billing events ----------
-- plan_purchase was already being inserted by the marketplace webhook but the
-- constraint from 0006 never allowed it (silently failed). Add it plus
-- single_purchase for $15 one-time plan credits, which feeds affiliate stats.
alter table public.usage_events
  drop constraint if exists usage_events_kind_check;
alter table public.usage_events
  add constraint usage_events_kind_check
    check (kind in (
      'plan_generate','plan_modify','chat_message','diagnosis','ideas',
      'plan_clone','plan_purchase','single_purchase'
    ));
