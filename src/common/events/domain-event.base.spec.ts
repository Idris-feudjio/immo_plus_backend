import { DomainEvent } from './domain-event.base';

class TestDomainEvent extends DomainEvent {
  readonly eventName = 'test.happened';
  constructor(public readonly payload: string) {
    super();
  }
}

describe('DomainEvent', () => {
  it('sets occurredAt to a Date close to now', () => {
    const before = new Date();
    const event = new TestDomainEvent('data');
    const after = new Date();

    expect(event.occurredAt).toBeInstanceOf(Date);
    expect(event.occurredAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(event.occurredAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('sets eventId to a valid UUID v4 string', () => {
    const event = new TestDomainEvent('data');
    const uuidV4Regex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    expect(typeof event.eventId).toBe('string');
    expect(event.eventId).toMatch(uuidV4Regex);
  });

  it('generates unique eventId for each instance', () => {
    const event1 = new TestDomainEvent('a');
    const event2 = new TestDomainEvent('b');

    expect(event1.eventId).not.toBe(event2.eventId);
  });

  it('exposes the concrete eventName', () => {
    const event = new TestDomainEvent('data');
    expect(event.eventName).toBe('test.happened');
  });
});
