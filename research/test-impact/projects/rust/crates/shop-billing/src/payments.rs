use shop_core::money::Money;

pub fn luhn_ok(number: &str) -> bool {
    let digits: Vec<u32> = number.chars().filter_map(|c| c.to_digit(10)).collect();
    if digits.len() < 12 {
        return false;
    }
    let total: u32 = digits
        .iter()
        .rev()
        .enumerate()
        .map(|(i, &d)| {
            if i % 2 == 1 {
                let doubled = d * 2;
                if doubled > 9 { doubled - 9 } else { doubled }
            } else {
                d
            }
        })
        .sum();
    total % 10 == 0
}

pub fn charge(card: &str, amount: &Money) -> &'static str {
    if amount.cents <= 0 {
        return "rejected:amount";
    }
    if !luhn_ok(card) {
        return "rejected:card";
    }
    "approved"
}
