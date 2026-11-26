#include <vector>
#include "widget.h"

namespace ui {

/** A templated widget. */
template <typename T>
class Widget {
public:
    explicit Widget(T value) : value_(value) {}

    virtual ~Widget() = default;

    T render(const std::vector<T>& items) const {
        if (items.empty()) {
            return value_;
        }
        return items.front();
    }

private:
    T value_;
};

struct Point {
    int x;
    int y;
};

enum class Mode { Draft, Published };

int count_points(const std::vector<Point>& points) {
    return static_cast<int>(points.size());
}

}  // namespace ui
