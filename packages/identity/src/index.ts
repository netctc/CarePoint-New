export * from "./types.js";
export * from "./crypto.js";
export { AuditTrail } from "./audit.js";
export { AuthCore } from "./auth-core.js";
export { GovernanceCore } from "./governance-core.js";

import { AuditTrail } from "./audit.js";
import { AuthCore } from "./auth-core.js";
import { GovernanceCore } from "./governance-core.js";

export class CarePointIdentityCore {
  readonly audit = new AuditTrail();
  readonly auth = new AuthCore(this.audit);
  readonly governance = new GovernanceCore(this.audit, (id) => this.auth.getRole(id), (id, actor) => this.auth.revokeAll(id, actor));
}
