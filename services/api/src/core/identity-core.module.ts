import { Global, Injectable, Module } from "@nestjs/common";
import { CarePointIdentityCore } from "@carepoint/identity";

@Injectable()
export class IdentityCoreService extends CarePointIdentityCore {}

@Global()
@Module({
  providers: [IdentityCoreService],
  exports: [IdentityCoreService],
})
export class IdentityCoreModule {}
