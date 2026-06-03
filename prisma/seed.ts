import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  ContractStatus,
  MaintenanceStatus,
  MaintenanceUrgency,
  NotificationChannel,
  PaymentMethod,
  PaymentStatus,
  PrismaClient,
  PropertyStatus,
  PropertyType,
  Role,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env['DATABASE_URL']!),
});

const SALT = 12;
const h = (pwd: string) => bcrypt.hash(pwd, SALT);

// ── Identifiants fixes pour l'idempotence (upsert) ──────────────────────────
const IDS = {
  settings: 'settings-default',
  contracts: {
    c1: 'contract-prop1-tenant1',
    c2: 'contract-prop2-tenant3',
    c3: 'contract-prop4-tenant2',
  },
  maintenance: { m1: 'maint-001', m2: 'maint-002', m3: 'maint-003' },
};

async function main() {
  console.log('🌱  Seeding Immo Plus CM...\n');

  // ── 1. Paramètres plateforme ───────────────────────────────────────────────
  await prisma.adminSettings.upsert({
    where: { id: IDS.settings },
    update: {},
    create: {
      id: IDS.settings,
      platformName: 'Immo Plus CM',
      supportEmail: 'support@immoplus.cm',
      daysBeforeDueReminder: 5,
      daysAfterLateReminder: [1, 3, 7],
      vatRate: 19.25,
      defaultClauses: [
        'Le loyer est payable le 1er de chaque mois.',
        'Le locataire est responsable des petites réparations d\'entretien courant.',
        'Toute sous-location est formellement interdite sans accord écrit du propriétaire.',
        'Le locataire doit maintenir le logement en bon état de propreté.',
        'Le dépôt de garantie sera restitué dans les 30 jours suivant la restitution des clés.',
      ],
    },
  });
  console.log('✅  AdminSettings');

  // ── 2. Utilisateurs ────────────────────────────────────────────────────────
  const [admin, owner1, owner2, manager1, manager2, tUser1, tUser2, tUser3] = await Promise.all([
    prisma.user.upsert({
      where: { email: 'admin@immoplus.cm' },
      update: {},
      create: {
        firstName: 'Christophe', lastName: 'ADMIN',
        email: 'admin@immoplus.cm', phone: '+237699000001',
        passwordHash: await h('Admin@2024'),
        role: Role.ADMIN, emailVerified: true,
      },
    }),
    prisma.user.upsert({
      where: { email: 'jeanpierre.fotso@immoplus.cm' },
      update: {},
      create: {
        firstName: 'Jean-Pierre', lastName: 'FOTSO',
        email: 'jeanpierre.fotso@immoplus.cm', phone: '+237677100001',
        passwordHash: await h('Owner@2024'),
        role: Role.OWNER, emailVerified: true,
      },
    }),
    prisma.user.upsert({
      where: { email: 'marieclaire.ndongo@immoplus.cm' },
      update: {},
      create: {
        firstName: 'Marie-Claire', lastName: 'NDONGO',
        email: 'marieclaire.ndongo@immoplus.cm', phone: '+237677100002',
        passwordHash: await h('Owner@2024'),
        role: Role.OWNER, emailVerified: true,
      },
    }),
    prisma.user.upsert({
      where: { email: 'paul.kamga@immoplus.cm' },
      update: {},
      create: {
        firstName: 'Paul', lastName: 'KAMGA',
        email: 'paul.kamga@immoplus.cm', phone: '+237690200001',
        passwordHash: await h('Manager@2024'),
        role: Role.MANAGER, emailVerified: true,
      },
    }),
    prisma.user.upsert({
      where: { email: 'sophie.mballa@immoplus.cm' },
      update: {},
      create: {
        firstName: 'Sophie', lastName: 'MBALLA',
        email: 'sophie.mballa@immoplus.cm', phone: '+237690200002',
        passwordHash: await h('Manager@2024'),
        role: Role.MANAGER, emailVerified: true,
      },
    }),
    prisma.user.upsert({
      where: { email: 'eric.nguema@immoplus.cm' },
      update: {},
      create: {
        firstName: 'Éric', lastName: 'NGUEMA',
        email: 'eric.nguema@immoplus.cm', phone: '+237655300001',
        passwordHash: await h('Tenant@2024'),
        role: Role.TENANT, emailVerified: true,
      },
    }),
    prisma.user.upsert({
      where: { email: 'alice.biya@immoplus.cm' },
      update: {},
      create: {
        firstName: 'Alice', lastName: 'BIYA',
        email: 'alice.biya@immoplus.cm', phone: '+237655300002',
        passwordHash: await h('Tenant@2024'),
        role: Role.TENANT, emailVerified: true,
      },
    }),
    prisma.user.upsert({
      where: { email: 'martin.ondoa@immoplus.cm' },
      update: {},
      create: {
        firstName: 'Martin', lastName: 'ONDOA',
        email: 'martin.ondoa@immoplus.cm', phone: '+237655300003',
        passwordHash: await h('Tenant@2024'),
        role: Role.TENANT, emailVerified: true,
      },
    }),
  ]);
  console.log('✅  Users (8)');

  // ── 3. Préférences & alertes ───────────────────────────────────────────────
  await Promise.all([
    prisma.notificationPreference.upsert({
      where: { userId: admin.id }, update: {},
      create: { userId: admin.id, emailPrefs: { newUser: true, paymentAlert: true }, smsPrefs: {} },
    }),
    prisma.notificationPreference.upsert({
      where: { userId: owner1.id }, update: {},
      create: { userId: owner1.id, emailPrefs: { paymentReceived: true, maintenance: true, newApplication: true }, smsPrefs: { paymentReceived: true } },
    }),
    prisma.paymentAlertConfig.upsert({
      where: { userId: owner1.id }, update: {},
      create: { userId: owner1.id, active: true, daysBeforeDue: 5, daysAfterDue: [1, 3, 7], channel: NotificationChannel.BOTH },
    }),
    prisma.notificationPreference.upsert({
      where: { userId: owner2.id }, update: {},
      create: { userId: owner2.id, emailPrefs: { paymentReceived: true, maintenance: true }, smsPrefs: {} },
    }),
    prisma.paymentAlertConfig.upsert({
      where: { userId: owner2.id }, update: {},
      create: { userId: owner2.id, active: true, daysBeforeDue: 3, daysAfterDue: [1, 5], channel: NotificationChannel.EMAIL },
    }),
  ]);
  console.log('✅  NotificationPreferences & PaymentAlertConfigs');

  // ── 4. Biens immobiliers ───────────────────────────────────────────────────
  const [prop1, prop2, prop3, prop4, prop5] = await Promise.all([
    // Owner1 — Yaoundé
    prisma.property.upsert({
      where: { slug: 'appartement-3p-bastos-yaounde' }, update: {},
      create: {
        slug: 'appartement-3p-bastos-yaounde',
        title: 'Appartement 3 pièces à Bastos',
        type: PropertyType.APARTMENT, status: PropertyStatus.RENTED,
        city: 'Yaoundé', neighborhood: 'Bastos',
        address: 'Rue des Ambassades, Bastos',
        latitude: 3.8728, longitude: 11.5214,
        price: 120000, priceLabel: '120 000 FCFA / mois',
        area: 95, bedrooms: 3, bathrooms: 2, floor: 2,
        description: 'Bel appartement dans le quartier résidentiel de Bastos. Proche des ambassades, commerces et restaurants.',
        ownerId: owner1.id, isPublished: true,
      },
    }),
    // Owner1 — Douala, géré par manager1
    prisma.property.upsert({
      where: { slug: 'villa-5ch-bonapriso-douala' }, update: {},
      create: {
        slug: 'villa-5ch-bonapriso-douala',
        title: 'Villa 5 chambres à Bonapriso',
        type: PropertyType.VILLA, status: PropertyStatus.RENTED,
        city: 'Douala', neighborhood: 'Bonapriso',
        address: 'Av. du Général de Gaulle, Bonapriso',
        latitude: 4.0428, longitude: 9.7054,
        price: 350000, priceLabel: '350 000 FCFA / mois',
        area: 280, bedrooms: 5, bathrooms: 3, floor: 0,
        description: 'Magnifique villa avec piscine et jardin arboré dans le quartier huppé de Bonapriso. Idéale pour expatriés.',
        ownerId: owner1.id, managerId: manager1.id, isPublished: true,
      },
    }),
    // Owner1 — Douala bureau, géré par manager1
    prisma.property.upsert({
      where: { slug: 'bureau-80m2-akwa-douala' }, update: {},
      create: {
        slug: 'bureau-80m2-akwa-douala',
        title: 'Bureau 80 m² au centre Akwa',
        type: PropertyType.OFFICE, status: PropertyStatus.AVAILABLE,
        city: 'Douala', neighborhood: 'Akwa',
        address: 'Boulevard de la Liberté, Akwa',
        latitude: 4.0561, longitude: 9.7014,
        price: 220000, priceLabel: '220 000 FCFA / mois',
        area: 80, floor: 3,
        description: 'Espace de bureau au 3ème étage, entièrement climatisé, avec salle de réunion et parking. Centre d\'affaires Akwa.',
        ownerId: owner1.id, managerId: manager1.id, isPublished: true,
      },
    }),
    // Owner2 — Yaoundé
    prisma.property.upsert({
      where: { slug: 'appartement-2p-melen-yaounde' }, update: {},
      create: {
        slug: 'appartement-2p-melen-yaounde',
        title: 'Appartement 2 pièces à Melen',
        type: PropertyType.APARTMENT, status: PropertyStatus.RENTED,
        city: 'Yaoundé', neighborhood: 'Melen',
        address: 'Carrefour Melen, Yaoundé',
        latitude: 3.8512, longitude: 11.5008,
        price: 85000, priceLabel: '85 000 FCFA / mois',
        area: 65, bedrooms: 2, bathrooms: 1, floor: 1,
        description: 'Appartement fonctionnel et bien situé à Melen. Proche marché central et transports en commun.',
        ownerId: owner2.id, isPublished: true,
      },
    }),
    // Owner2 — Douala, géré par manager2
    prisma.property.upsert({
      where: { slug: 'maison-4ch-makepe-douala' }, update: {},
      create: {
        slug: 'maison-4ch-makepe-douala',
        title: 'Maison 4 chambres à Makepe',
        type: PropertyType.HOUSE, status: PropertyStatus.AVAILABLE,
        city: 'Douala', neighborhood: 'Makepe',
        address: 'Rue des Bananiers, Makepe',
        latitude: 4.0801, longitude: 9.7528,
        price: 180000, priceLabel: '180 000 FCFA / mois',
        area: 150, bedrooms: 4, bathrooms: 2, floor: 0,
        description: 'Belle maison individuelle avec cour clôturée. Quartier calme et résidentiel de Makepe.',
        ownerId: owner2.id, managerId: manager2.id, isPublished: true,
      },
    }),
  ]);
  console.log('✅  Properties (5)');

  // ── 5. Profils locataires ──────────────────────────────────────────────────
  const [tenant1, tenant2, tenant3] = await Promise.all([
    prisma.tenant.upsert({
      where: { userId: tUser1.id }, update: {},
      create: {
        userId: tUser1.id, ownerId: owner1.id,
        firstName: 'Éric', lastName: 'NGUEMA',
        email: 'eric.nguema@immoplus.cm', phone: '+237655300001',
        nationalIdNumber: 'CMR-2001-456789',
        occupation: 'Ingénieur informatique', income: 450000,
      },
    }),
    prisma.tenant.upsert({
      where: { userId: tUser2.id }, update: {},
      create: {
        userId: tUser2.id, ownerId: owner2.id,
        firstName: 'Alice', lastName: 'BIYA',
        email: 'alice.biya@immoplus.cm', phone: '+237655300002',
        nationalIdNumber: 'CMR-1998-123456',
        occupation: 'Comptable', income: 280000,
      },
    }),
    prisma.tenant.upsert({
      where: { userId: tUser3.id }, update: {},
      create: {
        userId: tUser3.id, ownerId: owner1.id,
        firstName: 'Martin', lastName: 'ONDOA',
        email: 'martin.ondoa@immoplus.cm', phone: '+237655300003',
        nationalIdNumber: 'CMR-1995-789012',
        occupation: 'Directeur commercial', income: 680000,
      },
    }),
  ]);
  console.log('✅  Tenants (3)');

  // ── 6. Contrats ────────────────────────────────────────────────────────────
  const [contract1, contract2, contract3] = await Promise.all([
    // prop1 ↔ tenant1 — ACTIVE Jan-Déc 2026
    prisma.contract.upsert({
      where: { id: IDS.contracts.c1 }, update: {},
      create: {
        id: IDS.contracts.c1,
        propertyId: prop1.id, tenantId: tenant1.id,
        startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'),
        rent: 120000, deposit: 240000, fees: 60000,
        status: ContractStatus.ACTIVE,
        clauses: {
          create: [
            { text: 'Le loyer est payable le 5 de chaque mois au plus tard.', order: 1 },
            { text: 'Toute dégradation du logement sera facturée au locataire.', order: 2 },
            { text: 'Les charges d\'eau et d\'électricité sont à la charge du locataire.', order: 3 },
          ],
        },
      },
    }),
    // prop2 ↔ tenant3 — ACTIVE Mars 2026 / Fév 2027
    prisma.contract.upsert({
      where: { id: IDS.contracts.c2 }, update: {},
      create: {
        id: IDS.contracts.c2,
        propertyId: prop2.id, tenantId: tenant3.id,
        startDate: new Date('2026-03-01'), endDate: new Date('2027-02-28'),
        rent: 350000, deposit: 700000, fees: 175000,
        status: ContractStatus.ACTIVE,
        clauses: {
          create: [
            { text: 'Le locataire est responsable de l\'entretien de la piscine.', order: 1 },
            { text: 'Tout animal domestique est interdit dans la propriété.', order: 2 },
          ],
        },
      },
    }),
    // prop4 ↔ tenant2 — ACTIVE Juil 2025 / Juin 2026
    prisma.contract.upsert({
      where: { id: IDS.contracts.c3 }, update: {},
      create: {
        id: IDS.contracts.c3,
        propertyId: prop4.id, tenantId: tenant2.id,
        startDate: new Date('2025-07-01'), endDate: new Date('2026-06-30'),
        rent: 85000, deposit: 170000, fees: 42500,
        status: ContractStatus.ACTIVE,
      },
    }),
  ]);
  console.log('✅  Contracts (3)');

  // ── 7. Paiements ───────────────────────────────────────────────────────────
  type PayRow = {
    id: string; contractId: string; tenantId: string; propertyId: string;
    amount: number; period: string; dueDate: string; paymentDate: string | null;
    status: PaymentStatus; paymentMethod: PaymentMethod | null; reference: string | null;
  };

  const rows: PayRow[] = [
    // Contract1 (120 000/mois) — Jan→Avr payés, Mai en retard, Juin en attente
    ...['2026-01','2026-02','2026-03','2026-04'].map((m, i) => ({
      id: `pay-c1-${m}`, contractId: contract1.id, tenantId: tenant1.id, propertyId: prop1.id,
      amount: 120000, period: m,
      dueDate: `${m}-05`, paymentDate: `${m}-0${i + 1 > 4 ? 4 : i + 2}`,
      status: PaymentStatus.PAID,
      paymentMethod: i % 2 === 0 ? PaymentMethod.MOBILE_MONEY : PaymentMethod.TRANSFER,
      reference: `REF-C1-${m.replace('-', '')}`,
    })),
    {
      id: 'pay-c1-2026-05', contractId: contract1.id, tenantId: tenant1.id, propertyId: prop1.id,
      amount: 120000, period: '2026-05', dueDate: '2026-05-05', paymentDate: null,
      status: PaymentStatus.LATE, paymentMethod: null, reference: null,
    },
    {
      id: 'pay-c1-2026-06', contractId: contract1.id, tenantId: tenant1.id, propertyId: prop1.id,
      amount: 120000, period: '2026-06', dueDate: '2026-06-05', paymentDate: null,
      status: PaymentStatus.PENDING, paymentMethod: null, reference: null,
    },

    // Contract2 (350 000/mois) — Mars→Mai payés, Juin en attente
    ...['2026-03','2026-04','2026-05'].map((m, i) => ({
      id: `pay-c2-${m}`, contractId: contract2.id, tenantId: tenant3.id, propertyId: prop2.id,
      amount: 350000, period: m,
      dueDate: `${m}-05`, paymentDate: `${m}-0${i + 1}`,
      status: PaymentStatus.PAID,
      paymentMethod: i === 0 ? PaymentMethod.TRANSFER : PaymentMethod.MOBILE_MONEY,
      reference: `REF-C2-${m.replace('-', '')}`,
    })),
    {
      id: 'pay-c2-2026-06', contractId: contract2.id, tenantId: tenant3.id, propertyId: prop2.id,
      amount: 350000, period: '2026-06', dueDate: '2026-06-05', paymentDate: null,
      status: PaymentStatus.PENDING, paymentMethod: null, reference: null,
    },

    // Contract3 (85 000/mois) — Juil 2025→Mai 2026 payés, Juin en attente
    ...['2025-07','2025-08','2025-09','2025-10','2025-11','2025-12',
        '2026-01','2026-02','2026-03','2026-04','2026-05'].map((m, i) => ({
      id: `pay-c3-${m}`, contractId: contract3.id, tenantId: tenant2.id, propertyId: prop4.id,
      amount: 85000, period: m,
      dueDate: `${m}-05`, paymentDate: `${m}-0${(i % 4) + 1}`,
      status: PaymentStatus.PAID,
      paymentMethod: i % 3 === 0 ? PaymentMethod.TRANSFER : PaymentMethod.MOBILE_MONEY,
      reference: `REF-C3-${m.replace('-', '')}`,
    })),
    {
      id: 'pay-c3-2026-06', contractId: contract3.id, tenantId: tenant2.id, propertyId: prop4.id,
      amount: 85000, period: '2026-06', dueDate: '2026-06-05', paymentDate: null,
      status: PaymentStatus.PENDING, paymentMethod: null, reference: null,
    },
  ];

  await Promise.all(
    rows.map(r =>
      prisma.payment.upsert({
        where: { id: r.id }, update: {},
        create: {
          id: r.id,
          contractId: r.contractId, tenantId: r.tenantId, propertyId: r.propertyId,
          amount: r.amount, period: r.period,
          dueDate: new Date(r.dueDate),
          paymentDate: r.paymentDate ? new Date(r.paymentDate) : null,
          status: r.status, paymentMethod: r.paymentMethod, reference: r.reference,
        },
      })
    )
  );
  console.log(`✅  Payments (${rows.length})`);

  // ── 8. Demandes de maintenance ─────────────────────────────────────────────
  await Promise.all([
    prisma.maintenanceRequest.upsert({
      where: { id: IDS.maintenance.m1 }, update: {},
      create: {
        id: IDS.maintenance.m1, propertyId: prop1.id, tenantId: tenant1.id,
        title: 'Fuite d\'eau dans la salle de bain',
        description: 'Fuite sous le lavabo depuis 2 jours. L\'eau coule en permanence et commence à humidifier le plancher.',
        urgency: MaintenanceUrgency.HIGH, status: MaintenanceStatus.IN_PROGRESS,
      },
    }),
    prisma.maintenanceRequest.upsert({
      where: { id: IDS.maintenance.m2 }, update: {},
      create: {
        id: IDS.maintenance.m2, propertyId: prop2.id,
        title: 'Panne climatisation salon',
        description: 'Le climatiseur principal du salon ne fonctionne plus depuis une semaine. Température insupportable.',
        urgency: MaintenanceUrgency.NORMAL, status: MaintenanceStatus.OPEN,
      },
    }),
    prisma.maintenanceRequest.upsert({
      where: { id: IDS.maintenance.m3 }, update: {},
      create: {
        id: IDS.maintenance.m3, propertyId: prop4.id, tenantId: tenant2.id,
        title: 'Serrure porte d\'entrée défectueuse',
        description: 'La serrure principale a du mal à s\'ouvrir. Risque de rester bloqué à l\'extérieur.',
        urgency: MaintenanceUrgency.HIGH, status: MaintenanceStatus.RESOLVED,
        comment: 'Serrure remplacée le 15/05/2026. Problème résolu.',
      },
    }),
  ]);
  console.log('✅  Maintenance requests (3)');

  // ── Récapitulatif ──────────────────────────────────────────────────────────
  console.log('\n🎉  Seeding terminé !\n');
  console.log('┌─────────────┬──────────────────────────────────────────┬──────────────┐');
  console.log('│ Rôle        │ Email                                    │ Mot de passe │');
  console.log('├─────────────┼──────────────────────────────────────────┼──────────────┤');
  console.log('│ ADMIN       │ admin@immoplus.cm                        │ Admin@2024   │');
  console.log('│ OWNER       │ jeanpierre.fotso@immoplus.cm             │ Owner@2024   │');
  console.log('│ OWNER       │ marieclaire.ndongo@immoplus.cm           │ Owner@2024   │');
  console.log('│ MANAGER     │ paul.kamga@immoplus.cm                   │ Manager@2024 │');
  console.log('│ MANAGER     │ sophie.mballa@immoplus.cm                │ Manager@2024 │');
  console.log('│ TENANT      │ eric.nguema@immoplus.cm                  │ Tenant@2024  │');
  console.log('│ TENANT      │ alice.biya@immoplus.cm                   │ Tenant@2024  │');
  console.log('│ TENANT      │ martin.ondoa@immoplus.cm                 │ Tenant@2024  │');
  console.log('└─────────────┴──────────────────────────────────────────┴──────────────┘');
}

main()
  .catch(e => {
    console.error('\n❌  Erreur de seeding :', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
