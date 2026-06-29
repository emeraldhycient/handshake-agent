import { createZodDto } from 'nestjs-zod';
import {
  ListBeneficiariesQuerySchema,
  AddBankAccountRequestSchema,
  AddCryptoAddressRequestSchema,
} from '@handshake-agent/contracts';

export class ListBeneficiariesQueryDto extends createZodDto(
  ListBeneficiariesQuerySchema,
) {}

export class AddBankAccountDto extends createZodDto(
  AddBankAccountRequestSchema,
) {}

export class AddCryptoAddressDto extends createZodDto(
  AddCryptoAddressRequestSchema,
) {}
