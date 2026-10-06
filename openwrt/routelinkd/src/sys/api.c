#include <stdlib.h>
#include <string.h>

#include <libubox/blobmsg.h>

#include "core/query.h"
#include "core/version.h"
#include "sys/api.h"
#include "sys/daemon.h"

#define MAX_DEVICES_OUT 500
#define MAX_EVENTS_OUT 1000
#define MAX_IPS 8

static const char *const CAPABILITIES[] = { "traffic", "wifi" };

static struct rl_daemon *D;
static struct blob_buf b;

void rl_api_init(struct rl_daemon *d)
{
	D = d;
}

/* ---- helpers ---- */

static void add_mac(const char *name, uint16_t dev)
{
	char s[RL_MAC_STRLEN];
	rl_device *d;
	if (dev == RL_DEV_UNKNOWN) {
		blobmsg_add_string(&b, name, "unknown");
	} else if (dev == RL_DEV_ROUTER) {
		blobmsg_add_string(&b, name, "router");
	} else if ((d = rl_devtab_by_idx(D->devs, dev))) {
		rl_mac_format(&d->mac, s);
		blobmsg_add_string(&b, name, s);
	} else {
		blobmsg_add_string(&b, name, "unknown");
	}
}

/* "AA:..", "unknown" or "router" -> device; -1 when the MAC was never seen, -2 when malformed */
static int parse_device(const char *s)
{
	rl_mac mac;
	rl_device *d;
	if (!strcmp(s, "unknown"))
		return RL_DEV_UNKNOWN;
	if (!strcmp(s, "router"))
		return RL_DEV_ROUTER;
	if (!rl_mac_parse(s, &mac))
		return -2;
	d = rl_devtab_find(D->devs, &mac);
	return d ? d->idx : -1;
}

static int parse_class(struct blob_attr *a, bool allow_wan, int *cls, bool *wan)
{
	*wan = false;
	*cls = RL_CLASS_INTERNET;
	if (!a)
		return 0;
	const char *s = blobmsg_get_string(a);
	if (!strcmp(s, "internet"))
		*cls = RL_CLASS_INTERNET;
	else if (!strcmp(s, "lan"))
		*cls = RL_CLASS_LAN;
	else if (!strcmp(s, "router"))
		*cls = RL_CLASS_ROUTER;
	else if (!strcmp(s, "all"))
		*cls = RL_CLS_ANY;
	else if (allow_wan && !strcmp(s, "wan"))
		*wan = true;
	else
		return -1;
	return 0;
}

static int64_t get_i64(struct blob_attr *a, int64_t def)
{
	return a ? (int64_t)blobmsg_cast_u64(a) : def;
}

static rl_qctx query_ctx(void)
{
	return (rl_qctx){ .store = D->store, .agg = D->agg, .ret = &D->cfg.ret, .now = rl_daemon_now() };
}

static const rl_rate *rate_of(uint16_t dev)
{
	const rl_rate *r;
	size_t n = rl_agg_rates(D->agg, &r);
	for (size_t i = 0; i < n; i++)
		if (r[i].dev == dev)
			return &r[i];
	return NULL;
}

/* ---- info ---- */

static int m_info(struct ubus_context *ctx, struct ubus_object *obj, struct ubus_request_data *req, const char *method,
		  struct blob_attr *msg)
{
	void *c;
	blob_buf_init(&b, 0);
	blobmsg_add_string(&b, "version", rl_version());
	blobmsg_add_u32(&b, "api", RL_API_VERSION);
	c = blobmsg_open_array(&b, "roles");
	if (D->role.gateway)
		blobmsg_add_string(&b, NULL, "gateway");
	if (D->role.ap)
		blobmsg_add_string(&b, NULL, "ap");
	blobmsg_close_array(&b, c);
	c = blobmsg_open_array(&b, "modules");
	if (rl_daemon_traffic_on(D))
		blobmsg_add_string(&b, NULL, "traffic");
	if (rl_daemon_wifi_on(D))
		blobmsg_add_string(&b, NULL, "wifi");
	blobmsg_close_array(&b, c);
	/* every module this build has, switched on or not (modules only lists the running ones) */
	c = blobmsg_open_array(&b, "capabilities");
	for (size_t i = 0; i < ARRAY_SIZE(CAPABILITIES); i++)
		blobmsg_add_string(&b, NULL, CAPABILITIES[i]);
	blobmsg_close_array(&b, c);
	blobmsg_add_string(&b, "offload", rl_offload_name(D->role.offload));
	blobmsg_add_u8(&b, "offload_warning", rl_offload_warning(D->role.offload));
	blobmsg_add_u8(&b, "nlbwmon_running", D->role.nlbwmon_running);
	blobmsg_add_u8(&b, "conntrack_accounting", rl_ct_accounting());
	blobmsg_add_u8(&b, "time_synced", D->synced);
	blobmsg_add_string(&b, "zonename", D->zonename);
	blobmsg_add_string(&b, "data_dir", D->cfg.data_dir);
	blobmsg_add_u64(&b, "storage_used", rl_daemon_storage(D));
	blobmsg_add_u64(&b, "storage_limit", D->max_bytes);
	blobmsg_add_u32(&b, "commit_interval", (uint32_t)D->commit_interval);
	blobmsg_add_u64(&b, "last_commit", (uint64_t)D->last_commit);
	blobmsg_add_u32(&b, "sample_interval", (uint32_t)D->cfg.sample_interval);
	blobmsg_add_u32(&b, "live_interval", (uint32_t)D->cfg.live_interval);
	blobmsg_add_u64(&b, "live_until", (uint64_t)D->live_until);
	blobmsg_add_u64(&b, "started", (uint64_t)D->started);
	blobmsg_add_u64(&b, "events_lost", D->ct ? rl_ct_events_lost(D->ct) : 0);
	c = blobmsg_open_table(&b, "retention");
	blobmsg_add_u32(&b, "minute_hours", (uint32_t)D->cfg.ret.minute_hours);
	blobmsg_add_u32(&b, "hour_days", (uint32_t)D->cfg.ret.hour_days);
	blobmsg_add_u32(&b, "day_days", (uint32_t)D->cfg.ret.day_days);
	blobmsg_add_u32(&b, "event_days", (uint32_t)D->cfg.ret.event_days);
	blobmsg_add_u32(&b, "signal_minute_days", (uint32_t)D->cfg.signal_minute_days);
	blobmsg_add_u32(&b, "signal_hour_days", (uint32_t)D->cfg.signal_hour_days);
	blobmsg_close_table(&b, c);
	return ubus_send_reply(ctx, req, b.head);
}

/* ---- devices ---- */

typedef struct {
	uint64_t *rx, *tx;
	size_t n;
} today_ctx;

static bool today_cb(const rl_rec *r, void *x)
{
	today_ctx *t = x;
	if (r->dev < t->n && (r->cls == RL_CLASS_INTERNET || r->cls == RL_CLASS_LAN)) {
		t->rx[r->dev] += r->rx;
		t->tx[r->dev] += r->tx;
	}
	return true;
}

static int m_devices(struct ubus_context *ctx, struct ubus_object *obj, struct ubus_request_data *req,
		     const char *method, struct blob_attr *msg)
{
	size_t n = rl_devtab_count(D->devs);
	today_ctx t = { calloc(n + 1, sizeof(uint64_t)), calloc(n + 1, sizeof(uint64_t)), n };
	if (!t.rx || !t.tx)
		abort();
	rl_agg_open(D->agg, RL_TIER_DAY, today_cb, &t); /* the open day bucket is today */

	blob_buf_init(&b, 0);
	void *list = blobmsg_open_array(&b, "devices");
	for (size_t i = 0; i < n && i < MAX_DEVICES_OUT; i++) {
		rl_device *d = rl_devtab_at(D->devs, i);
		rl_ip ips[MAX_IPS];
		char s[RL_IP_STRLEN];
		size_t k = rl_neigh_ips(D->neigh, &d->mac, ips, MAX_IPS);
		const rl_rate *rate = rate_of(d->idx);
		void *e = blobmsg_open_table(&b, NULL);
		add_mac("mac", d->idx);
		blobmsg_add_string(&b, "name", d->name);
		blobmsg_add_string(&b, "hostname", d->hostname);
		for (int family = 4; family <= 6; family += 2) {
			void *a = blobmsg_open_array(&b, family == 4 ? "ipv4" : "ipv6");
			for (size_t j = 0; j < k; j++)
				if (ips[j].family == family) {
					rl_ip_format(&ips[j], s);
					blobmsg_add_string(&b, NULL, s);
				}
			blobmsg_close_array(&b, a);
		}
		blobmsg_add_u64(&b, "first_seen", (uint64_t)d->first_seen);
		blobmsg_add_u64(&b, "last_seen", (uint64_t)d->last_seen);
		const rl_wifi_sta *st = rl_daemon_wifi_on(D) ? rl_wifi_find(D->wifi, &d->mac) : NULL;
		const rl_devflag *flag = rl_daemon_devflag(D, &d->mac);
		/* without traffic accounting (an access point) a station is online while it is associated */
		blobmsg_add_u8(&b, "online", st && !rl_daemon_traffic_on(D) ? st->associated : d->online);
		blobmsg_add_u8(&b, "random_mac", rl_mac_is_random(&d->mac));
		blobmsg_add_u8(&b, "trusted", flag && flag->trusted);
		blobmsg_add_u8(&b, "watch", flag && flag->watch);
		if (st && st->associated) {
			blobmsg_add_string(&b, "ifname", st->ifname);
			if (st->s.has & RL_STA_SIGNAL)
				blobmsg_add_u32(&b, "signal", (uint32_t)(int32_t)st->s.signal);
		}
		blobmsg_add_u64(&b, "today_rx", t.rx[i]);
		blobmsg_add_u64(&b, "today_tx", t.tx[i]);
		blobmsg_add_u64(&b, "rx_rate", rate ? rate->rx_rate : 0);
		blobmsg_add_u64(&b, "tx_rate", rate ? rate->tx_rate : 0);
		blobmsg_close_table(&b, e);
	}
	blobmsg_close_array(&b, list);
	if (n > MAX_DEVICES_OUT)
		blobmsg_add_u8(&b, "truncated", true);
	free(t.rx);
	free(t.tx);
	return ubus_send_reply(ctx, req, b.head);
}

/* ---- live ---- */

static int cmp_rate(const void *x, const void *y)
{
	const rl_rate *a = x, *c = y;
	uint64_t va = a->rx_rate + a->tx_rate, vc = c->rx_rate + c->tx_rate;
	return va < vc ? 1 : va > vc ? -1 : 0;
}

static int m_live(struct ubus_context *ctx, struct ubus_object *obj, struct ubus_request_data *req, const char *method,
		  struct blob_attr *msg)
{
	rl_daemon_live(D);
	const rl_rate *r;
	size_t n = rl_agg_rates(D->agg, &r);
	rl_rate *sorted = malloc((n ? n : 1) * sizeof(rl_rate));
	if (!sorted)
		abort();
	memcpy(sorted, r, n * sizeof(rl_rate));
	qsort(sorted, n, sizeof(rl_rate), cmp_rate);
	const rl_rate *wan = rate_of(RL_DEV_WAN);
	uint32_t online = 0;
	for (size_t i = 0; i < rl_devtab_count(D->devs); i++)
		online += rl_devtab_at(D->devs, i)->online;

	blob_buf_init(&b, 0);
	blobmsg_add_u64(&b, "ts", (uint64_t)rl_daemon_now());
	blobmsg_add_u64(&b, "lease_until", (uint64_t)D->live_until);
	blobmsg_add_u32(&b, "interval", (uint32_t)D->cfg.live_interval);
	void *w = blobmsg_open_table(&b, "wan");
	blobmsg_add_u64(&b, "rx_rate", wan ? wan->rx_rate : 0);
	blobmsg_add_u64(&b, "tx_rate", wan ? wan->tx_rate : 0);
	blobmsg_close_table(&b, w);
	blobmsg_add_u32(&b, "online", online);
	void *list = blobmsg_open_array(&b, "devices");
	for (size_t i = 0, k = 0; i < n && k < MAX_DEVICES_OUT; i++) {
		if (sorted[i].dev == RL_DEV_WAN || sorted[i].dev == RL_DEV_ROUTER)
			continue;
		void *e = blobmsg_open_table(&b, NULL);
		add_mac("mac", sorted[i].dev);
		blobmsg_add_u64(&b, "rx_rate", sorted[i].rx_rate);
		blobmsg_add_u64(&b, "tx_rate", sorted[i].tx_rate);
		blobmsg_close_table(&b, e);
		k++;
	}
	blobmsg_close_array(&b, list);
	free(sorted);
	return ubus_send_reply(ctx, req, b.head);
}

/* ---- history ---- */

enum { H_MAC, H_START, H_END, H_CLASS, H_HOURS, H_POINTS, __H_MAX };
static const struct blobmsg_policy history_policy[__H_MAX] = {
	[H_MAC] = { "mac", BLOBMSG_TYPE_STRING },     [H_START] = { "start", BLOBMSG_CAST_INT64 },
	[H_END] = { "end", BLOBMSG_CAST_INT64 },      [H_CLASS] = { "class", BLOBMSG_TYPE_STRING },
	[H_HOURS] = { "hours", BLOBMSG_CAST_INT64 },  [H_POINTS] = { "max_points", BLOBMSG_CAST_INT64 },
};

static int m_history(struct ubus_context *ctx, struct ubus_object *obj, struct ubus_request_data *req,
		     const char *method, struct blob_attr *msg)
{
	struct blob_attr *tb[__H_MAX];
	blobmsg_parse(history_policy, __H_MAX, tb, blob_data(msg), blob_len(msg));
	if (!tb[H_START] || !tb[H_END])
		return UBUS_STATUS_INVALID_ARGUMENT;
	rl_history_q q = {
		.start = get_i64(tb[H_START], 0),
		.end = get_i64(tb[H_END], 0),
		.dev = RL_DEV_ALL,
		.hours_mask = (uint32_t)get_i64(tb[H_HOURS], 0),
		.max_points = (int)get_i64(tb[H_POINTS], 0),
	};
	bool wan;
	if (parse_class(tb[H_CLASS], true, &q.cls, &wan) != 0)
		return UBUS_STATUS_INVALID_ARGUMENT;
	if (wan)
		q.dev = RL_DEV_WAN;
	else if (q.cls == RL_CLASS_ROUTER)
		q.dev = RL_DEV_ROUTER;
	else if (tb[H_MAC]) {
		int dev = parse_device(blobmsg_get_string(tb[H_MAC]));
		if (dev == -2)
			return UBUS_STATUS_INVALID_ARGUMENT;
		if (dev == -1)
			return UBUS_STATUS_NOT_FOUND;
		q.dev = dev;
	}
	rl_qctx c = query_ctx();
	rl_history h;
	if (rl_query_history(&c, &q, &h) != 0)
		return UBUS_STATUS_INVALID_ARGUMENT;

	blob_buf_init(&b, 0);
	blobmsg_add_u64(&b, "start", (uint64_t)q.start);
	blobmsg_add_u64(&b, "end", (uint64_t)q.end);
	blobmsg_add_u64(&b, "step", (uint64_t)h.step);
	blobmsg_add_string(&b, "tier", rl_tier_name(h.tier));
	void *list = blobmsg_open_array(&b, "points");
	for (size_t i = 0; i < h.n; i++) {
		void *p = blobmsg_open_array(&b, NULL);
		blobmsg_add_u64(&b, NULL, (uint64_t)h.pts[i].ts);
		if (h.pts[i].gap) {
			blobmsg_add_field(&b, BLOBMSG_TYPE_UNSPEC, NULL, NULL, 0);
			blobmsg_add_field(&b, BLOBMSG_TYPE_UNSPEC, NULL, NULL, 0);
		} else {
			blobmsg_add_u64(&b, NULL, h.pts[i].rx);
			blobmsg_add_u64(&b, NULL, h.pts[i].tx);
		}
		blobmsg_close_array(&b, p);
	}
	blobmsg_close_array(&b, list);
	rl_history_free(&h);
	return ubus_send_reply(ctx, req, b.head);
}

/* ---- summary ---- */

enum { S_START, S_END, S_CLASS, S_HOURS, S_SORT, S_LIMIT, S_OFFSET, __S_MAX };
static const struct blobmsg_policy summary_policy[__S_MAX] = {
	[S_START] = { "start", BLOBMSG_CAST_INT64 }, [S_END] = { "end", BLOBMSG_CAST_INT64 },
	[S_CLASS] = { "class", BLOBMSG_TYPE_STRING }, [S_HOURS] = { "hours", BLOBMSG_CAST_INT64 },
	[S_SORT] = { "sort", BLOBMSG_TYPE_STRING },   [S_LIMIT] = { "limit", BLOBMSG_CAST_INT64 },
	[S_OFFSET] = { "offset", BLOBMSG_CAST_INT64 },
};

static int m_summary(struct ubus_context *ctx, struct ubus_object *obj, struct ubus_request_data *req,
		     const char *method, struct blob_attr *msg)
{
	struct blob_attr *tb[__S_MAX];
	blobmsg_parse(summary_policy, __S_MAX, tb, blob_data(msg), blob_len(msg));
	if (!tb[S_START] || !tb[S_END])
		return UBUS_STATUS_INVALID_ARGUMENT;
	rl_summary_q q = {
		.start = get_i64(tb[S_START], 0),
		.end = get_i64(tb[S_END], 0),
		.hours_mask = (uint32_t)get_i64(tb[S_HOURS], 0),
	};
	bool wan;
	if (parse_class(tb[S_CLASS], false, &q.cls, &wan) != 0)
		return UBUS_STATUS_INVALID_ARGUMENT;
	rl_sort sort = RL_SORT_TOTAL;
	if (tb[S_SORT]) {
		const char *s = blobmsg_get_string(tb[S_SORT]);
		if (!strcmp(s, "rx"))
			sort = RL_SORT_RX;
		else if (!strcmp(s, "tx"))
			sort = RL_SORT_TX;
		else if (strcmp(s, "total"))
			return UBUS_STATUS_INVALID_ARGUMENT;
	}
	int64_t limit = get_i64(tb[S_LIMIT], 50), offset = get_i64(tb[S_OFFSET], 0);
	if (limit < 1 || limit > MAX_DEVICES_OUT || offset < 0)
		return UBUS_STATUS_INVALID_ARGUMENT;

	rl_qctx c = query_ctx();
	rl_summary s;
	if (rl_query_summary(&c, &q, &s) != 0)
		return UBUS_STATUS_INVALID_ARGUMENT;
	rl_summary_sort(&s, sort);

	blob_buf_init(&b, 0);
	blobmsg_add_u64(&b, "start_exact", (uint64_t)s.start_exact);
	blobmsg_add_u64(&b, "end", (uint64_t)q.end);
	blobmsg_add_string(&b, "granularity", rl_tier_name(s.granularity));
	blobmsg_add_u64(&b, "rx", s.rx);
	blobmsg_add_u64(&b, "tx", s.tx);
	blobmsg_add_u64(&b, "wan_rx", s.wan_rx);
	blobmsg_add_u64(&b, "wan_tx", s.wan_tx);
	blobmsg_add_u32(&b, "count", (uint32_t)s.n);
	void *list = blobmsg_open_array(&b, "devices");
	for (size_t i = (size_t)offset; i < s.n && i < (size_t)(offset + limit); i++) {
		void *e = blobmsg_open_table(&b, NULL);
		add_mac("mac", s.devs[i].dev);
		blobmsg_add_u64(&b, "rx", s.devs[i].rx);
		blobmsg_add_u64(&b, "tx", s.devs[i].tx);
		blobmsg_close_table(&b, e);
	}
	blobmsg_close_array(&b, list);
	rl_summary_free(&s);
	return ubus_send_reply(ctx, req, b.head);
}

/* ---- events ---- */

enum { E_START, E_END, E_TYPES, E_MAC, E_LIMIT, E_OFFSET, __E_MAX };
static const struct blobmsg_policy events_policy[__E_MAX] = {
	[E_START] = { "start", BLOBMSG_CAST_INT64 }, [E_END] = { "end", BLOBMSG_CAST_INT64 },
	[E_TYPES] = { "types", BLOBMSG_TYPE_ARRAY }, [E_MAC] = { "mac", BLOBMSG_TYPE_STRING },
	[E_LIMIT] = { "limit", BLOBMSG_CAST_INT64 }, [E_OFFSET] = { "offset", BLOBMSG_CAST_INT64 },
};

static int m_events(struct ubus_context *ctx, struct ubus_object *obj, struct ubus_request_data *req,
		    const char *method, struct blob_attr *msg)
{
	struct blob_attr *tb[__E_MAX], *cur;
	int rem;
	blobmsg_parse(events_policy, __E_MAX, tb, blob_data(msg), blob_len(msg));
	int64_t start = get_i64(tb[E_START], 0), end = get_i64(tb[E_END], rl_daemon_now() + 1);
	int64_t limit = get_i64(tb[E_LIMIT], 200), offset = get_i64(tb[E_OFFSET], 0);
	if (start >= end || limit < 1 || limit > MAX_EVENTS_OUT || offset < 0)
		return UBUS_STATUS_INVALID_ARGUMENT;
	uint32_t mask = 0;
	if (tb[E_TYPES])
		blobmsg_for_each_attr(cur, tb[E_TYPES], rem) {
			if (blobmsg_type(cur) != BLOBMSG_TYPE_STRING)
				return UBUS_STATUS_INVALID_ARGUMENT;
			rl_event_type t = rl_event_parse(blobmsg_get_string(cur));
			if (!t)
				return UBUS_STATUS_INVALID_ARGUMENT;
			mask |= 1u << t;
		}
	int dev = -1;
	if (tb[E_MAC]) {
		dev = parse_device(blobmsg_get_string(tb[E_MAC]));
		if (dev == -2)
			return UBUS_STATUS_INVALID_ARGUMENT;
		if (dev == -1)
			dev = 0x10000; /* never seen: no events */
	}
	rl_event *out = malloc((size_t)limit * sizeof(rl_event));
	size_t n, total;
	if (!out)
		abort();
	rl_events_scan(D->events, start, end, mask, dev, (size_t)offset, (size_t)limit, out, &n, &total);

	blob_buf_init(&b, 0);
	blobmsg_add_u32(&b, "count", (uint32_t)total);
	void *list = blobmsg_open_array(&b, "events");
	for (size_t i = 0; i < n; i++) {
		void *e = blobmsg_open_table(&b, NULL);
		blobmsg_add_u64(&b, "ts", (uint64_t)out[i].ts);
		blobmsg_add_string(&b, "type", rl_event_name((rl_event_type)out[i].type));
		if (out[i].dev != RL_EV_NO_DEV)
			add_mac("mac", out[i].dev);
		if (out[i].a)
			blobmsg_add_u64(&b, "value", (uint64_t)out[i].a);
		blobmsg_close_table(&b, e);
	}
	blobmsg_close_array(&b, list);
	free(out);
	return ubus_send_reply(ctx, req, b.head);
}

/* ---- wireless (AP role) ---- */

/* blobmsg prints INT32 signed: dBm values go out as negative numbers */
static void add_int(const char *name, int v)
{
	blobmsg_add_u32(&b, name, (uint32_t)(int32_t)v);
}

static void add_null(const char *name)
{
	blobmsg_add_field(&b, BLOBMSG_TYPE_UNSPEC, name, NULL, 0);
}

/* The survey entry of the radio behind an interface. */
static const rl_survey_entry *radio_survey(const rl_nl_iface *ifc)
{
	return rl_wifi_survey_radio(D->wifi, ifc->wiphy, ifc->freq);
}

/* AP interfaces in sampling order, the first one of each radio flagged. */
static bool first_of_radio(int i)
{
	for (int j = 0; j < i; j++)
		if (D->ifaces[j].wiphy == D->ifaces[i].wiphy)
			return false;
	return true;
}

enum { ST_LIVE, __ST_MAX };
static const struct blobmsg_policy stations_policy[__ST_MAX] = { [ST_LIVE] = { "live", BLOBMSG_TYPE_BOOL } };

static int m_stations(struct ubus_context *ctx, struct ubus_object *obj, struct ubus_request_data *req,
		      const char *method, struct blob_attr *msg)
{
	struct blob_attr *tb[__ST_MAX];
	char s[RL_MAC_STRLEN];
	blobmsg_parse(stations_policy, __ST_MAX, tb, blob_data(msg), blob_len(msg));
	if (tb[ST_LIVE] && blobmsg_get_bool(tb[ST_LIVE]))
		rl_daemon_wifi_live(D);
	bool on = rl_daemon_wifi_on(D);

	blob_buf_init(&b, 0);
	blobmsg_add_u64(&b, "ts", (uint64_t)rl_daemon_now());
	blobmsg_add_u64(&b, "live_until", (uint64_t)D->wifi_live_until);
	blobmsg_add_u32(&b, "interval", (uint32_t)rl_daemon_wifi_interval(D));
	void *list = blobmsg_open_array(&b, "interfaces");
	for (int i = 0; on && i < D->n_ifaces; i++) {
		const rl_nl_iface *ifc = &D->ifaces[i];
		const rl_survey_entry *sv = radio_survey(ifc);
		if (!ifc->freq)
			continue; /* not operating */
		void *e = blobmsg_open_table(&b, NULL);
		blobmsg_add_string(&b, "ifname", ifc->ifname);
		blobmsg_add_string(&b, "phy", ifc->phy);
		blobmsg_add_string(&b, "ssid", ifc->ssid);
		rl_mac_format(&ifc->bssid, s);
		blobmsg_add_string(&b, "bssid", s);
		blobmsg_add_u32(&b, "freq", ifc->freq);
		blobmsg_add_u32(&b, "channel", (uint32_t)rl_wifi_channel(ifc->freq));
		if (ifc->width)
			blobmsg_add_u32(&b, "width", ifc->width);
		if (sv && (sv->s.has & RL_SV_NOISE))
			add_int("noise", sv->s.noise);
		blobmsg_add_u32(&b, "stations", (uint32_t)rl_wifi_count_on(D->wifi, ifc->ifindex));
		blobmsg_close_table(&b, e);
	}
	blobmsg_close_array(&b, list);

	list = blobmsg_open_array(&b, "stations");
	for (size_t i = 0, k = 0; on && i < rl_wifi_count(D->wifi) && k < MAX_DEVICES_OUT; i++) {
		const rl_wifi_sta *st = rl_wifi_at(D->wifi, i);
		const rl_sta_sample *x = &st->s;
		if (!st->associated)
			continue;
		const rl_survey_entry *sv = NULL;
		for (int j = 0; j < D->n_ifaces && !sv; j++)
			if (D->ifaces[j].ifindex == st->ifindex)
				sv = radio_survey(&D->ifaces[j]);
		void *e = blobmsg_open_table(&b, NULL);
		rl_mac_format(&st->mac, s);
		blobmsg_add_string(&b, "mac", s);
		blobmsg_add_string(&b, "ifname", st->ifname);
		blobmsg_add_u32(&b, "freq", st->freq);
		if (x->has & RL_STA_SIGNAL)
			add_int("signal", x->signal);
		if (x->has & RL_STA_SIGNAL_AVG)
			add_int("signal_avg", x->signal_avg);
		if (sv && (sv->s.has & RL_SV_NOISE))
			add_int("noise", sv->s.noise);
		if (x->has & RL_STA_INACTIVE)
			blobmsg_add_u32(&b, "inactive_ms", x->inactive_ms);
		if (x->has & RL_STA_CONNECTED)
			blobmsg_add_u32(&b, "connected_sec", x->connected_sec);
		if (x->has & RL_STA_RX_RATE)
			blobmsg_add_u32(&b, "rx_rate", x->rx_rate);
		if (x->has & RL_STA_TX_RATE)
			blobmsg_add_u32(&b, "tx_rate", x->tx_rate);
		if (x->has & RL_STA_RX_MCS)
			blobmsg_add_u32(&b, "rx_mcs", x->rx_mcs);
		if (x->has & RL_STA_TX_MCS)
			blobmsg_add_u32(&b, "tx_mcs", x->tx_mcs);
		if (x->has & RL_STA_RX_NSS)
			blobmsg_add_u32(&b, "rx_nss", x->rx_nss);
		if (x->has & RL_STA_TX_NSS)
			blobmsg_add_u32(&b, "tx_nss", x->tx_nss);
		if (x->has & RL_STA_WIDTH)
			blobmsg_add_u32(&b, "width", x->width);
		if (x->has & RL_STA_MODE)
			blobmsg_add_string(&b, "mode", rl_wifi_mode_name(x->mode));
		if (x->has & RL_STA_BYTES) {
			blobmsg_add_u64(&b, "rx_bytes", x->rx_bytes);
			blobmsg_add_u64(&b, "tx_bytes", x->tx_bytes);
		}
		if (x->has & RL_STA_PACKETS) {
			blobmsg_add_u64(&b, "rx_packets", x->rx_packets);
			blobmsg_add_u64(&b, "tx_packets", x->tx_packets);
		}
		if (x->has & RL_STA_RETRIES)
			blobmsg_add_u32(&b, "tx_retries", x->tx_retries);
		if (x->has & RL_STA_FAILED)
			blobmsg_add_u32(&b, "tx_failed", x->tx_failed);
		blobmsg_close_table(&b, e);
		k++;
	}
	blobmsg_close_array(&b, list);
	return ubus_send_reply(ctx, req, b.head);
}

enum { G_MAC, G_START, G_END, G_POINTS, __G_MAX };
static const struct blobmsg_policy signal_policy[__G_MAX] = {
	[G_MAC] = { "mac", BLOBMSG_TYPE_STRING }, [G_START] = { "start", BLOBMSG_CAST_INT64 },
	[G_END] = { "end", BLOBMSG_CAST_INT64 },  [G_POINTS] = { "max_points", BLOBMSG_CAST_INT64 },
};

static int m_signal(struct ubus_context *ctx, struct ubus_object *obj, struct ubus_request_data *req,
		    const char *method, struct blob_attr *msg)
{
	struct blob_attr *tb[__G_MAX];
	rl_mac mac;
	blobmsg_parse(signal_policy, __G_MAX, tb, blob_data(msg), blob_len(msg));
	if (!tb[G_MAC] || !tb[G_START] || !tb[G_END] || !rl_mac_parse(blobmsg_get_string(tb[G_MAC]), &mac))
		return UBUS_STATUS_INVALID_ARGUMENT;
	rl_device *dev = rl_devtab_find(D->devs, &mac);
	if (!dev)
		return UBUS_STATUS_NOT_FOUND;
	int64_t start = get_i64(tb[G_START], 0), end = get_i64(tb[G_END], 0);
	rl_sigq_ctx c = {
		.minute = D->sig_minute,
		.hour = D->sig_hour,
		.wifi = rl_daemon_wifi_on(D) ? D->wifi : NULL,
		.now = rl_daemon_now(),
		.minute_days = D->cfg.signal_minute_days,
		.hour_days = D->cfg.signal_hour_days,
		.live_step = rl_daemon_wifi_interval(D),
	};
	rl_sig_history h;
	if (rl_sig_query(&c, dev->idx, start, end, (int)get_i64(tb[G_POINTS], 0), &h) != 0)
		return UBUS_STATUS_INVALID_ARGUMENT;

	blob_buf_init(&b, 0);
	blobmsg_add_u64(&b, "start", (uint64_t)start);
	blobmsg_add_u64(&b, "end", (uint64_t)end);
	blobmsg_add_u64(&b, "step", (uint64_t)h.step);
	blobmsg_add_string(&b, "tier", rl_sigq_tier_name(h.tier));
	void *list = blobmsg_open_array(&b, "points");
	for (size_t i = 0; i < h.n; i++) {
		const rl_sig_point *p = &h.pts[i];
		void *a = blobmsg_open_array(&b, NULL);
		blobmsg_add_u64(&b, NULL, (uint64_t)p->ts);
		if (p->flags & RL_SIG_F_SIGNAL) {
			add_int(NULL, p->avg_signal);
			add_int(NULL, p->min_signal);
		} else {
			add_null(NULL);
			add_null(NULL);
		}
		if (p->flags & RL_SIG_F_TX_RATE)
			blobmsg_add_u32(&b, NULL, p->avg_tx_rate);
		else
			add_null(NULL);
		if (p->flags & RL_SIG_F_RX_RATE)
			blobmsg_add_u32(&b, NULL, p->avg_rx_rate);
		else
			add_null(NULL);
		if (p->flags & RL_SIG_F_COUNTERS) {
			blobmsg_add_u64(&b, NULL, p->tx_retries);
			blobmsg_add_u64(&b, NULL, p->tx_failed);
		} else {
			add_null(NULL);
			add_null(NULL);
		}
		blobmsg_close_array(&b, a);
	}
	blobmsg_close_array(&b, list);
	rl_sig_history_free(&h);
	return ubus_send_reply(ctx, req, b.head);
}

static void add_busy(int pct)
{
	if (pct >= 0)
		blobmsg_add_u32(&b, "busy_pct", (uint32_t)pct);
	else
		add_null("busy_pct");
}

static int m_survey(struct ubus_context *ctx, struct ubus_object *obj, struct ubus_request_data *req,
		    const char *method, struct blob_attr *msg)
{
	const rl_survey_entry *used[RL_NL_MAX_IFACES];
	int n_used = 0;
	bool on = rl_daemon_wifi_on(D);

	blob_buf_init(&b, 0);
	void *list = blobmsg_open_array(&b, "radios");
	for (int i = 0; on && i < D->n_ifaces; i++) {
		const rl_nl_iface *ifc = &D->ifaces[i];
		if (!first_of_radio(i))
			continue;
		const rl_survey_entry *sv = radio_survey(ifc);
		uint32_t freq = ifc->freq ? ifc->freq : sv ? sv->s.freq : 0;
		if (sv)
			used[n_used++] = sv;
		void *e = blobmsg_open_table(&b, NULL);
		blobmsg_add_string(&b, "ifname", ifc->ifname);
		blobmsg_add_string(&b, "phy", ifc->phy);
		blobmsg_add_u32(&b, "freq", freq);
		blobmsg_add_u32(&b, "channel", (uint32_t)rl_wifi_channel(freq));
		if (sv && (sv->s.has & RL_SV_NOISE))
			add_int("noise", sv->s.noise);
		if (sv && (sv->s.has & RL_SV_ACTIVE))
			blobmsg_add_u64(&b, "active_ms", sv->s.active_ms);
		if (sv && (sv->s.has & RL_SV_BUSY))
			blobmsg_add_u64(&b, "busy_ms", sv->s.busy_ms);
		if (sv && (sv->s.has & RL_SV_RX))
			blobmsg_add_u64(&b, "rx_ms", sv->s.rx_ms);
		if (sv && (sv->s.has & RL_SV_TX))
			blobmsg_add_u64(&b, "tx_ms", sv->s.tx_ms);
		add_busy(sv ? sv->busy_pct : -1);
		blobmsg_add_u64(&b, "updated", sv ? (uint64_t)sv->updated : 0);
		blobmsg_close_table(&b, e);
	}
	blobmsg_close_array(&b, list);

	/* other channels: what the driver kept from scans (busy share since the last sample, else overall) */
	list = blobmsg_open_array(&b, "channels");
	for (size_t i = 0; on && i < rl_wifi_survey_count(D->wifi); i++) {
		const rl_survey_entry *sv = rl_wifi_survey_at(D->wifi, i);
		/* no data at all, or outside the Wi-Fi channel plans (mac80211_hwsim also scans 900 MHz S1G) */
		bool skip = (!(sv->s.has & RL_SV_NOISE) && sv->busy_pct < 0 && sv->busy_pct_total < 0) ||
			    !rl_wifi_channel(sv->s.freq);
		for (int j = 0; j < n_used && !skip; j++)
			skip = used[j] == sv;
		if (skip)
			continue;
		const char *phy = "";
		for (int j = 0; j < D->n_ifaces && !*phy; j++)
			if (D->ifaces[j].wiphy == sv->s.wiphy)
				phy = D->ifaces[j].phy;
		void *e = blobmsg_open_table(&b, NULL);
		blobmsg_add_string(&b, "phy", phy);
		blobmsg_add_u32(&b, "freq", sv->s.freq);
		blobmsg_add_u32(&b, "channel", (uint32_t)rl_wifi_channel(sv->s.freq));
		if (sv->s.has & RL_SV_NOISE)
			add_int("noise", sv->s.noise);
		add_busy(sv->busy_pct >= 0 ? sv->busy_pct : sv->busy_pct_total);
		blobmsg_close_table(&b, e);
	}
	blobmsg_close_array(&b, list);
	return ubus_send_reply(ctx, req, b.head);
}

/* ---- maintenance ---- */

static const struct blobmsg_policy reset_policy[] = { { "scope", BLOBMSG_TYPE_STRING } };

static int m_reset(struct ubus_context *ctx, struct ubus_object *obj, struct ubus_request_data *req, const char *method,
		   struct blob_attr *msg)
{
	struct blob_attr *tb[1];
	blobmsg_parse(reset_policy, 1, tb, blob_data(msg), blob_len(msg));
	if (!tb[0])
		return UBUS_STATUS_INVALID_ARGUMENT;
	const char *s = blobmsg_get_string(tb[0]);
	unsigned scope;
	if (!strcmp(s, "traffic"))
		scope = RL_RESET_TRAFFIC;
	else if (!strcmp(s, "events"))
		scope = RL_RESET_EVENTS;
	else if (!strcmp(s, "signal"))
		scope = RL_RESET_SIGNAL;
	else if (!strcmp(s, "devices"))
		scope = RL_RESET_DEVICES;
	else if (!strcmp(s, "all"))
		scope = RL_RESET_TRAFFIC | RL_RESET_EVENTS | RL_RESET_DEVICES | RL_RESET_SIGNAL;
	else
		return UBUS_STATUS_INVALID_ARGUMENT;
	rl_daemon_reset(D, scope);
	blob_buf_init(&b, 0);
	return ubus_send_reply(ctx, req, b.head);
}

static int m_commit(struct ubus_context *ctx, struct ubus_object *obj, struct ubus_request_data *req, const char *method,
		    struct blob_attr *msg)
{
	int rc = rl_daemon_commit(D, true);
	blob_buf_init(&b, 0);
	blobmsg_add_u8(&b, "ok", rc == 0);
	return ubus_send_reply(ctx, req, b.head);
}

static int m_ntp_synced(struct ubus_context *ctx, struct ubus_object *obj, struct ubus_request_data *req,
			const char *method, struct blob_attr *msg)
{
	rl_daemon_time_synced(D);
	blob_buf_init(&b, 0);
	return ubus_send_reply(ctx, req, b.head);
}

static const struct ubus_method methods[] = {
	UBUS_METHOD_NOARG("info", m_info),
	UBUS_METHOD_NOARG("devices", m_devices),
	UBUS_METHOD_NOARG("live", m_live),
	UBUS_METHOD("history", m_history, history_policy),
	UBUS_METHOD("summary", m_summary, summary_policy),
	UBUS_METHOD("events", m_events, events_policy),
	UBUS_METHOD("stations", m_stations, stations_policy),
	UBUS_METHOD("signal", m_signal, signal_policy),
	UBUS_METHOD_NOARG("survey", m_survey),
	UBUS_METHOD("reset", m_reset, reset_policy),
	UBUS_METHOD_NOARG("commit", m_commit),
	UBUS_METHOD_NOARG("ntp_synced", m_ntp_synced),
};

static struct ubus_object_type type = UBUS_OBJECT_TYPE("routelink", methods);

static struct ubus_object object = {
	.name = "routelink",
	.type = &type,
	.methods = methods,
	.n_methods = ARRAY_SIZE(methods),
};

int rl_api_register(struct ubus_context *ctx)
{
	return ubus_add_object(ctx, &object);
}
