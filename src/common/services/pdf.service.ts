import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { format } from 'date-fns';
import { fr, enUS } from 'date-fns/locale';
import type { ContractPdfVm } from './pdf-view-models';
import type { ReceiptPdfVm } from './pdf-view-models';
import type { CommissionReceiptPdfVm } from './pdf-view-models';

// Labels only — business values (amounts, names, clauses, FCFA) are never translated.
const CONTRACT_LABELS = {
  fr: {
    title: 'CONTRAT DE LOCATION',
    landlord: 'BAILLEUR',
    tenant: 'LOCATAIRE',
    idNumber: "Pièce d'identité",
    property: 'BIEN LOUÉ',
    period: 'PÉRIODE',
    periodText: (start: string, end: string) => `Du ${start} au ${end}`,
    finance: 'CONDITIONS FINANCIÈRES',
    rentHT: 'Loyer HT',
    tva: (rate: number) => `TVA ${rate}%`,
    rentTTC: 'Loyer TTC',
    fees: 'Charges',
    deposit: 'Dépôt de garantie',
    clauses: 'CLAUSES PARTICULIÈRES',
    signatureLandlord: 'Signature du Bailleur',
    signatureTenant: 'Signature du Locataire',
    dateFormat: 'dd MMMM yyyy',
    locale: fr,
  },
  en: {
    title: 'LEASE AGREEMENT',
    landlord: 'LANDLORD',
    tenant: 'TENANT',
    idNumber: 'ID number',
    property: 'RENTED PROPERTY',
    period: 'PERIOD',
    periodText: (start: string, end: string) => `From ${start} to ${end}`,
    finance: 'FINANCIAL TERMS',
    rentHT: 'Rent (excl. VAT)',
    tva: (rate: number) => `VAT ${rate}%`,
    rentTTC: 'Rent (incl. VAT)',
    fees: 'Fees',
    deposit: 'Security deposit',
    clauses: 'SPECIAL CLAUSES',
    signatureLandlord: 'Landlord signature',
    signatureTenant: 'Tenant signature',
    dateFormat: 'MMMM dd, yyyy',
    locale: enUS,
  },
} as const;

@Injectable()
export class PdfService {
  async generateContractPdf(vm: ContractPdfVm): Promise<Buffer> {
    const l = CONTRACT_LABELS[vm.lang];

    return this.streamToBuffer((doc) => {
      doc
        .fontSize(16)
        .font('Helvetica-Bold')
        .text(l.title, { align: 'center' });
      doc.moveDown();

      doc.fontSize(11).font('Helvetica-Bold').text(l.landlord);
      doc.font('Helvetica').text(`${vm.ownerFirstName} ${vm.ownerLastName}`);
      if (vm.ownerAddress) doc.text(vm.ownerAddress);
      doc.moveDown();

      doc.font('Helvetica-Bold').text(l.tenant);
      doc.font('Helvetica').text(`${vm.tenantFirstName} ${vm.tenantLastName}`);
      if (vm.tenantIdNumber) doc.text(`${l.idNumber}: ${vm.tenantIdNumber}`);
      doc.moveDown();

      doc.font('Helvetica-Bold').text(l.property);
      doc
        .font('Helvetica')
        .text(
          `${vm.propertyTitle} — ${vm.propertyAddress}, ${vm.propertyCity}`,
        );
      doc.moveDown();

      doc.font('Helvetica-Bold').text(l.period);
      doc
        .font('Helvetica')
        .text(
          l.periodText(
            format(vm.startDate, l.dateFormat, { locale: l.locale }),
            format(vm.endDate, l.dateFormat, { locale: l.locale }),
          ),
        );
      doc.moveDown();

      doc.font('Helvetica-Bold').text(l.finance);
      doc
        .font('Helvetica')
        .text(`${l.rentHT}          : ${this.formatFcfa(vm.rentHT)}`)
        .text(`${l.tva(vm.tvaRate)}        : ${this.formatFcfa(vm.tvaAmount)}`)
        .text(`${l.rentTTC}         : ${this.formatFcfa(vm.rentTTC)}`)
        .text(`${l.fees}           : ${this.formatFcfa(vm.fees)}`)
        .text(`${l.deposit} : ${this.formatFcfa(vm.deposit)}`);
      doc.moveDown();

      if (vm.clauses.length > 0) {
        doc.font('Helvetica-Bold').text(l.clauses);
        vm.clauses.forEach((clause, i) => {
          doc.font('Helvetica').text(`${i + 1}. ${clause}`);
        });
        doc.moveDown();
      }

      doc.moveDown(2);
      doc
        .font('Helvetica')
        .text(`${l.signatureLandlord}   : ___________________________`)
        .moveDown()
        .text(`${l.signatureTenant} : ___________________________`);
    });
  }

  async generateReceiptPdf(vm: ReceiptPdfVm): Promise<Buffer> {
    return this.streamToBuffer((doc) => {
      doc
        .fontSize(16)
        .font('Helvetica-Bold')
        .text('QUITTANCE DE LOYER', { align: 'center' });
      doc.moveDown();

      doc
        .fontSize(11)
        .font('Helvetica')
        .text(`Période          : ${vm.period}`)
        .text(
          `Date de paiement : ${format(vm.paymentDate, 'dd MMMM yyyy', { locale: fr })}`,
        );
      doc.moveDown();

      doc.font('Helvetica-Bold').text('LOCATAIRE');
      doc.font('Helvetica').text(`${vm.tenantFirstName} ${vm.tenantLastName}`);
      doc.moveDown();

      doc.font('Helvetica-Bold').text('BIEN');
      doc
        .font('Helvetica')
        .text(
          `${vm.propertyTitle} — ${vm.propertyAddress}, ${vm.propertyCity}`,
        );
      doc.moveDown();

      doc.font('Helvetica-Bold').text('PAIEMENT');
      doc
        .font('Helvetica')
        .text(`Montant          : ${this.formatFcfa(vm.amount)}`)
        .text(`Mode de paiement : ${vm.paymentMethod}`);
      if (vm.reference) doc.text(`Référence        : ${vm.reference}`);
      doc.moveDown(2);

      doc
        .font('Helvetica')
        .text(
          `Je soussigné(e) ${vm.ownerFirstName} ${vm.ownerLastName}, bailleur, certifie avoir reçu la somme de ${this.formatFcfa(vm.amount)} au titre du loyer de ${vm.period}.`,
          { align: 'justify' },
        );
      doc.moveDown(2);
      doc.text('Signature du Bailleur : ___________________________');
    });
  }

  async generateCommissionReceiptPdf(
    vm: CommissionReceiptPdfVm,
  ): Promise<Buffer> {
    return this.streamToBuffer((doc) => {
      doc
        .fontSize(16)
        .font('Helvetica-Bold')
        .text('REÇU DE COMMISSION', { align: 'center' });
      doc.moveDown();

      doc.fontSize(11).font('Helvetica-Bold').text('AGENCE');
      doc.font('Helvetica').text(vm.agencyName);
      if (vm.agencyAddress) doc.text(vm.agencyAddress);
      doc.moveDown();

      doc.font('Helvetica-Bold').text('PROPRIÉTAIRE');
      doc.font('Helvetica').text(`${vm.ownerFirstName} ${vm.ownerLastName}`);
      doc.moveDown();

      doc.font('Helvetica-Bold').text('BIEN CONCERNÉ');
      doc
        .font('Helvetica')
        .text(
          `${vm.propertyTitle}${vm.propertyAddress ? ' — ' + vm.propertyAddress : ''}`,
        );
      doc.moveDown();

      doc.font('Helvetica-Bold').text('COMMISSION');
      doc.font('Helvetica').text(`Type              : ${vm.type}`);
      if (vm.description) doc.text(`Description       : ${vm.description}`);
      doc
        .text(`Montant HT        : ${this.formatFcfa(vm.amountHT)}`)
        .text(`TVA ${vm.tvaRate}%         : ${this.formatFcfa(vm.tvaAmount)}`)
        .text(`Montant TTC       : ${this.formatFcfa(vm.amountTTC)}`);
      doc.moveDown();

      doc.font('Helvetica-Bold').text('RÈGLEMENT');
      doc
        .font('Helvetica')
        .text(
          `Date              : ${format(vm.paymentDate, 'dd MMMM yyyy', { locale: fr })}`,
        )
        .text(`Mode              : ${vm.paymentMethod}`);
      if (vm.reference) doc.text(`Référence         : ${vm.reference}`);
      doc.moveDown(2);
      doc.text('Signature du Propriétaire : ___________________________');
    });
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private formatFcfa(amount: number): string {
    return `${amount.toLocaleString('fr-FR')} FCFA`;
  }

  private streamToBuffer(
    fill: (doc: InstanceType<typeof PDFDocument>) => void,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      fill(doc);
      doc.end();
    });
  }
}
