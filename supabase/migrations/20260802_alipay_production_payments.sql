begin;

alter table public.orders
  add column if not exists out_trade_no text,
  add column if not exists alipay_trade_no text,
  add column if not exists plan_id text,
  add column if not exists subject text,
  add column if not exists membership_granted_at timestamptz,
  add column if not exists notify_summary jsonb not null default '{}'::jsonb;

update public.orders
set out_trade_no = order_no
where out_trade_no is null
  and order_no is not null;

create unique index if not exists orders_out_trade_no_key
  on public.orders (out_trade_no)
  where out_trade_no is not null;

create unique index if not exists orders_alipay_trade_no_key
  on public.orders (alipay_trade_no)
  where alipay_trade_no is not null and alipay_trade_no <> '';

create or replace function public.create_or_reuse_alipay_order(
  p_out_trade_no text,
  p_phone text,
  p_plan_id text,
  p_product_code text,
  p_subject text,
  p_amount_cents integer,
  p_currency text,
  p_payment_provider text
)
returns table (
  out_trade_no text,
  order_no text,
  phone text,
  plan_id text,
  subject text,
  amount_cents integer,
  currency text,
  status text,
  payment_provider text,
  created_at timestamptz,
  reused boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_reused boolean := false;
begin
  if p_phone !~ '^1[3-9][0-9]{9}$'
    or p_out_trade_no !~ '^RSE[0-9]{20,40}$'
    or p_currency <> 'CNY'
    or p_payment_provider <> 'alipay'
  then
    raise exception 'invalid_alipay_order_input';
  end if;

  if not (
    (p_plan_id = 'monthly'
      and p_product_code = 'real_scene_english_monthly'
      and p_subject = 'Real Scene English Monthly Pass'
      and p_amount_cents = 1990)
    or
    (p_plan_id = 'lifetime'
      and p_product_code = 'real_scene_english_lifetime'
      and p_subject = 'Real Scene English Lifetime Access'
      and p_amount_cents = 19900)
  ) then
    raise exception 'invalid_alipay_plan_catalog';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_phone || ':' || p_plan_id, 0));

  select o.*
  into v_order
  from public.orders o
  where o.phone = p_phone
    and o.plan_id = p_plan_id
    and o.payment_provider = 'alipay'
    and o.status = 'pending'
    and o.created_at >= now() - interval '15 minutes'
  order by o.created_at desc
  limit 1
  for update;

  if not found then
    insert into public.orders (
      order_no,
      out_trade_no,
      phone,
      plan_id,
      product_code,
      subject,
      amount_cents,
      currency,
      status,
      payment_provider
    ) values (
      p_out_trade_no,
      p_out_trade_no,
      p_phone,
      p_plan_id,
      p_product_code,
      p_subject,
      p_amount_cents,
      p_currency,
      'pending',
      p_payment_provider
    )
    returning * into v_order;
  else
    v_reused := true;
  end if;

  return query select
    v_order.out_trade_no,
    v_order.order_no,
    v_order.phone,
    v_order.plan_id,
    v_order.subject,
    v_order.amount_cents,
    v_order.currency,
    v_order.status,
    v_order.payment_provider,
    v_order.created_at,
    v_reused;
end;
$$;

create or replace function public.finalize_alipay_payment(
  p_out_trade_no text,
  p_alipay_trade_no text,
  p_paid_at timestamptz,
  p_notify_summary jsonb default '{}'::jsonb
)
returns table (
  processed boolean,
  duplicate boolean,
  phone text,
  plan_id text,
  premium_until timestamptz,
  lifetime_access boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_user public.users%rowtype;
  v_processed boolean := false;
  v_duplicate boolean := false;
begin
  if p_out_trade_no !~ '^RSE[0-9]{20,40}$'
    or coalesce(trim(p_alipay_trade_no), '') = ''
    or p_paid_at is null
  then
    raise exception 'invalid_alipay_finalize_input';
  end if;

  select o.*
  into v_order
  from public.orders o
  where o.out_trade_no = p_out_trade_no
  for update;

  if not found then
    raise exception 'alipay_order_not_found';
  end if;

  if v_order.payment_provider <> 'alipay'
    or v_order.currency <> 'CNY'
    or not (
      (v_order.plan_id = 'monthly'
        and v_order.product_code = 'real_scene_english_monthly'
        and v_order.amount_cents = 1990)
      or
      (v_order.plan_id = 'lifetime'
        and v_order.product_code = 'real_scene_english_lifetime'
        and v_order.amount_cents = 19900)
    )
  then
    raise exception 'alipay_order_catalog_mismatch';
  end if;

  if v_order.status = 'paid' and v_order.membership_granted_at is not null then
    if coalesce(v_order.alipay_trade_no, p_alipay_trade_no) <> p_alipay_trade_no then
      raise exception 'alipay_trade_no_mismatch';
    end if;
    v_duplicate := true;
  elsif v_order.status not in ('pending', 'paid') then
    raise exception 'alipay_order_not_pending';
  else
    perform pg_advisory_xact_lock(hashtextextended(v_order.phone, 0));

    select u.*
    into v_user
    from public.users u
    where u.phone = v_order.phone
    for update;

    if not found then
      insert into public.users (phone, role, plan, premium_until, lifetime_access)
      values (v_order.phone, 'free', 'free', null, false)
      on conflict (phone) do nothing;

      select u.*
      into v_user
      from public.users u
      where u.phone = v_order.phone
      for update;
    end if;

    if v_order.plan_id = 'lifetime' then
      update public.users u
      set role = 'premium',
          plan = 'lifetime',
          lifetime_access = true,
          premium_activated_at = p_paid_at
      where u.phone = v_order.phone
      returning * into v_user;
    elsif coalesce(v_user.lifetime_access, false) = false
      and coalesce(v_user.role, '') <> 'developer'
      and coalesce(v_user.plan, '') <> 'developer'
    then
      update public.users u
      set role = 'premium',
          plan = 'monthly',
          premium_until = greatest(coalesce(u.premium_until, p_paid_at), p_paid_at) + interval '30 days',
          premium_activated_at = p_paid_at
      where u.phone = v_order.phone
      returning * into v_user;
    end if;

    update public.orders o
    set status = 'paid',
        paid_at = p_paid_at,
        alipay_trade_no = p_alipay_trade_no,
        provider_trade_no = p_alipay_trade_no,
        membership_granted_at = p_paid_at,
        notify_summary = coalesce(p_notify_summary, '{}'::jsonb)
    where o.out_trade_no = p_out_trade_no
    returning * into v_order;

    v_processed := true;
  end if;

  select u.*
  into v_user
  from public.users u
  where u.phone = v_order.phone;

  return query select
    v_processed,
    v_duplicate,
    v_order.phone,
    v_order.plan_id,
    v_user.premium_until,
    coalesce(v_user.lifetime_access, false);
end;
$$;

revoke all on function public.create_or_reuse_alipay_order(text, text, text, text, text, integer, text, text)
  from public, anon, authenticated;
revoke all on function public.finalize_alipay_payment(text, text, timestamptz, jsonb)
  from public, anon, authenticated;

grant execute on function public.create_or_reuse_alipay_order(text, text, text, text, text, integer, text, text)
  to service_role;
grant execute on function public.finalize_alipay_payment(text, text, timestamptz, jsonb)
  to service_role;

commit;
