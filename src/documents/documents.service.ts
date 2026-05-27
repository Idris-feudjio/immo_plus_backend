import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentStatus } from '@prisma/client';
import { differenceInDays } from 'date-fns';

@Injectable()
export class DocumentsService {
  constructor(private prisma: PrismaService) {}

  async getFinancialReport(
    userId: string,
    role: string,
    query: { startDate?: string; endDate?: string; propertyId?: string },
  ) {
    const propertyWhere: any = role !== 'admin' ? { ownerId: userId } : {};
    if (query.propertyId) propertyWhere.id = query.propertyId;

    const properties = await this.prisma.property.findMany({
      where: { ...propertyWhere, deletedAt: null },
      select: { id: true, title: true },
    });

    const propertyIds = properties.map((p) => p.id);
    const paymentWhere: any = {
      propertyId: { in: propertyIds },
      status: PaymentStatus.Paid,
    };
    if (query.startDate) paymentWhere.dueDate = { ...paymentWhere.dueDate, gte: new Date(query.startDate) };
    if (query.endDate) paymentWhere.dueDate = { ...paymentWhere.dueDate, lte: new Date(query.endDate) };

    const payments = await this.prisma.payment.findMany({ where: paymentWhere });

    const grossRevenue = payments.reduce((s, p) => s + p.amount, 0);

    const byProperty = properties.map((prop) => {
      const propPayments = payments.filter((p) => p.propertyId === prop.id);
      const revenue = propPayments.reduce((s, p) => s + p.amount, 0);
      return { propertyId: prop.id, title: prop.title, revenue, fees: 0 };
    });

    return {
      period: { start: query.startDate, end: query.endDate },
      grossRevenue,
      totalFees: 0,
      netRevenue: grossRevenue,
      byProperty,
    };
  }

  async getOccupancyReport(userId: string, role: string, query: { year?: number; propertyId?: string }) {
    const year = query.year ?? new Date().getFullYear();
    const propertyWhere: any = role !== 'admin' ? { ownerId: userId } : {};
    if (query.propertyId) propertyWhere.id = query.propertyId;

    const properties = await this.prisma.property.findMany({
      where: { ...propertyWhere, deletedAt: null },
      select: { id: true, title: true },
    });

    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31);
    const totalDays = differenceInDays(end, start) + 1;

    const details = await Promise.all(
      properties.map(async (prop) => {
        const contracts = await this.prisma.contract.findMany({
          where: {
            propertyId: prop.id,
            status: { not: 'Terminated' },
            startDate: { lte: end },
            endDate: { gte: start },
          },
        });

        let daysOccupied = 0;
        for (const c of contracts) {
          const s = new Date(Math.max(new Date(c.startDate).getTime(), start.getTime()));
          const e = new Date(Math.min(new Date(c.endDate).getTime(), end.getTime()));
          daysOccupied += Math.max(0, differenceInDays(e, s) + 1);
        }

        const rate = Math.round((daysOccupied / totalDays) * 1000) / 10;
        return {
          propertyId: prop.id,
          title: prop.title,
          rate,
          daysOccupied,
          daysVacant: totalDays - daysOccupied,
        };
      }),
    );

    const globalRate =
      details.length > 0
        ? Math.round((details.reduce((s, d) => s + d.rate, 0) / details.length) * 10) / 10
        : 0;

    return { globalRate, properties: details };
  }

  async createExportJob(userId: string, params: { type: string; startDate?: string; endDate?: string; propertyId?: string }) {
    const job = await this.prisma.reportJob.create({
      data: { userId, type: params.type, params, status: 'pending' },
    });
    // TODO: enqueue PDF generation job
    return { jobId: job.id, status: 'pending' };
  }

  async getExportStatus(jobId: string) {
    const job = await this.prisma.reportJob.findUnique({ where: { id: jobId } });
    if (!job) return { status: 'not_found' };
    return { jobId: job.id, status: job.status, pdfUrl: job.pdfUrl };
  }

  async getProfitability(propertyId: string, userId: string, role: string, query: { startDate?: string; endDate?: string }) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, ...(role !== 'admin' ? { ownerId: userId } : {}), deletedAt: null },
    });
    if (!property) return null;

    const paymentWhere: any = { propertyId, status: PaymentStatus.Paid };
    if (query.startDate) paymentWhere.dueDate = { gte: new Date(query.startDate) };
    if (query.endDate) paymentWhere.dueDate = { ...paymentWhere.dueDate, lte: new Date(query.endDate) };

    const payments = await this.prisma.payment.findMany({ where: paymentWhere });
    const cumulativeRevenue = payments.reduce((s, p) => s + p.amount, 0);
    const months = payments.length || 1;
    const avgMonthlyCashFlow = Math.round(cumulativeRevenue / months);

    return {
      property: { id: property.id, title: property.title },
      cumulativeRevenue,
      cumulativeFees: 0,
      avgMonthlyCashFlow,
      roi: null,
    };
  }
}
