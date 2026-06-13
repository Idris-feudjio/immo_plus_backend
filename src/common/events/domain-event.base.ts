import { v4 as uuidv4 } from 'uuid';

export abstract class DomainEvent {
  readonly occurredAt: Date = new Date();
  readonly eventId: string = uuidv4();
  abstract readonly eventName: string;
}
