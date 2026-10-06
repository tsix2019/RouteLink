/* State of the running daemon and the operations the event loop and the ubus API share. */
#ifndef RL_DAEMON_H
#define RL_DAEMON_H

#include <stdbool.h>
#include <stdint.h>

#include <libubox/uloop.h>
#include <libubus.h>

#include "core/agg.h"
#include "core/devtab.h"
#include "core/events.h"
#include "core/flows.h"
#include "core/series.h"
#include "core/store.h"
#include "core/wifi.h"
#include "sys/config.h"
#include "sys/ct.h"
#include "sys/neigh.h"
#include "sys/netinfo.h"
#include "sys/nl80211.h"
#include "sys/role.h"

#define RL_API_VERSION 1
#define RL_LIVE_LEASE 30   /* seconds a `live` call keeps fast sampling on */
#define RL_EVENTS_CAP 100000
#define RL_STARTUP_GRACE 180 /* no online/offline events right after start */
#define RL_WIFI_INTERVAL 10      /* station sampling */
#define RL_WIFI_LIVE_INTERVAL 1  /* station sampling while a `stations` live lease runs */
#define RL_SURVEY_INTERVAL 60    /* channel busy time */
#define RL_RUN_DIR "/var/run/routelink" /* markers for the LuCI menu (ap, ap-only) */

typedef enum {
	RL_RESET_TRAFFIC = 1,
	RL_RESET_EVENTS = 2,
	RL_RESET_DEVICES = 4,
	RL_RESET_SIGNAL = 8,
} rl_reset_scope;

typedef struct rl_daemon {
	rl_config cfg;
	char tz[64], zonename[64];

	rl_store *store;
	rl_agg *agg;
	rl_devtab *devs;
	rl_events *events;
	rl_flows *flows;
	rl_netinfo net;
	rl_role role;
	rl_ct *ct;
	rl_neigh *neigh;

	/* wireless (AP role) */
	rl_wifi *wifi;
	rl_nl80211 *nl;              /* NULL without nl80211 (retried every minute) */
	rl_series *sig_minute, *sig_hour; /* opened when the module first runs */
	rl_nl_iface ifaces[RL_NL_MAX_IFACES]; /* AP interfaces of the latest station sample */
	int n_ifaces;
	rl_devflag *devflags; /* config device sections */
	size_t n_devflags;

	struct ubus_auto_conn ubus;
	struct ubus_context *ubus_ctx; /* NULL while disconnected */

	struct uloop_timeout sample_timer, names_timer, commit_timer, wifi_timer, survey_timer;
	struct uloop_fd ct_fd, neigh_fd, nl_fd;

	int64_t started, last_sample, last_commit, last_compact_day, live_until, wifi_live_until, last_clock;
	bool net_ready, synced, baseline_next, commit_failing, wifi_on, nl_missing_logged;
	uint64_t wan_rx, wan_tx;
	bool wan_valid;
	uint64_t max_bytes;
	int commit_interval;
	uint32_t *conn_count; /* per device index, reused by every sample */
	char devtab_path[256];
} rl_daemon;

int rl_daemon_init(rl_daemon *d);
void rl_daemon_shutdown(rl_daemon *d);
/* SIGHUP: config, time zone and retention. */
void rl_daemon_reload(rl_daemon *d);

bool rl_daemon_traffic_on(const rl_daemon *d);
void rl_daemon_sample(rl_daemon *d);
/* Starts or extends the live lease; samples immediately when it was not running. */
void rl_daemon_live(rl_daemon *d);
/* Wireless sampling runs (AP role, module on). */
bool rl_daemon_wifi_on(const rl_daemon *d);
/* Starts or extends the stations live lease (1 s sampling); samples right away when it was not running. */
void rl_daemon_wifi_live(rl_daemon *d);
/* Current station sampling interval in seconds. */
int rl_daemon_wifi_interval(const rl_daemon *d);
/* Bytes of every data file (traffic and signal). */
uint64_t rl_daemon_storage(const rl_daemon *d);
/* The config device section of a MAC, or NULL. */
const rl_devflag *rl_daemon_devflag(const rl_daemon *d, const rl_mac *mac);
/* Writes pending data when the clock is trusted; flush_minute also writes the unfinished minute (before a
 * shutdown or a firmware backup). Returns 0 on success. */
int rl_daemon_commit(rl_daemon *d, bool flush_minute);
void rl_daemon_reset(rl_daemon *d, unsigned scope);
void rl_daemon_time_synced(rl_daemon *d);
int64_t rl_daemon_now(void);

#endif
