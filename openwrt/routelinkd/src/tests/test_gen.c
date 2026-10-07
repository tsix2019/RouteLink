#include "t.h"

#include "core/nftgen.h"
#include "core/tcgen.h"

static void test_tc_script(void)
{
	char out[4096];
	rl_tc_rule r[3] = {
		{ { 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0x01 }, 8000, 2000 },
		{ { 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0x02 }, 0, 500 },
		{ { 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0x03 }, 1000, 0 },
	};
	size_t len = rl_tc_script(out, sizeof(out), "phy0-ap0", r, 3);
	T_ASSERT(len != (size_t)-1);
	T_EQ_STR(out, "qdisc add dev phy0-ap0 root handle 1: htb default 1\n"
		      "class add dev phy0-ap0 parent 1: classid 1:1 htb rate 10gbit quantum 1514\n"
		      "class add dev phy0-ap0 parent 1: classid 1:10 htb rate 8000kbit ceil 8000kbit quantum 1514\n"
		      "filter add dev phy0-ap0 parent 1: protocol all prio 1 flower dst_mac aa:bb:cc:dd:ee:01 classid 1:10\n"
		      "class add dev phy0-ap0 parent 1: classid 1:12 htb rate 1000kbit ceil 1000kbit quantum 1514\n"
		      "filter add dev phy0-ap0 parent 1: protocol all prio 1 flower dst_mac aa:bb:cc:dd:ee:03 classid 1:12\n"
		      "qdisc add dev phy0-ap0 clsact\n"
		      "filter add dev phy0-ap0 ingress protocol all prio 1 flower src_mac aa:bb:cc:dd:ee:01 action police "
		      "rate 2000kbit burst 131072 mtu 65536 conform-exceed drop\n"
		      "filter add dev phy0-ap0 ingress protocol all prio 1 flower src_mac aa:bb:cc:dd:ee:02 action police "
		      "rate 500kbit burst 131072 mtu 65536 conform-exceed drop\n");
	T_EQ_U64(len, strlen(out));

	/* Nothing to limit: nothing to set up, the clear script does the rest. */
	T_EQ_U64(rl_tc_script(out, sizeof(out), "lan1", NULL, 0), 0);
	T_EQ_STR(out, "");
	rl_tc_clear_script(out, sizeof(out), "lan1");
	T_EQ_STR(out, "qdisc del dev lan1 root handle 1: htb\nqdisc del dev lan1 clsact\n");
	T_EQ_U64(rl_tc_script(out, 40, "lan1", r, 3), (size_t)-1);
	T_EQ_U64(rl_tc_burst(1000000), 12500000); /* 1 Gbit/s: 100 ms */
	T_EQ_U64(rl_tc_burst(20000), 250000);
	T_EQ_U64(rl_tc_burst(8000), RL_TC_BURST_MIN);
}

static void test_nft_script(void)
{
	char out[2048];
	uint8_t block[2][6] = { { 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0x01 }, { 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0x02 } };
	rl_nft_net local[3] = {
		{ 4, { 192, 168, 1, 0 }, 24 },
		{ 4, { 10, 8, 0, 0 }, 24 },
		{ 6, { 0xfd, 0x00, 0, 0, 0, 0, 0, 0 }, 48 },
	};
	size_t len = rl_nft_script(out, sizeof(out), (const uint8_t(*)[6])block, 2, local, 3);
	T_ASSERT(len != (size_t)-1);
	T_EQ_STR(out, "add table inet routelink\n"
		      "delete table inet routelink\n"
		      "table inet routelink {\n"
		      "\tset block {\n\t\ttype ether_addr\n\t\telements = { aa:bb:cc:dd:ee:01, aa:bb:cc:dd:ee:02 }\n\t}\n"
		      "\tset local4 {\n\t\ttype ipv4_addr\n\t\tflags interval\n\t\telements = { 192.168.1.0/24, 10.8.0.0/24 }\n\t}\n"
		      "\tset local6 {\n\t\ttype ipv6_addr\n\t\tflags interval\n\t\telements = { fd00::/48 }\n\t}\n"
		      "\tchain forward {\n\t\ttype filter hook forward priority filter - 1; policy accept;\n"
		      "\t\tether saddr @block ip daddr != @local4 counter drop\n"
		      "\t\tether saddr @block ip6 daddr != @local6 counter drop\n\t}\n}\n");

	/* No blocked device: the table goes away. Empty IPv6 set without elements is still valid. */
	rl_nft_script(out, sizeof(out), NULL, 0, local, 3);
	T_EQ_STR(out, "add table inet routelink\ndelete table inet routelink\n");
	rl_nft_script(out, sizeof(out), (const uint8_t(*)[6])block, 1, local, 2);
	T_ASSERT(strstr(out, "set local6 {\n\t\ttype ipv6_addr\n\t\tflags interval\n\t}") != NULL);
	T_EQ_U64(rl_nft_script(out, 64, (const uint8_t(*)[6])block, 2, local, 3), (size_t)-1);
}

int main(void)
{
	T_RUN(test_tc_script);
	T_RUN(test_nft_script);
	T_DONE();
}
