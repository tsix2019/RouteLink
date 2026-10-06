/*
 * Speed limits (design §9.1, plan P4 §0.2) as `tc -force -batch -` scripts, one LAN bridge port at a time.
 * Download: the port's egress gets an HTB root (handle 1:, unlimited default class 1:1), one class per
 * rule and a flower filter on the destination MAC. Upload: a clsact qdisc whose ingress polices by source
 * MAC. Pure text generation; sys/shaper runs tc and checks the result.
 */
#ifndef RL_TCGEN_H
#define RL_TCGEN_H

#include <stddef.h>
#include <stdint.h>

#define RL_TC_HANDLE "1:"
/* Classes 1:10 … */
#define RL_TC_FIRST_CLASS 10

typedef struct {
	uint8_t mac[6];
	uint32_t down_kbps; /* 0 = not limited */
	uint32_t up_kbps;
} rl_tc_rule;

/*
 * Replaces whatever RouteLink set up on dev with these rules; with no limiting rule only the removal is
 * written. Returns the script length, or (size_t)-1 when it does not fit.
 */
size_t rl_tc_script(char *out, size_t size, const char *dev, const rl_tc_rule *rules, size_t n);

/* Police burst in bytes for a rate: 20 ms worth, at least 16 KB. */
uint32_t rl_tc_burst(uint32_t kbps);

#endif
