/* /etc/config/routelink. */
#ifndef RL_CONFIG_H
#define RL_CONFIG_H

#include <stdbool.h>
#include <stddef.h>

#include "core/addr.h"
#include "core/store.h"

typedef struct {
	bool enabled;
	bool traffic;
	bool wifi; /* wireless sampling on the AP role */
	char data_dir[200];
	int commit_interval; /* seconds; 0 = automatic */
	int max_size_mb;
	int max_size_percent;
	int sample_interval;
	int live_interval;
	rl_retention ret;
	int signal_minute_days, signal_hour_days;
} rl_config;

/* A `config device` section: flags the app and LuCI keep per MAC. */
typedef struct {
	rl_mac mac;
	bool trusted; /* known device (WF-3) */
	bool watch;   /* report when it comes and goes */
} rl_devflag;

void rl_config_defaults(rl_config *c);
/* Reads UCI over the defaults; values out of range are clamped. */
void rl_config_load(rl_config *c);
/* Every `config device` section with a valid mac (later sections win); *out is malloc'd or NULL. */
size_t rl_config_devices(rl_devflag **out);

/* POSIX TZ string from system.@system[0].timezone (else /etc/TZ, else empty) and its zonename. */
void rl_config_timezone(char *tz, int tz_len, char *zonename, int zone_len);
/* system.ntp.enabled (true when unset). */
bool rl_config_ntp_enabled(void);

#endif
