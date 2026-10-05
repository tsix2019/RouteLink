/* Small shared helpers for the core modules (no system dependencies). */
#ifndef RL_UTIL_H
#define RL_UTIL_H

#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>

#define RL_ARRAY_SIZE(a) (sizeof(a) / sizeof((a)[0]))
#define RL_MIN(a, b) ((a) < (b) ? (a) : (b))
#define RL_MAX(a, b) ((a) > (b) ? (a) : (b))

/* 32-bit finaliser (murmur3 fmix32): good spread for open addressing. */
static inline uint32_t rl_mix32(uint32_t h)
{
	h ^= h >> 16;
	h *= 0x85ebca6bu;
	h ^= h >> 13;
	h *= 0xc2b2ae35u;
	h ^= h >> 16;
	return h;
}

static inline uint32_t rl_fnv1a(const void *data, size_t len, uint32_t h)
{
	const uint8_t *p = data;
	for (size_t i = 0; i < len; i++) {
		h ^= p[i];
		h *= 16777619u;
	}
	return h;
}

#define RL_FNV_SEED 2166136261u

/* Grows *items so that it can hold need elements; aborts on OOM (the daemon cannot recover anyway). */
static inline void *rl_grow(void *items, size_t *cap, size_t need, size_t size)
{
	if (need <= *cap)
		return items;
	size_t n = *cap ? *cap : 16;
	while (n < need)
		n *= 2;
	void *p = realloc(items, n * size);
	if (!p)
		abort();
	*cap = n;
	return p;
}

#endif
