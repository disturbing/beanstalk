use shop_billing::invoice::render;
use shop_catalog::inventory::Inventory;
use shop_fulfil::orders::OrderService;
use shop_testkit::cart_of;

#[test]
fn invoice_lines() {
    let mut inv = Inventory::new(&[("SKU-003", 10)]);
    let order = OrderService::new(&mut inv).place(cart_of(&[("SKU-003", 2)]), None).unwrap();
    let rendered = render(&order);
    let text: Vec<&str> = rendered.lines().collect();
    assert_eq!(text[0], "INVOICE ORD00001");
    assert_eq!(text[1], "2 x Notebook            9.00 USD");
    assert_eq!(text[text.len() - 2], "Total                  16.33 USD");
    assert_eq!(text[text.len() - 1], "Thank you for shopping");
}
