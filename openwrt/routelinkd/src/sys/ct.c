#define _GNU_SOURCE
#include <arpa/inet.h>
#include <endian.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <syslog.h>
#include <time.h>

#include <libmnl/libmnl.h>
#include <linux/netfilter/nfnetlink.h>
#include <linux/netfilter/nfnetlink_conntrack.h>

#include "sys/ct.h"

#ifndef SOL_NETLINK
#define SOL_NETLINK 270
#endif

struct rl_ct {
	struct mnl_socket *ev, *dump;
	unsigned int dump_portid;
	unsigned int seq;
	rl_ct_cb cb;
	void *ctx;
	uint64_t lost;
	char *buf;
	size_t buf_len;
};

typedef struct {
	const struct nlattr *tb[CTA_MAX + 1];
} ct_attrs;

static int attr_cb(const struct nlattr *attr, void *data)
{
	const struct nlattr **tb = data;
	int type = mnl_attr_get_type(attr);
	if (mnl_attr_type_valid(attr, CTA_MAX) < 0)
		return MNL_CB_OK;
	tb[type] = attr;
	return MNL_CB_OK;
}

static int nested_cb(const struct nlattr *attr, void *data)
{
	/* nested attribute sets are all small: a 16-slot table covers ip, proto and counters */
	const struct nlattr **tb = data;
	int type = mnl_attr_get_type(attr);
	if (type < 16)
		tb[type] = attr;
	return MNL_CB_OK;
}

static void parse_tuple(const struct nlattr *tuple, int family, rl_ip *src, rl_ip *dst, uint16_t *sport, uint16_t *dport,
			uint8_t *proto)
{
	const struct nlattr *t[16] = { 0 }, *ip[16] = { 0 }, *pr[16] = { 0 };
	mnl_attr_parse_nested(tuple, nested_cb, t);
	if (t[CTA_TUPLE_IP]) {
		mnl_attr_parse_nested(t[CTA_TUPLE_IP], nested_cb, ip);
		if (family == AF_INET) {
			if (ip[CTA_IP_V4_SRC])
				rl_ip_from_v4(mnl_attr_get_u32(ip[CTA_IP_V4_SRC]), src);
			if (ip[CTA_IP_V4_DST])
				rl_ip_from_v4(mnl_attr_get_u32(ip[CTA_IP_V4_DST]), dst);
		} else {
			if (ip[CTA_IP_V6_SRC] && mnl_attr_get_payload_len(ip[CTA_IP_V6_SRC]) == 16)
				rl_ip_from_v6(mnl_attr_get_payload(ip[CTA_IP_V6_SRC]), src);
			if (ip[CTA_IP_V6_DST] && mnl_attr_get_payload_len(ip[CTA_IP_V6_DST]) == 16)
				rl_ip_from_v6(mnl_attr_get_payload(ip[CTA_IP_V6_DST]), dst);
		}
	}
	if (t[CTA_TUPLE_PROTO]) {
		mnl_attr_parse_nested(t[CTA_TUPLE_PROTO], nested_cb, pr);
		if (proto && pr[CTA_PROTO_NUM])
			*proto = mnl_attr_get_u8(pr[CTA_PROTO_NUM]);
		if (sport && pr[CTA_PROTO_SRC_PORT])
			*sport = ntohs(mnl_attr_get_u16(pr[CTA_PROTO_SRC_PORT]));
		if (dport && pr[CTA_PROTO_DST_PORT])
			*dport = ntohs(mnl_attr_get_u16(pr[CTA_PROTO_DST_PORT]));
	}
}

static uint64_t be64(const struct nlattr *a)
{
	return be64toh(mnl_attr_get_u64(a));
}

static void parse_counters(const struct nlattr *a, uint64_t *bytes, uint64_t *pkts)
{
	const struct nlattr *c[16] = { 0 };
	mnl_attr_parse_nested(a, nested_cb, c);
	if (c[CTA_COUNTERS_BYTES])
		*bytes = be64(c[CTA_COUNTERS_BYTES]);
	else if (c[CTA_COUNTERS32_BYTES])
		*bytes = ntohl(mnl_attr_get_u32(c[CTA_COUNTERS32_BYTES]));
	if (c[CTA_COUNTERS_PACKETS])
		*pkts = be64(c[CTA_COUNTERS_PACKETS]);
	else if (c[CTA_COUNTERS32_PACKETS])
		*pkts = ntohl(mnl_attr_get_u32(c[CTA_COUNTERS32_PACKETS]));
}

static int msg_cb(const struct nlmsghdr *nlh, void *data)
{
	rl_ct *c = data;
	const struct nlattr *tb[CTA_MAX + 1] = { 0 };
	const struct nfgenmsg *nfg = mnl_nlmsg_get_payload(nlh);
	int type = NFNL_MSG_TYPE(nlh->nlmsg_type);
	rl_ct_sample s = { 0 };

	if (nfg->nfgen_family != AF_INET && nfg->nfgen_family != AF_INET6)
		return MNL_CB_OK;
	mnl_attr_parse(nlh, sizeof(*nfg), attr_cb, tb);
	if (!tb[CTA_TUPLE_ORIG] || !tb[CTA_TUPLE_REPLY])
		return MNL_CB_OK;
	parse_tuple(tb[CTA_TUPLE_ORIG], nfg->nfgen_family, &s.orig_src, &s.orig_dst, &s.orig_sport, &s.orig_dport, &s.l4proto);
	parse_tuple(tb[CTA_TUPLE_REPLY], nfg->nfgen_family, &s.reply_src, &s.reply_dst, NULL, NULL, NULL);
	if (tb[CTA_COUNTERS_ORIG])
		parse_counters(tb[CTA_COUNTERS_ORIG], &s.orig_bytes, &s.orig_pkts);
	if (tb[CTA_COUNTERS_REPLY])
		parse_counters(tb[CTA_COUNTERS_REPLY], &s.reply_bytes, &s.reply_pkts);
	if (tb[CTA_ID])
		s.ct_id = ntohl(mnl_attr_get_u32(tb[CTA_ID]));
	s.tuple_hash = rl_flows_tuple_hash(&s);
	c->cb(&s, type == IPCTNL_MSG_CT_DELETE, c->ctx);
	return MNL_CB_OK;
}

#define ACCT_PATH "/proc/sys/net/netfilter/nf_conntrack_acct"

bool rl_ct_accounting(void)
{
	FILE *f = fopen(ACCT_PATH, "r");
	int v = 0;
	if (!f)
		return false;
	if (fscanf(f, "%d", &v) != 1)
		v = 0;
	fclose(f);
	return v != 0;
}

static void enable_accounting(void)
{
	if (rl_ct_accounting())
		return;
	FILE *f = fopen(ACCT_PATH, "w");
	if (f) {
		fputs("1\n", f);
		fclose(f);
	}
	if (rl_ct_accounting())
		syslog(LOG_NOTICE, "enabled nf_conntrack_acct (it was 0)");
	else
		syslog(LOG_ERR, "nf_conntrack_acct is 0 and cannot be enabled: device traffic will read 0");
}

rl_ct *rl_ct_open(rl_ct_cb cb, void *ctx)
{
	rl_ct *c = calloc(1, sizeof(*c));
	if (!c)
		abort();
	c->cb = cb;
	c->ctx = ctx;
	c->buf_len = MNL_SOCKET_BUFFER_SIZE * 4;
	c->buf = malloc(c->buf_len);
	if (!c->buf)
		abort();
	enable_accounting();

	c->dump = mnl_socket_open(NETLINK_NETFILTER);
	c->ev = mnl_socket_open2(NETLINK_NETFILTER, SOCK_NONBLOCK | SOCK_CLOEXEC);
	if (!c->dump || !c->ev || mnl_socket_bind(c->dump, 0, MNL_SOCKET_AUTOPID) < 0 ||
	    mnl_socket_bind(c->ev, 0, MNL_SOCKET_AUTOPID) < 0) {
		syslog(LOG_ERR, "conntrack netlink unavailable: %s (is kmod-nf-conntrack-netlink loaded?)", strerror(errno));
		rl_ct_close(c);
		return NULL;
	}
	int group = NFNLGRP_CONNTRACK_DESTROY;
	if (mnl_socket_setsockopt(c->ev, NETLINK_ADD_MEMBERSHIP, &group, sizeof(group)) < 0) {
		syslog(LOG_ERR, "cannot subscribe to conntrack events: %s", strerror(errno));
		rl_ct_close(c);
		return NULL;
	}
	int rcvbuf = 4 << 20;
	if (setsockopt(mnl_socket_get_fd(c->ev), SOL_SOCKET, SO_RCVBUFFORCE, &rcvbuf, sizeof(rcvbuf)) < 0)
		setsockopt(mnl_socket_get_fd(c->ev), SOL_SOCKET, SO_RCVBUF, &rcvbuf, sizeof(rcvbuf));
	c->dump_portid = mnl_socket_get_portid(c->dump);
	c->seq = (unsigned int)time(NULL);
	return c;
}

void rl_ct_close(rl_ct *c)
{
	if (!c)
		return;
	if (c->dump)
		mnl_socket_close(c->dump);
	if (c->ev)
		mnl_socket_close(c->ev);
	free(c->buf);
	free(c);
}

int rl_ct_event_fd(const rl_ct *c)
{
	return mnl_socket_get_fd(c->ev);
}

bool rl_ct_on_readable(rl_ct *c)
{
	bool lost = false;
	for (;;) {
		ssize_t n = mnl_socket_recvfrom(c->ev, c->buf, c->buf_len);
		if (n < 0) {
			if (errno == ENOBUFS) {
				c->lost++;
				lost = true;
				continue;
			}
			break; /* EAGAIN */
		}
		mnl_cb_run(c->buf, (size_t)n, 0, 0, msg_cb, c);
	}
	return lost;
}

int rl_ct_dump(rl_ct *c)
{
	struct nlmsghdr *nlh = mnl_nlmsg_put_header(c->buf);
	nlh->nlmsg_type = (NFNL_SUBSYS_CTNETLINK << 8) | IPCTNL_MSG_CT_GET; /* never IPCTNL_MSG_CT_GET_CTRZERO */
	nlh->nlmsg_flags = NLM_F_REQUEST | NLM_F_DUMP;
	nlh->nlmsg_seq = ++c->seq;
	struct nfgenmsg *nfg = mnl_nlmsg_put_extra_header(nlh, sizeof(*nfg));
	nfg->nfgen_family = AF_UNSPEC;
	nfg->version = NFNETLINK_V0;
	nfg->res_id = 0;
	if (mnl_socket_sendto(c->dump, nlh, nlh->nlmsg_len) < 0)
		return -1;

	int count = 0, ret;
	for (;;) {
		ssize_t n = mnl_socket_recvfrom(c->dump, c->buf, c->buf_len);
		if (n <= 0)
			return -1;
		/* count entries by walking the messages of this batch */
		const struct nlmsghdr *h = (const struct nlmsghdr *)c->buf;
		int len = (int)n;
		while (mnl_nlmsg_ok(h, len)) {
			if (h->nlmsg_type != NLMSG_DONE && h->nlmsg_type != NLMSG_ERROR)
				count++;
			h = mnl_nlmsg_next(h, &len);
		}
		ret = mnl_cb_run(c->buf, (size_t)n, c->seq, c->dump_portid, msg_cb, c);
		if (ret <= MNL_CB_STOP)
			break;
	}
	return ret < 0 ? -1 : count;
}

uint64_t rl_ct_events_lost(const rl_ct *c)
{
	return c->lost;
}
