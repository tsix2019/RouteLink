#include <stdio.h>

#include "core/version.h"

int main(void)
{
	printf("routelinkd %s\n", rl_version());
	return 0;
}
