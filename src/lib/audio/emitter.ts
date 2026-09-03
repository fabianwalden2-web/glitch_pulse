// Tiny dependency-free typed event emitter.

export type Listener<T> = (payload: T) => void;

export class Emitter<Events extends Record<string, any>> {
  private map: Map<keyof Events, Set<Listener<any>>> = new Map();

  on<K extends keyof Events>(type: K, fn: Listener<Events[K]>): () => void {
    let set = this.map.get(type);
    if (!set) {
      set = new Set();
      this.map.set(type, set);
    }
    set.add(fn);
    return () => this.off(type, fn);
  }

  off<K extends keyof Events>(type: K, fn: Listener<Events[K]>): void {
    this.map.get(type)?.delete(fn);
  }

  once<K extends keyof Events>(type: K, fn: Listener<Events[K]>): () => void {
    const wrap: Listener<Events[K]> = (p) => {
      this.off(type, wrap);
      fn(p);
    };
    return this.on(type, wrap);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.map.get(type);
    if (!set) return;
    for (const fn of Array.from(set)) {
      try {
        fn(payload);
      } catch (e) {
        console.error(`[audio] listener for "${String(type)}" threw`, e);
      }
    }
  }

  clear(): void {
    this.map.clear();
  }
}
