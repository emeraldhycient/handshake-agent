import { createZodDto } from 'nestjs-zod';
import {
  ListBeneficiariesQuerySchema,
  BankListQuerySchema,
  AddBankAccountRequestSchema,
  AddCryptoAddressRequestSchema,
} from '@handshake-agent/contracts';

export class ListBeneficiariesQueryDto extends createZodDto(
  ListBeneficiariesQuerySchema,
) {}

export class BankListQueryDto extends createZodDto(BankListQuerySchema) {}

export class AddBankAccountDto extends createZodDto(
  AddBankAccountRequestSchema,
) {}

export class AddCryptoAddressDto extends createZodDto(
  AddCryptoAddressRequestSchema,
) {}
