import { readFileSync } from 'node:fs';
import { config } from '../config';

export interface TemporalConnectionOptions {
  address: string;
  tls?: boolean | { clientCertPair: { crt: Buffer; key: Buffer } };
  apiKey?: string;
}

/**
 * Plain connection for a local Temporal server; TLS with an API key or an
 * mTLS client certificate for Temporal Cloud. Shared by the API client and
 * the worker so both authenticate the same way.
 */
export function temporalConnectionOptions(): TemporalConnectionOptions {
  const { address, apiKey, tlsCertPath, tlsKeyPath } = config.temporal;

  if (tlsCertPath || tlsKeyPath) {
    if (!tlsCertPath || !tlsKeyPath) {
      throw new Error(
        'Set both TEMPORAL_TLS_CERT_PATH and TEMPORAL_TLS_KEY_PATH for mTLS',
      );
    }
    return {
      address,
      tls: {
        clientCertPair: {
          crt: readFileSync(tlsCertPath),
          key: readFileSync(tlsKeyPath),
        },
      },
    };
  }

  if (apiKey) {
    return { address, tls: true, apiKey };
  }

  return { address };
}
