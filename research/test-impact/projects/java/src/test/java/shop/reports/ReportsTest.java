package shop.reports;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static shop.testkit.Factories.cartOf;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import shop.fulfil.Order;
import shop.fulfil.OrderService;
import shop.testkit.Factories;

class ReportsTest {
    private static List<Order> orders() {
        OrderService svc = new OrderService(Factories.stocked());
        List<Order> out = Factories.fixtureOrders().stream()
                .map(o -> svc.place(cartOf(o.lines()), o.coupon()))
                .toList();
        svc.cancel(out.get(1));
        return out;
    }

    @Test
    void topSkus() {
        assertEquals(List.of(Map.entry("SKU-003", 4), Map.entry("SKU-005", 3), Map.entry("SKU-001", 2)),
                SalesReport.topSkus(orders()));
    }

    @Test
    void revenueSkipsCancelled() {
        assertTrue(SalesReport.revenue(orders()).cents() > 0);
    }
}
