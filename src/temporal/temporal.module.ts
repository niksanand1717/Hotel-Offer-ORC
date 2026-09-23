import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Client, Connection } from '@temporalio/client';
import { config } from '../config';
import { temporalConnectionOptions } from './connection-options';

export const TEMPORAL_CLIENT = Symbol('TEMPORAL_CLIENT');

@Global()
@Module({
  providers: [
    {
      provide: TEMPORAL_CLIENT,
      // Lazy connection: the API boots even if Temporal is still starting, and
      // /health reports it as down until it is reachable.
      useFactory: () =>
        new Client({
          connection: Connection.lazy(temporalConnectionOptions()),
          namespace: config.temporal.namespace,
        }),
    },
  ],
  exports: [TEMPORAL_CLIENT],
})
export class TemporalModule implements OnApplicationShutdown {
  constructor(@Inject(TEMPORAL_CLIENT) private readonly client: Client) {}

  async onApplicationShutdown(): Promise<void> {
    await this.client.connection.close().catch(() => undefined);
  }
}
