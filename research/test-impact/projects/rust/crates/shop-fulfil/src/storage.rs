use std::collections::BTreeMap;

#[derive(Debug, Clone)]
pub struct Repo<T> {
    pub rows: BTreeMap<String, T>,
}

impl<T> Default for Repo<T> {
    fn default() -> Self {
        Repo { rows: BTreeMap::new() }
    }
}

impl<T: Clone> Repo<T> {
    pub fn new() -> Repo<T> {
        Repo::default()
    }

    pub fn put(&mut self, key: &str, value: T) {
        self.rows.insert(key.to_string(), value);
    }

    pub fn get(&self, key: &str) -> Option<&T> {
        self.rows.get(key)
    }

    /// All values, ordered by key.
    pub fn all(&self) -> Vec<T> {
        self.rows.values().cloned().collect()
    }
}
