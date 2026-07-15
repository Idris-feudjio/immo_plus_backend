import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePropertyDto, UpdatePropertyDto } from './create-property.dto';

const VALID_BASE = {
  title: 'Villa Test',
  type: 'VILLA',
  city: 'Yaoundé',
  neighborhood: 'Bastos',
  address: '1 rue test',
  price: 250000,
  area: 120,
};

async function validateCreate(overrides: Record<string, unknown>) {
  const instance = plainToInstance(CreatePropertyDto, { ...VALID_BASE, ...overrides });
  return validate(instance);
}

describe('CreatePropertyDto — coordonnées GPS', () => {
  it('accepte des coordonnées absentes (latitude/longitude optionnelles)', async () => {
    const errors = await validateCreate({});
    expect(errors).toHaveLength(0);
  });

  it('accepte des coordonnées valides dans la plage WGS84', async () => {
    const errors = await validateCreate({ latitude: 3.848, longitude: 11.502 });
    expect(errors).toHaveLength(0);
  });

  it('rejette une latitude hors plage (> 90) avec le message "Coordonnées GPS invalides"', async () => {
    const errors = await validateCreate({ latitude: 95, longitude: 11.502 });
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
    expect(messages).toContain('Coordonnées GPS invalides');
  });

  it('rejette une longitude hors plage (< -180) avec le message "Coordonnées GPS invalides"', async () => {
    const errors = await validateCreate({ latitude: 3.848, longitude: -200 });
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
    expect(messages).toContain('Coordonnées GPS invalides');
  });

  it('rejette une latitude fournie sans longitude (coordonnée orpheline)', async () => {
    const errors = await validateCreate({ latitude: 3.848 });
    const longitudeError = errors.find((e) => e.property === 'longitude');
    expect(longitudeError).toBeDefined();
  });

  it('rejette une longitude fournie sans latitude (coordonnée orpheline)', async () => {
    const errors = await validateCreate({ longitude: 11.502 });
    const latitudeError = errors.find((e) => e.property === 'latitude');
    expect(latitudeError).toBeDefined();
  });
});

describe('UpdatePropertyDto — coordonnées GPS', () => {
  it('rejette une latitude hors plage avec le message "Coordonnées GPS invalides"', async () => {
    const instance = plainToInstance(UpdatePropertyDto, { latitude: -95, longitude: 11.502 });
    const errors = await validate(instance);
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
    expect(messages).toContain('Coordonnées GPS invalides');
  });

  it('accepte { latitude: null, longitude: null } pour effacer une localisation existante', async () => {
    const instance = plainToInstance(UpdatePropertyDto, { latitude: null, longitude: null });
    const errors = await validate(instance);
    expect(errors).toHaveLength(0);
  });

  it('rejette latitude: null sans longitude (coordonnée orpheline, même avec null)', async () => {
    const instance = plainToInstance(UpdatePropertyDto, { latitude: null });
    const errors = await validate(instance);
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
    expect(messages).toContain('Coordonnées GPS invalides');
  });

  it('rejette latitude: null combiné à une longitude numérique (état mixte)', async () => {
    const instance = plainToInstance(UpdatePropertyDto, { latitude: null, longitude: 11.502 });
    const errors = await validate(instance);
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
    expect(messages).toContain('Coordonnées GPS invalides');
  });

  it('accepte une mise à jour sans toucher aux coordonnées (les deux omises)', async () => {
    const instance = plainToInstance(UpdatePropertyDto, { title: 'Nouveau titre' });
    const errors = await validate(instance);
    expect(errors).toHaveLength(0);
  });
});
