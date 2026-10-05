#define _GNU_SOURCE
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/statfs.h>
#include <sys/statvfs.h>
#include <sys/sysinfo.h>
#include <syslog.h>
#include <time.h>
#include <unistd.h>

#include "core/classify.h"
#include "core/recover.h"
#include "core/util.h"
#include "core/version.h"
#include "sys/api.h"
#include "sys/daemon.h"

#ifndef RL_BUILD_EPOCH
#define RL_BUILD_EPOCH 0
#endif

#define JFFS2_MAGIC 0x72b6
#define UBIFS_MAGIC 0x24051905
#define OVERLAYFS_MAGIC 0x794c7630

/* ---- flow tags: which devices a connection belongs to, cached per flow ----
 * bits 0-15 dev0, 16-17 cls0, 18 orig0 | 20-35 dev1, 36-37 cls1, 38 orig1 | 40-41 n | 62 valid
 */
#define TAG_VALID (1ULL << 62)

static uint64_t tag_pack(int n, const uint16_t dev[2], const rl_class cls[2], const bool orig[2])
{
	uint64_t t = TAG_VALID | (uint64_t)n << 40;
	for (int i = 0; i < n; i++)
		t |= ((uint64_t)dev[i] | (uint64_t)cls[i] << 16 | (uint64_t)orig[i] << 18) << (20 * i);
	return t;
}

static int tag_n(uint64_t t)
{
	return (int)(t >> 40 & 3);
}

static uint16_t tag_dev(uint64_t t, int i)
{
	return (uint16_t)(t >> (20 * i));
}

static rl_class tag_cls(uint64_t t, int i)
{
	return (rl_class)(t >> (20 * i + 16) & 3);
}

static bool tag_orig(uint64_t t, int i)
{
	return t >> (20 * i + 18) & 1;
}

int64_t rl_daemon_now(void)
{
	return (int64_t)time(NULL);
}

static int64_t now_ms(void)
{
	struct timespec ts;
	clock_gettime(CLOCK_REALTIME, &ts);
	return (int64_t)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}

static long uptime(void)
{
	struct sysinfo si;
	return sysinfo(&si) == 0 ? si.uptime : 0;
}

static void event(rl_daemon *d, rl_event_type type, uint16_t dev, int64_t a)
{
	rl_event ev = { .ts = rl_daemon_now(), .type = (uint16_t)type, .dev = dev, .a = a };
	rl_events_add(d->events, &ev);
}

bool rl_daemon_traffic_on(const rl_daemon *d)
{
	return d->cfg.traffic && d->role.gateway && d->ct;
}

/* ---- attribution ---- */

static uint16_t resolve(rl_daemon *d, const rl_ip *ip, int64_t now, bool *pending)
{
	rl_mac mac;
	bool created;
	if (!rl_neigh_lookup(d->neigh, ip, &mac)) {
		*pending = true;
		return RL_DEV_UNKNOWN;
	}
	rl_device *dev = rl_devtab_get(d->devs, &mac, now, &created);
	if (!dev) {
		*pending = true;
		return RL_DEV_UNKNOWN;
	}
	if (created) {
		char s[RL_MAC_STRLEN];
		rl_mac_format(&mac, s);
		syslog(LOG_INFO, "new device %s", s);
		event(d, RL_EV_DEVICE_NEW, dev->idx, 0);
	}
	return dev->idx;
}

/* Returns the tag for a sample; *cacheable is false while some address is still unresolved. */
static uint64_t attribute(rl_daemon *d, const rl_ct_sample *s, int64_t now, bool *cacheable)
{
	rl_attribution a = rl_classify(&d->net.nv, s);
	uint16_t dev[2] = { 0, 0 };
	rl_class cls[2] = { 0, 0 };
	bool orig[2] = { false, false }, pending = false;
	for (int i = 0; i < a.n; i++) {
		dev[i] = a.a[i].router ? RL_DEV_ROUTER : resolve(d, &a.a[i].client, now, &pending);
		cls[i] = a.a[i].cls;
		orig[i] = a.a[i].client_is_orig;
	}
	*cacheable = a.n > 0 && !pending;
	return tag_pack(a.n, dev, cls, orig);
}

static void apply(rl_daemon *d, uint64_t tag, rl_delta delta, int64_t now)
{
	if (!delta.orig_bytes && !delta.reply_bytes)
		return;
	for (int i = 0; i < tag_n(tag); i++) {
		uint64_t rx, tx;
		uint16_t dev = tag_dev(tag, i);
		rl_client_bytes(tag_orig(tag, i), delta, &rx, &tx);
		rl_agg_add(d->agg, now, dev, tag_cls(tag, i), rx, tx);
		rl_device *dv = dev <= RL_DEV_MAX ? rl_devtab_by_idx(d->devs, dev) : NULL;
		if (dv)
			rl_devtab_touch(dv, now);
	}
}

static void on_ct(const rl_ct_sample *s, bool destroyed, void *ctx)
{
	rl_daemon *d = ctx;
	int64_t now = rl_daemon_now();
	uint64_t tag;
	rl_delta delta;
	bool cacheable;

	if (destroyed) {
		delta = rl_flows_destroy(d->flows, s, &tag);
		if (!(tag & TAG_VALID))
			tag = attribute(d, s, now, &cacheable);
	} else {
		uint64_t *slot;
		delta = rl_flows_update(d->flows, s, &slot);
		if (!(*slot & TAG_VALID)) {
			tag = attribute(d, s, now, &cacheable);
			if (cacheable)
				*slot = tag;
		} else {
			tag = *slot;
		}
	}
	apply(d, tag, delta, now);
}

static void count_conn(uint64_t tag, void *ctx)
{
	rl_daemon *d = ctx;
	if (!(tag & TAG_VALID))
		return;
	for (int i = 0; i < tag_n(tag); i++)
		if (tag_cls(tag, i) == RL_CLASS_INTERNET)
			d->conn_count[tag_dev(tag, i)]++;
}

/* ---- presence ---- */

static void on_presence(rl_device *dev, bool online, void *ctx)
{
	rl_daemon *d = ctx;
	if (rl_daemon_now() - d->started < RL_STARTUP_GRACE)
		return;
	event(d, online ? RL_EV_DEVICE_ONLINE : RL_EV_DEVICE_OFFLINE, dev->idx, 0);
}

static void on_reachable(const rl_mac *mac, int64_t now, void *ctx)
{
	rl_daemon *d = ctx;
	bool created;
	rl_device *dev = rl_devtab_get(d->devs, mac, now, &created);
	if (!dev)
		return;
	if (created)
		event(d, RL_EV_DEVICE_NEW, dev->idx, 0);
	rl_devtab_touch(dev, now);
}

/* ---- sampling ---- */

static void schedule_sample(rl_daemon *d)
{
	int secs = rl_daemon_now() < d->live_until ? d->cfg.live_interval : d->cfg.sample_interval;
	uloop_timeout_set(&d->sample_timer, secs * 1000);
}

static void handle_time_jump(rl_daemon *d, int64_t now)
{
	int64_t jump = now - d->last_sample;
	syslog(LOG_NOTICE, "clock jumped by %lld s", (long long)jump);
	if (!d->synced) {
		/* everything recorded so far carries the wrong time: drop it, the clock is set now */
		rl_agg_reset(d->agg);
		rl_store_discard_pending(d->store);
		rl_recover(d->store, d->agg, now);
		d->synced = true;
	}
	event(d, RL_EV_TIME_JUMP, RL_EV_NO_DEV, jump);
}

void rl_daemon_sample(rl_daemon *d)
{
	int64_t now = rl_daemon_now();
	if (!rl_daemon_traffic_on(d) || !d->net_ready)
		return;
	if (d->last_sample && (now < d->last_sample - 60 || now > d->last_sample + 3600))
		handle_time_jump(d, now);

	rl_flows_begin(d->flows, d->baseline_next);
	d->baseline_next = false;
	if (rl_ct_dump(d->ct) < 0)
		syslog(LOG_WARNING, "conntrack dump failed: %s", strerror(errno));
	rl_flows_sweep(d->flows);

	memset(d->conn_count, 0, 65536 * sizeof(uint32_t));
	rl_flows_each(d->flows, count_conn, d);
	for (size_t i = 0; i < rl_devtab_count(d->devs); i++)
		if (d->conn_count[i])
			rl_agg_conns(d->agg, now, (uint16_t)i, d->conn_count[i]);

	uint64_t rx, tx;
	if (rl_netinfo_wan_bytes(&d->net, &rx, &tx)) {
		uint64_t drx = 0, dtx = 0;
		if (d->wan_valid) {
			drx = rx >= d->wan_rx ? rx - d->wan_rx : rx; /* interface re-created (PPPoE redial) */
			dtx = tx >= d->wan_tx ? tx - d->wan_tx : tx;
		}
		d->wan_rx = rx;
		d->wan_tx = tx;
		d->wan_valid = true;
		rl_agg_add(d->agg, now, RL_DEV_WAN, RL_CLASS_INTERNET, drx, dtx);
	} else {
		d->wan_valid = false;
		rl_agg_add(d->agg, now, RL_DEV_WAN, RL_CLASS_INTERNET, 0, 0); /* still recording */
	}
	rl_agg_tick(d->agg, now);
	rl_agg_sample_done(d->agg, now_ms());
	rl_devtab_presence(d->devs, now, on_presence, d);
	d->last_sample = now;
}

static void sample_timer_cb(struct uloop_timeout *t)
{
	rl_daemon *d = container_of(t, rl_daemon, sample_timer);
	rl_daemon_sample(d);
	schedule_sample(d);
}

void rl_daemon_live(rl_daemon *d)
{
	int64_t now = rl_daemon_now();
	bool was_live = now < d->live_until;
	d->live_until = now + RL_LIVE_LEASE;
	if (!was_live) {
		rl_daemon_sample(d);
		schedule_sample(d);
	}
}

/* ---- ct / neighbour sockets ---- */

static void ct_fd_cb(struct uloop_fd *fd, unsigned int events)
{
	rl_daemon *d = container_of(fd, rl_daemon, ct_fd);
	if (rl_ct_on_readable(d->ct)) {
		syslog(LOG_WARNING, "conntrack events lost, resyncing");
		rl_daemon_sample(d);
	}
}

static void neigh_fd_cb(struct uloop_fd *fd, unsigned int events)
{
	rl_daemon *d = container_of(fd, rl_daemon, neigh_fd);
	rl_neigh_on_readable(d->neigh);
}

static void open_traffic(rl_daemon *d)
{
	if (d->ct || !d->cfg.traffic || !d->role.gateway)
		return;
	d->ct = rl_ct_open(on_ct, d);
	if (!d->ct)
		return;
	d->ct_fd.fd = rl_ct_event_fd(d->ct);
	d->ct_fd.cb = ct_fd_cb;
	uloop_fd_add(&d->ct_fd, ULOOP_READ);
	d->baseline_next = true;
	syslog(LOG_INFO, "traffic accounting started");
}

static void close_traffic(rl_daemon *d)
{
	if (!d->ct)
		return;
	uloop_fd_delete(&d->ct_fd);
	rl_ct_close(d->ct);
	d->ct = NULL;
	d->wan_valid = false;
}

/* ---- periodic refresh: interfaces, role, names, clock ---- */

static void check_synced(rl_daemon *d)
{
	if (d->synced)
		return;
	int64_t now = rl_daemon_now();
	if (!rl_config_ntp_enabled() || (uptime() > 900 && now > RL_BUILD_EPOCH)) {
		d->synced = true;
		syslog(LOG_INFO, "clock considered set");
	}
}

static void names_timer_cb(struct uloop_timeout *t)
{
	rl_daemon *d = container_of(t, rl_daemon, names_timer);
	if (d->ubus_ctx && rl_netinfo_refresh(d->ubus_ctx, &d->net) == 0) {
		bool first = !d->net_ready;
		d->net_ready = true;
		rl_role_detect(d->ubus_ctx, &d->net, &d->role);
		rl_neigh_set_lan_ifindexes(d->neigh, d->net.lan_ifindex, d->net.n_lan);
		if (first)
			rl_neigh_dump(d->neigh);
		if (d->cfg.traffic && d->role.gateway)
			open_traffic(d);
		else
			close_traffic(d);
		if (first) {
			rl_daemon_sample(d);
			schedule_sample(d);
		}
	}
	rl_names_refresh(d->neigh, d->devs, rl_daemon_now());
	check_synced(d);
	uloop_timeout_set(t, d->net_ready ? 60000 : 2000);
}

/* ---- persistence ---- */

static bool on_flash(const char *dir)
{
	struct statfs fs;
	if (statfs(dir, &fs) != 0)
		return true;
	if ((unsigned long)fs.f_type == OVERLAYFS_MAGIC && statfs("/overlay", &fs) != 0)
		return true;
	return (unsigned long)fs.f_type == JFFS2_MAGIC || (unsigned long)fs.f_type == UBIFS_MAGIC;
}

static void compute_limits(rl_daemon *d)
{
	struct statvfs vfs;
	uint64_t max = (uint64_t)d->cfg.max_size_mb << 20;
	if (statvfs(d->cfg.data_dir, &vfs) == 0) {
		uint64_t avail = (uint64_t)vfs.f_bavail * vfs.f_frsize + rl_store_bytes(d->store);
		uint64_t pct = avail / 100 * (uint64_t)d->cfg.max_size_percent;
		if (pct < max)
			max = pct;
	}
	if (max < (1u << 20))
		max = 1u << 20;
	d->max_bytes = max;
	d->commit_interval = d->cfg.commit_interval ? d->cfg.commit_interval : on_flash(d->cfg.data_dir) ? 3600 : 600;
}

int rl_daemon_commit(rl_daemon *d, bool flush_minute)
{
	check_synced(d);
	if (!d->synced)
		return -1;
	int64_t now = rl_daemon_now();
	int rc = 0;
	if (flush_minute)
		rl_agg_flush(d->agg, RL_TIER_MINUTE); /* the partial minute; rl_recover adds it back after a restart */
	if (rl_store_commit(d->store) != 0)
		rc = -1;
	if (rl_devtab_save(d->devs, d->devtab_path) != 0)
		rc = -1;
	int64_t day = rl_bucket_start(RL_TIER_DAY, now);
	if (day != d->last_compact_day) {
		rl_store_compact(d->store, now, &d->cfg.ret, d->max_bytes);
		rl_events_compact(d->events, now, d->cfg.ret.event_days, RL_EVENTS_CAP);
		d->last_compact_day = day;
	}
	if (rc != 0 && !d->commit_failing) {
		syslog(LOG_ERR, "writing to %s failed: %s", d->cfg.data_dir, strerror(errno));
		event(d, RL_EV_COMMIT_FAILED, RL_EV_NO_DEV, 0);
	}
	d->commit_failing = rc != 0;
	if (rl_events_commit(d->events) != 0)
		rc = -1;
	if (rc == 0)
		d->last_commit = now;
	return rc;
}

static void commit_timer_cb(struct uloop_timeout *t)
{
	rl_daemon *d = container_of(t, rl_daemon, commit_timer);
	rl_daemon_commit(d, false);
	uloop_timeout_set(t, d->commit_interval * 1000);
}

static void on_close(rl_tier tier, const rl_rec *r, void *ctx)
{
	rl_daemon *d = ctx;
	rl_store_append(d->store, tier, r);
}

void rl_daemon_reset(rl_daemon *d, unsigned scope)
{
	if (scope & RL_RESET_DEVICES)
		scope |= RL_RESET_TRAFFIC | RL_RESET_EVENTS; /* indexes would be reused */
	if (scope & RL_RESET_TRAFFIC) {
		rl_store_reset(d->store);
		rl_agg_reset(d->agg);
		d->baseline_next = true;
		d->wan_valid = false;
	}
	if (scope & RL_RESET_EVENTS)
		rl_events_reset(d->events);
	if (scope & RL_RESET_DEVICES) {
		rl_devtab_clear(d->devs);
		rl_devtab_save(d->devs, d->devtab_path);
		rl_flows_free(d->flows);
		d->flows = rl_flows_new();
	}
	syslog(LOG_NOTICE, "data reset (scope %u)", scope);
}

void rl_daemon_time_synced(rl_daemon *d)
{
	if (!d->synced)
		syslog(LOG_INFO, "clock synchronised by ntpd");
	d->synced = true;
}

/* ---- setup ---- */

static int mkdirs(const char *path)
{
	char buf[256];
	snprintf(buf, sizeof(buf), "%s", path);
	for (char *p = buf + 1; *p; p++) {
		if (*p != '/')
			continue;
		*p = '\0';
		if (mkdir(buf, 0755) != 0 && errno != EEXIST)
			return -1;
		*p = '/';
	}
	return mkdir(buf, 0755) != 0 && errno != EEXIST ? -1 : 0;
}

/* sysupgrade keeps the data directory (it may have been moved to USB or a disk). */
static void write_keep_list(const char *dir)
{
	char want[260], have[260] = "";
	snprintf(want, sizeof(want), "%s/\n", dir);
	FILE *f = fopen("/lib/upgrade/keep.d/routelink", "r");
	if (f) {
		if (!fgets(have, sizeof(have), f))
			have[0] = '\0';
		fclose(f);
	}
	if (!strcmp(want, have))
		return;
	f = fopen("/lib/upgrade/keep.d/routelink", "w");
	if (f) {
		fputs(want, f);
		fclose(f);
	}
}

static int open_data(rl_daemon *d)
{
	char path[256];
	if (mkdirs(d->cfg.data_dir) != 0) {
		syslog(LOG_ERR, "cannot create %s: %s", d->cfg.data_dir, strerror(errno));
		return -1;
	}
	write_keep_list(d->cfg.data_dir);
	d->store = rl_store_open(d->cfg.data_dir);
	snprintf(path, sizeof(path), "%s/events.bin", d->cfg.data_dir);
	d->events = rl_events_open(path);
	if (!d->store || !d->events) {
		syslog(LOG_ERR, "cannot open data files in %s", d->cfg.data_dir);
		return -1;
	}
	snprintf(d->devtab_path, sizeof(d->devtab_path), "%s/devices.json", d->cfg.data_dir);
	bool damaged = rl_devtab_load(d->devs, d->devtab_path) != 0;
	if (damaged || rl_store_recovered(d->store)) {
		syslog(LOG_WARNING, "damaged data files were replaced");
		event(d, RL_EV_DATA_RECOVERED, RL_EV_NO_DEV, 0);
	}
	compute_limits(d);
	return 0;
}

static void close_data(rl_daemon *d)
{
	rl_store_close(d->store);
	rl_events_close(d->events);
	d->store = NULL;
	d->events = NULL;
}

static void on_ubus_connect(struct ubus_context *ctx)
{
	rl_daemon *d = container_of(ctx, rl_daemon, ubus.ctx);
	d->ubus_ctx = ctx;
	rl_api_register(ctx);
	uloop_timeout_set(&d->names_timer, 0);
}

static void apply_timezone(rl_daemon *d)
{
	rl_config_timezone(d->tz, sizeof(d->tz), d->zonename, sizeof(d->zonename));
	rl_tz_apply(d->tz);
}

int rl_daemon_init(rl_daemon *d)
{
	memset(d, 0, sizeof(*d));
	d->started = rl_daemon_now();
	rl_config_defaults(&d->cfg);
	rl_config_load(&d->cfg);
	apply_timezone(d);

	d->devs = rl_devtab_new();
	d->flows = rl_flows_new();
	d->agg = rl_agg_new(on_close, d);
	d->conn_count = calloc(65536, sizeof(uint32_t));
	if (!d->conn_count)
		abort();
	if (open_data(d) != 0)
		return -1;
	int caught_up = rl_recover(d->store, d->agg, d->started);
	if (caught_up)
		syslog(LOG_INFO, "rebuilt %d hour/day/month records after downtime", caught_up);
	d->last_compact_day = rl_bucket_start(RL_TIER_DAY, d->started);
	d->synced = !rl_config_ntp_enabled() || (uptime() > 900 && d->started > RL_BUILD_EPOCH);
	event(d, RL_EV_DAEMON_START, RL_EV_NO_DEV, 0);

	d->neigh = rl_neigh_open(on_reachable, d);
	if (!d->neigh) {
		syslog(LOG_ERR, "rtnetlink unavailable: %s", strerror(errno));
		return -1;
	}
	d->neigh_fd.fd = rl_neigh_fd(d->neigh);
	d->neigh_fd.cb = neigh_fd_cb;
	uloop_fd_add(&d->neigh_fd, ULOOP_READ);

	d->sample_timer.cb = sample_timer_cb;
	d->names_timer.cb = names_timer_cb;
	d->commit_timer.cb = commit_timer_cb;
	uloop_timeout_set(&d->commit_timer, d->commit_interval * 1000);

	rl_api_init(d);
	d->ubus.cb = on_ubus_connect;
	ubus_auto_connect(&d->ubus);
	syslog(LOG_INFO, "routelinkd %s started, data in %s, commit every %d s", rl_version(), d->cfg.data_dir,
	       d->commit_interval);
	return 0;
}

void rl_daemon_reload(rl_daemon *d)
{
	rl_config old = d->cfg;
	rl_config_defaults(&d->cfg);
	rl_config_load(&d->cfg);
	apply_timezone(d);
	if (strcmp(old.data_dir, d->cfg.data_dir) != 0) {
		/* data is not migrated: close the old directory after a final write */
		rl_config moved = d->cfg;
		d->cfg = old;
		rl_daemon_commit(d, true);
		d->cfg = moved;
		close_data(d);
		rl_devtab_clear(d->devs);
		rl_flows_free(d->flows);
		d->flows = rl_flows_new();
		rl_agg_reset(d->agg);
		if (open_data(d) != 0) {
			syslog(LOG_ERR, "keeping the old data directory %s", old.data_dir);
			snprintf(d->cfg.data_dir, sizeof(d->cfg.data_dir), "%s", old.data_dir);
			open_data(d);
		}
		rl_recover(d->store, d->agg, rl_daemon_now());
		d->baseline_next = true;
	}
	compute_limits(d);
	if (!d->cfg.traffic)
		close_traffic(d);
	uloop_timeout_set(&d->names_timer, 0);
	uloop_timeout_set(&d->commit_timer, d->commit_interval * 1000);
	schedule_sample(d);
	syslog(LOG_INFO, "configuration reloaded");
}

void rl_daemon_shutdown(rl_daemon *d)
{
	rl_daemon_commit(d, true);
	close_traffic(d);
	if (d->neigh) {
		uloop_fd_delete(&d->neigh_fd);
		rl_neigh_close(d->neigh);
	}
	close_data(d);
	rl_netinfo_free(&d->net);
	rl_devtab_free(d->devs);
	rl_flows_free(d->flows);
	rl_agg_free(d->agg);
	free(d->conn_count);
	syslog(LOG_INFO, "stopped");
}
