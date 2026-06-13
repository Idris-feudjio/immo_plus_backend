import { Injectable } from '@nestjs/common';
import { EventEmitter2, EventEmitterModule, OnEvent } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { DomainEvent } from './domain-event.base';

class PaymentRegisteredEvent extends DomainEvent {
  readonly eventName = 'payment.registered';
  constructor(public readonly amount: number) {
    super();
  }
}

@Injectable()
class TestHandler {
  exactCalls: PaymentRegisteredEvent[] = [];
  wildcardCalls: DomainEvent[] = [];

  @OnEvent('payment.registered')
  handleExact(event: PaymentRegisteredEvent) {
    this.exactCalls.push(event);
  }

  @OnEvent('payment.*')
  handleWildcard(event: DomainEvent) {
    this.wildcardCalls.push(event);
  }
}

describe('EventEmitterModule (integration)', () => {
  let module: TestingModule;
  let emitter: EventEmitter2;
  let handler: TestHandler;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        EventEmitterModule.forRoot({
          wildcard: true,
          delimiter: '.',
          maxListeners: 20,
          verboseMemoryLeak: true,
        }),
      ],
      providers: [TestHandler],
    }).compile();

    await module.init();
    emitter = module.get(EventEmitter2);
    handler = module.get(TestHandler);
  });

  afterEach(async () => {
    await module.close();
  });

  it('exact listener receives emitted event', async () => {
    const event = new PaymentRegisteredEvent(50000);
    emitter.emit('payment.registered', event);

    expect(handler.exactCalls).toHaveLength(1);
    expect(handler.exactCalls[0]).toBe(event);
  });

  it('wildcard listener receives emitted event', async () => {
    const event = new PaymentRegisteredEvent(75000);
    emitter.emit('payment.registered', event);

    expect(handler.wildcardCalls).toHaveLength(1);
    expect(handler.wildcardCalls[0]).toBe(event);
  });

  it('both listeners fire on the same emit', async () => {
    const event = new PaymentRegisteredEvent(100000);
    emitter.emit('payment.registered', event);

    expect(handler.exactCalls).toHaveLength(1);
    expect(handler.wildcardCalls).toHaveLength(1);
  });
});
