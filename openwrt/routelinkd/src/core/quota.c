#include "core/quota.h"

#include <string.h>
#include <time.h>

int rl_quota_period_parse(const char *s)
{
	if (!s)
		return -1;
	if (strcmp(s, "day") == 0)
		return RL_QUOTA_DAY;
	if (strcmp(s, "week") == 0)
		return RL_QUOTA_WEEK;
	if (strcmp(s, "month") == 0)
		return RL_QUOTA_MONTH;
	return -1;
}

const char *rl_quota_state_name(rl_quota_state s)
{
	static const char *names[] = { "ok", "warned", "exceeded", "allowed" };
	return names[s];
}

/* Local midnight of the calendar day year/mon/mday (normalised, so day 0 or 32 is fine). */
static int64_t midnight(int year, int mon, int mday)
{
	struct tm tm = { .tm_year = year, .tm_mon = mon, .tm_mday = mday, .tm_isdst = -1 };
	return (int64_t)mktime(&tm);
}

void rl_quota_bounds(rl_quota_period p, int reset_day, int64_t now, int64_t *start, int64_t *end)
{
	time_t t = (time_t)now;
	struct tm tm;
	localtime_r(&t, &tm);
	switch (p) {
	case RL_QUOTA_DAY:
		*start = midnight(tm.tm_year, tm.tm_mon, tm.tm_mday);
		*end = midnight(tm.tm_year, tm.tm_mon, tm.tm_mday + 1);
		break;
	case RL_QUOTA_WEEK: {
		int first = reset_day >= 1 && reset_day <= 7 ? reset_day : 1;
		int weekday = tm.tm_wday == 0 ? 7 : tm.tm_wday;
		int back = (weekday - first + 7) % 7;
		*start = midnight(tm.tm_year, tm.tm_mon, tm.tm_mday - back);
		*end = midnight(tm.tm_year, tm.tm_mon, tm.tm_mday - back + 7);
		break;
	}
	default: {
		int day = reset_day >= 1 && reset_day <= 28 ? reset_day : 1;
		int mon = tm.tm_mday >= day ? tm.tm_mon : tm.tm_mon - 1;
		*start = midnight(tm.tm_year, mon, day);
		*end = midnight(tm.tm_year, mon + 1, day);
		break;
	}
	}
}

unsigned rl_quota_step(rl_quota_run *r, int64_t now, int64_t period_start, uint64_t used, uint64_t limit)
{
	unsigned act = 0;
	if (r->period_start != period_start) {
		if (r->period_start)
			act |= RL_QA_RESET;
		if (r->enforced)
			act |= RL_QA_RELEASE;
		r->period_start = period_start;
		r->warned = r->enforced = false;
		r->allow_until = 0;
	}
	if (r->allow_until > now) {
		r->state = RL_QS_ALLOWED;
		if (r->enforced) {
			r->enforced = false;
			act |= RL_QA_RELEASE;
		}
		return act;
	}
	r->allow_until = 0;
	if (limit && used >= limit) {
		r->state = RL_QS_EXCEEDED;
		if (!r->enforced) {
			r->enforced = true;
			r->warned = true;
			act |= RL_QA_ENFORCE;
		}
	} else if (limit && used >= limit - limit / 5) { /* 80 % */
		r->state = RL_QS_WARNED;
		if (!r->warned) {
			r->warned = true;
			act |= RL_QA_WARN;
		}
	} else {
		r->state = RL_QS_OK;
	}
	return act;
}

unsigned rl_quota_allow(rl_quota_run *r, int64_t until)
{
	r->allow_until = until;
	r->state = RL_QS_ALLOWED;
	if (!r->enforced)
		return 0;
	r->enforced = false;
	return RL_QA_RELEASE;
}
