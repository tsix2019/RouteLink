/* /etc/config/routelink. */
#ifndef RL_CONFIG_H
#define RL_CONFIG_H

#include <stdbool.h>

#include "core/store.h"

typedef struct {
	bool enabled;
	bool traffic;
	char data_dir[200];
	int commit_interval; /* seconds; 0 = automatic */
	int max_size_mb;
	int max_size_percent;
	int sample_interval;
	int live_interval;
	rl_retention ret;
} rl_config;

void rl_config_defaults(rl_config *c);
/* Reads UCI over the defaults; values out of range are clamped. */
void rl_config_load(rl_config *c);

/* POSIX TZ string from system.@system[0].timezone (else /etc/TZ, else empty) and its zonename. */
void rl_config_timezone(char *tz, int tz_len, char *zonename, int zone_len);
/* system.ntp.enabled (true when unset). */
bool rl_config_ntp_enabled(void);

#endif
