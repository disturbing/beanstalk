use std::collections::HashMap;

type Handler = Box<dyn FnMut(&str)>;

#[derive(Default)]
pub struct Bus {
    handlers: HashMap<String, Vec<Handler>>,
    pub log: Vec<(String, String)>,
}

impl Bus {
    pub fn new() -> Bus {
        Bus::default()
    }

    pub fn on(&mut self, topic: &str, handler: impl FnMut(&str) + 'static) {
        self.handlers.entry(topic.to_string()).or_default().push(Box::new(handler));
    }

    pub fn emit(&mut self, topic: &str, payload: &str) {
        self.log.push((topic.to_string(), payload.to_string()));
        if let Some(handlers) = self.handlers.get_mut(topic) {
            for h in handlers.iter_mut() {
                h(payload);
            }
        }
    }
}
