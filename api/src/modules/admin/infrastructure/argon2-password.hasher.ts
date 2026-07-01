/**
 * argon2id password hasher (Task 5). Implements IPasswordHasher for admin
 * account passwords. Argon2 embeds the random salt and parameters in the
 * encoded hash string, so two hashes of the same input differ.
 */

import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

import type { IPasswordHasher } from '../application/ports/password-hasher.port';

@Injectable()
export class Argon2PasswordHasher implements IPasswordHasher {
  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id });
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      // A malformed or unrecognized hash string makes argon2 throw; treat it
      // as a failed verification rather than propagating the error.
      return false;
    }
  }
}
