#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <uci.h>

#include "sys/config.h"

void rl_config_defaults(rl_config *c)
{
	memset(c, 0, sizeof(*c));
	c->enabled = true;
	c->traffic = true;
	snprintf(c->data_dir, sizeof(c->data_dir), "/etc/routelink");
	c->commit_interval = 0;
	c->max_size_mb = 32;
	c->max_size_percent = 10;
	c->sample_interval = 30;
	c->live_interval = 2;
	c->ret = (rl_retention){ .minute_hours = 48, .hour_days = 90, .day_days = 730, .event_days = 90 };
}

static int clamp(int v, int lo, int hi)
{
	return v < lo ? lo : v > hi ? hi : v;
}

static int get_int(struct uci_context *ctx, struct uci_section *s, const char *name, int def)
{
	const char *v = s ? uci_lookup_option_string(ctx, s, name) : NULL;
	if (!v || !*v)
		return def;
	char *end;
	long n = strtol(v, &end, 10);
	return *end ? def : (int)n;
}

static bool get_bool(struct uci_context *ctx, struct uci_section *s, const char *name, bool def)
{
	const char *v = s ? uci_lookup_option_string(ctx, s, name) : NULL;
	if (!v)
		return def;
	return !strcmp(v, "1") || !strcmp(v, "on") || !strcmp(v, "true") || !strcmp(v, "yes") || !strcmp(v, "enabled");
}

void rl_config_load(rl_config *c)
{
	struct uci_context *ctx = uci_alloc_context();
	struct uci_package *pkg = NULL;
	if (!ctx)
		return;
	if (uci_load(ctx, "routelink", &pkg) == UCI_OK && pkg) {
		struct uci_section *m = uci_lookup_section(ctx, pkg, "main");
		struct uci_section *r = uci_lookup_section(ctx, pkg, "retention");
		c->enabled = get_bool(ctx, m, "enabled", c->enabled);
		c->traffic = get_bool(ctx, m, "traffic", c->traffic);
		const char *dir = m ? uci_lookup_option_string(ctx, m, "data_dir") : NULL;
		if (dir && dir[0] == '/') {
			snprintf(c->data_dir, sizeof(c->data_dir), "%s", dir);
			size_t len = strlen(c->data_dir);
			while (len > 1 && c->data_dir[len - 1] == '/')
				c->data_dir[--len] = '\0';
		}
		c->commit_interval = clamp(get_int(ctx, m, "commit_interval", c->commit_interval), 0, 86400);
		if (c->commit_interval && c->commit_interval < 60)
			c->commit_interval = 60;
		c->max_size_mb = clamp(get_int(ctx, m, "max_size_mb", c->max_size_mb), 1, 4096);
		c->max_size_percent = clamp(get_int(ctx, m, "max_size_percent", c->max_size_percent), 1, 90);
		c->sample_interval = clamp(get_int(ctx, m, "sample_interval", c->sample_interval), 5, 300);
		c->live_interval = clamp(get_int(ctx, m, "live_interval", c->live_interval), 1, 10);
		/* restart recovery rebuilds a tier from the next finer one: keep enough of each */
		c->ret.minute_hours = clamp(get_int(ctx, r, "minute_hours", c->ret.minute_hours), 2, 24 * 14);
		c->ret.hour_days = clamp(get_int(ctx, r, "hour_days", c->ret.hour_days), 2, 3660);
		c->ret.day_days = clamp(get_int(ctx, r, "day_days", c->ret.day_days), 62, 36600);
		c->ret.event_days = clamp(get_int(ctx, r, "event_days", c->ret.event_days), 1, 3660);
	}
	uci_free_context(ctx);
}

void rl_config_timezone(char *tz, int tz_len, char *zonename, int zone_len)
{
	tz[0] = zonename[0] = '\0';
	/* UCI first: after a time zone change this reload may run before /etc/init.d/system rewrites /etc/TZ */
	struct uci_context *ctx = uci_alloc_context();
	struct uci_package *pkg = NULL;
	if (ctx && uci_load(ctx, "system", &pkg) == UCI_OK && pkg) {
		struct uci_element *e;
		uci_foreach_element(&pkg->sections, e) {
			struct uci_section *s = uci_to_section(e);
			if (strcmp(s->type, "system"))
				continue;
			const char *z = uci_lookup_option_string(ctx, s, "zonename");
			const char *t = uci_lookup_option_string(ctx, s, "timezone");
			if (z)
				snprintf(zonename, zone_len, "%s", z);
			if (t)
				snprintf(tz, tz_len, "%s", t);
			break;
		}
	}
	if (ctx)
		uci_free_context(ctx);
	if (tz[0])
		return;
	FILE *f = fopen("/etc/TZ", "r");
	if (f) {
		if (fgets(tz, tz_len, f))
			tz[strcspn(tz, "\r\n")] = '\0';
		fclose(f);
	}
}

bool rl_config_ntp_enabled(void)
{
	bool enabled = true;
	struct uci_context *ctx = uci_alloc_context();
	struct uci_package *pkg = NULL;
	if (!ctx)
		return true;
	if (uci_load(ctx, "system", &pkg) == UCI_OK && pkg) {
		struct uci_section *s = uci_lookup_section(ctx, pkg, "ntp");
		const char *v = s ? uci_lookup_option_string(ctx, s, "enabled") : NULL;
		if (v && !strcmp(v, "0"))
			enabled = false;
	}
	uci_free_context(ctx);
	return enabled;
}
