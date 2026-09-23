import { ValidationPipe } from '@nestjs/common';

/**
 * App-wide validation: DTOs are transformed into class instances (so
 * @Transform/@Type run) and unknown properties are stripped.
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    transform: true,
    whitelist: true,
    stopAtFirstError: true,
  });
}
