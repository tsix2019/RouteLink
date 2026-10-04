/* LAN/WAN view from netifd (network.interface dump) and firewall zones. */
#ifndef RL_NETINFO_H
#define RL_NETINFO_H

#include <net/if.h>
#include <stdbool.h>

#include <libubus.h>

#include "core/classify.h"

#define RL_MAX_WAN_DEVS 8
#define RL_MAX_LAN_IFS 32

typedef struct {
	rl_netview nv;
	char wan_devs[RL_MAX_WAN_DEVS][IFNAMSIZ];
	int n_wan;
	int lan_ifindex[RL_MAX_LAN_IFS];
	int n_lan;
	bool has_wan; /* a masqueraded zone has an interface: this router is a gateway */
} rl_netinfo;

/* Rebuilds ni; returns 0 on success (ni is left untouched on failure). */
int rl_netinfo_refresh(struct ubus_context *ctx, rl_netinfo *ni);
void rl_netinfo_free(rl_netinfo *ni);
/* Sum of rx/tx byte counters of the WAN devices. */
bool rl_netinfo_wan_bytes(const rl_netinfo *ni, uint64_t *rx, uint64_t *tx);

#endif
