import { Test, TestingModule } from '@nestjs/testing';

import { AdminTicketService } from './admin-ticket.service';
import {
  TICKET_ORDER_READ_REPOSITORY,
  type ITicketOrderReadRepository,
  type TicketOrderRecord,
} from './ports/ticket-order-read.repository.port';

const sampleRecord: TicketOrderRecord = {
  id: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  vendorKey: 'zentry',
  ticketType: 'VIP',
  quantity: 2,
  totalAmount: '10000.00',
  currency: 'NGN',
  paymentStatus: 'pending',
  settlementStatus: 'pending',
  deliveryStatus: 'pending',
  createdAt: new Date('2026-06-30T00:00:00.000Z'),
};

describe('AdminTicketService', () => {
  let service: AdminTicketService;
  let repo: jest.Mocked<ITicketOrderReadRepository>;

  beforeEach(async () => {
    repo = { list: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminTicketService,
        { provide: TICKET_ORDER_READ_REPOSITORY, useValue: repo },
      ],
    }).compile();
    service = module.get(AdminTicketService);
  });

  it('maps the repo records to contract items and stringifies createdAt', async () => {
    repo.list.mockResolvedValue({ items: [sampleRecord], nextCursor: null });

    const result = await service.listOrders({});

    expect(result.items).toEqual([
      {
        id: sampleRecord.id,
        userId: sampleRecord.userId,
        vendorKey: 'zentry',
        ticketType: 'VIP',
        quantity: 2,
        totalAmount: '10000.00',
        currency: 'NGN',
        paymentStatus: 'pending',
        settlementStatus: 'pending',
        deliveryStatus: 'pending',
        createdAt: '2026-06-30T00:00:00.000Z',
      },
    ]);
    expect(result.nextCursor).toBeNull();
  });

  it('maps a non-default currency through, not a hardcoded NGN', async () => {
    repo.list.mockResolvedValue({
      items: [{ ...sampleRecord, totalAmount: '45.00', currency: 'USD' }],
      nextCursor: null,
    });

    const result = await service.listOrders({});

    expect(result.items[0].currency).toBe('USD');
    expect(result.items[0].totalAmount).toBe('45.00');
  });

  it('returns an empty list when there are no orders', async () => {
    repo.list.mockResolvedValue({ items: [], nextCursor: null });
    const result = await service.listOrders({});
    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  it('passes the cursor through and applies the default limit of 20', async () => {
    repo.list.mockResolvedValue({ items: [], nextCursor: null });
    await service.listOrders({ cursor: 'abc' });
    expect(repo.list).toHaveBeenCalledWith({ cursor: 'abc', limit: 20 });
  });

  it('honours an explicit limit and surfaces the nextCursor', async () => {
    repo.list.mockResolvedValue({
      items: [sampleRecord],
      nextCursor: sampleRecord.id,
    });
    const result = await service.listOrders({ limit: 5 });
    expect(repo.list).toHaveBeenCalledWith({ cursor: undefined, limit: 5 });
    expect(result.nextCursor).toBe(sampleRecord.id);
  });
});
