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
#include "core/store.h"
#include "sys/config.h"
#include "sys/ct.h"
#include "sys/neigh.h"
#include "sys/netinfo.h"
#include "sys/role.h"

#define RL_API_VERSION 1
#define RL_LIVE_LEASE 30   /* seconds a `live` call keeps fast sampling on */
#define RL_EVENTS_CAP 100000
#define RL_STARTUP_GRACE 180 /* no online/offline events right after start */

typedef enum { RL_RESET_TRAFFIC = 1, RL_RESET_EVENTS = 2, RL_RESET_DEVICES = 4 } rl_reset_scope;

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

	struct ubus_auto_conn ubus;
	struct ubus_context *ubus_ctx; /* NULL while disconnected */

	struct uloop_timeout sample_timer, names_timer, commit_timer;
	struct uloop_fd ct_fd, neigh_fd;

	int64_t started, last_sample, last_commit, last_compact_day, live_until;
	bool net_ready, synced, baseline_next, commit_failing;
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
/* Writes pending data when the clock is trusted (always when force and synced). Returns 0 on success. */
int rl_daemon_commit(rl_daemon *d);
void rl_daemon_reset(rl_daemon *d, unsigned scope);
void rl_daemon_time_synced(rl_daemon *d);
int64_t rl_daemon_now(void);

#endif
