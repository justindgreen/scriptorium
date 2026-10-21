import { v7 as uuidv7 } from 'uuid'

/** Time-ordered UUIDv7 for all application-generated primary keys. */
export function newId(): string {
  return uuidv7()
}
