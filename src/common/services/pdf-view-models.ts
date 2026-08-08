export interface ContractPdfVm {
  contractId: string;
  lang: 'fr' | 'en';
  ownerFirstName: string;
  ownerLastName: string;
  ownerAddress?: string;
  tenantFirstName: string;
  tenantLastName: string;
  tenantIdNumber?: string;
  propertyTitle: string;
  propertyAddress: string;
  propertyCity: string;
  startDate: Date;
  endDate: Date;
  rentHT: number;
  tvaRate: number;
  tvaAmount: number;
  rentTTC: number;
  fees: number;
  deposit: number;
  clauses: string[];
}

export interface ReceiptPdfVm {
  paymentId: string;
  contractId: string;
  tenantFirstName: string;
  tenantLastName: string;
  propertyTitle: string;
  propertyAddress: string;
  propertyCity: string;
  period: string;
  dueDate: Date;
  paymentDate: Date;
  amount: number;
  paymentMethod: string;
  reference?: string;
  ownerFirstName: string;
  ownerLastName: string;
}

export interface CommissionReceiptPdfVm {
  commissionId: string;
  agencyName: string;
  agencyAddress?: string;
  ownerFirstName: string;
  ownerLastName: string;
  propertyTitle: string;
  propertyAddress?: string;
  type: string;
  description?: string;
  amountHT: number;
  tvaRate: number;
  tvaAmount: number;
  amountTTC: number;
  paymentDate: Date;
  paymentMethod: string;
  reference?: string;
}
