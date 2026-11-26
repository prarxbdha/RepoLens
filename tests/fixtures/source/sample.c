#include <stdio.h>
#include "helpers.h"

#define MAX_ITEMS 10

struct Item {
    int id;
    const char *name;
};

enum State { STATE_IDLE, STATE_BUSY };

typedef struct Item Item;

static int internal_count = 0;

/* Adds two integers. */
int add(int left, int right) {
    if (left > right) {
        return left + right;
    }
    return right + left;
}

static void reset(void) {
    internal_count = 0;
}
