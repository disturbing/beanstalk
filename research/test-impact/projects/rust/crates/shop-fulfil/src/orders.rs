use shop_catalog::inventory::Inventory;
use shop_core::ids::Sequence;
use shop_core::{Result, ShopError};
use shop_sales::cart::Cart;
use shop_sales::pricing::{quote, Quote};

use crate::events::Bus;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OrderState {
    New,
    Paid,
    Shipped,
    Delivered,
    Cancelled,
    Refunded,
}

impl OrderState {
    pub fn as_str(self) -> &'static str {
        match self {
            OrderState::New => "new",
            OrderState::Paid => "paid",
            OrderState::Shipped => "shipped",
            OrderState::Delivered => "delivered",
            OrderState::Cancelled => "cancelled",
            OrderState::Refunded => "refunded",
        }
    }

    fn can_go(self, to: OrderState) -> bool {
        use OrderState::*;
        matches!(
            (self, to),
            (New, Paid) | (New, Cancelled) | (Paid, Shipped) | (Paid, Refunded) | (Shipped, Delivered)
        )
    }
}

#[derive(Debug, Clone)]
pub struct Order {
    pub id: String,
    pub cart: Cart,
    pub quote: Quote,
    pub state: OrderState,
    pub history: Vec<OrderState>,
}

impl Order {
    pub fn move_to(&mut self, to: OrderState) -> Result<()> {
        if !self.state.can_go(to) {
            return Err(ShopError::Value(format!("cannot go {} -> {}", self.state.as_str(), to.as_str())));
        }
        self.history.push(self.state);
        self.state = to;
        Ok(())
    }
}

pub struct OrderService<'a> {
    pub inventory: &'a mut Inventory,
    pub bus: Bus,
    seq: Sequence,
}

impl<'a> OrderService<'a> {
    pub fn new(inventory: &'a mut Inventory) -> OrderService<'a> {
        OrderService::with_bus(inventory, Bus::new())
    }

    pub fn with_bus(inventory: &'a mut Inventory, bus: Bus) -> OrderService<'a> {
        OrderService { inventory, bus, seq: Sequence::new("ORD") }
    }

    pub fn place(&mut self, cart: Cart, coupon: Option<&str>) -> Result<Order> {
        for (sku, line) in &cart.lines {
            self.inventory.reserve(sku, line.qty)?;
        }
        let q = quote(&cart, coupon)?;
        let order = Order { id: self.seq.take(), cart, quote: q, state: OrderState::New, history: Vec::new() };
        self.bus.emit("order.placed", &order.id);
        Ok(order)
    }

    pub fn cancel(&mut self, order: &mut Order) -> Result<()> {
        order.move_to(OrderState::Cancelled)?;
        for (sku, line) in &order.cart.lines {
            self.inventory.release(sku, line.qty);
        }
        self.bus.emit("order.cancelled", &order.id);
        Ok(())
    }
}
