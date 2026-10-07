use shop_catalog::products::{by_category, catalog, find};
use shop_core::ShopError;

#[test]
fn catalog_size() {
    assert_eq!(catalog().len(), 6);
}

#[test]
fn find_product() {
    let p = find("SKU-002").unwrap();
    assert_eq!(p.name, "Tea Kettle");
    assert_eq!(p.price.cents, 3500);
}

#[test]
fn missing() {
    assert!(matches!(find("SKU-999"), Err(ShopError::Key(_))));
}

#[test]
fn by_category_sorted() {
    let skus: Vec<&str> = by_category("office").iter().map(|p| p.sku.as_str()).collect();
    assert_eq!(skus, ["SKU-003", "SKU-004"]);
}
