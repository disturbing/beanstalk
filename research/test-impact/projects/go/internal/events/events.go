// Package events is a tiny synchronous pub/sub bus.
package events

// Entry is one emitted event.
type Entry struct{ Topic, Payload string }

// Bus dispatches payloads to handlers by topic.
type Bus struct {
	handlers map[string][]func(string)
	Log      []Entry
}

// NewBus returns an empty bus.
func NewBus() *Bus { return &Bus{handlers: map[string][]func(string){}} }

// On subscribes handler to topic.
func (b *Bus) On(topic string, handler func(string)) {
	b.handlers[topic] = append(b.handlers[topic], handler)
}

// Emit logs and dispatches payload.
func (b *Bus) Emit(topic, payload string) {
	b.Log = append(b.Log, Entry{topic, payload})
	for _, h := range b.handlers[topic] {
		h(payload)
	}
}
