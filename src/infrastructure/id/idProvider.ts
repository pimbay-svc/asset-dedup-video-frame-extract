/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import { randomUUID } from 'node:crypto';
import type { IdGenerator } from '../../domain/provider/id.provider.js';

export class IdProvider implements IdGenerator {
  generateUnique(): string {
    return randomUUID();
  }
}
