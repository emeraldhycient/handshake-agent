/**
 * Manual smoke-tool: sends the `hello_world` template to WHATSAPP_TEST_RECIPIENT.
 * NOT unit-tested. Run via: pnpm --filter @handshake-agent/api send:test
 *
 * Requirements: copy api/.env.example → api/.env and fill in:
 *   WHATSAPP_GRAPH_BASE_URL, WHATSAPP_GRAPH_VERSION, WHATSAPP_PHONE_NUMBER_ID,
 *   WHATSAPP_ACCESS_TOKEN, WHATSAPP_TEST_RECIPIENT
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import axios from 'axios';

// Load api/.env (relative to the api/ directory, one level up from scripts/).
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const BASE_URL =
  process.env.WHATSAPP_GRAPH_BASE_URL ?? 'https://graph.facebook.com';
const VERSION = process.env.WHATSAPP_GRAPH_VERSION ?? 'v25.0';
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID ?? '';
const TOKEN = process.env.WHATSAPP_ACCESS_TOKEN ?? '';
const RECIPIENT = process.env.WHATSAPP_TEST_RECIPIENT ?? '';

if (!PHONE_ID || !TOKEN || !RECIPIENT) {
  console.error(
    'Missing required env vars: WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN, WHATSAPP_TEST_RECIPIENT',
  );
  process.exit(1);
}

const url = `${BASE_URL}/${VERSION}/${PHONE_ID}/messages`;

const body = {
  messaging_product: 'whatsapp',
  to: RECIPIENT,
  type: 'template',
  template: {
    name: 'hello_world',
    language: { code: 'en_US' },
  },
};

async function run(): Promise<void> {
  try {
    const res = await axios.post(url, body, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
    });
    console.log('Success:', JSON.stringify(res.data, null, 2));
  } catch (err: unknown) {
    const axErr = err as {
      response?: { data?: unknown; status?: number };
      message?: string;
    };
    if (axErr.response) {
      console.error(
        `API error (HTTP ${axErr.response.status ?? '?'}):`,
        axErr.response.data,
      );
    } else {
      console.error('Network error:', axErr.message);
    }
    process.exit(1);
  }
}

void run();
