import { EventEmitter } from 'node:events';
import { Events } from '../../shared/types';
class Bus extends EventEmitter { emitEvent<K extends keyof Events>(channel: K, payload: Events[K]) { this.emit('event', channel, payload); } }
export const bus = new Bus();
export const log = (...args: any[]) => console.log(new Date().toISOString().slice(11, 19), ...args);
