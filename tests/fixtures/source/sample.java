package example.demo;

import java.util.List;
import java.util.Map.Entry;
import static java.lang.Math.max;

/** Public service. */
public class Service<T extends Comparable<T>> {
    private final String name;

    public Service(String name) {
        this.name = name;
    }

    /** Finds an item. */
    public <R extends T> R find(List<R> items, int index) {
        if (index >= 0) {
            return items.get(max(index, 0));
        }
        return null;
    }

    protected static class Inner {
        void run() {}
    }

    interface Callback {
        void onDone(String value);
    }

    enum State {
        OPEN, CLOSED
    }
}
