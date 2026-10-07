export type Handler = (payload: string) => void;

export class Bus {
  handlers = new Map<string, Handler[]>();
  log: [string, string][] = [];

  on(topic: string, handler: Handler): void {
    const list = this.handlers.get(topic) ?? [];
    list.push(handler);
    this.handlers.set(topic, list);
  }

  emit(topic: string, payload: string): void {
    this.log.push([topic, payload]);
    for (const h of this.handlers.get(topic) ?? []) h(payload);
  }
}
