use shop_fulfil::orders::Order;
use shop_util::strings::{pad_left, pad_right};

pub const WIDTH: usize = 32;

pub fn render(order: &Order) -> String {
    let mut rows = vec![format!("INVOICE {}", order.id)];
    for line in order.cart.lines.values() {
        let label = format!("{} x {}", line.qty, line.product.name);
        rows.push(pad_right(&label, 20) + &pad_left(&line.total().format(), 12));
    }
    let q = &order.quote;
    let total = q.total();
    let summary = [
        ("Subtotal", &q.subtotal),
        ("Discount", &q.discount),
        ("Shipping", &q.shipping),
        ("Fees", &q.fees),
        ("Tax", &q.tax),
        ("Total", &total),
    ];
    for (label, amount) in summary {
        rows.push(pad_right(label, 20) + &pad_left(&amount.format(), 12));
    }
    rows.push(shop_config::get_str("invoice_footer", ""));
    rows.join("\n")
}
