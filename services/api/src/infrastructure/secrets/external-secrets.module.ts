import { Global, Module } from "@nestjs/common";
import { ExternalSecretResolverService } from "./external-secret-resolver.service";

@Global()
@Module({
  providers: [ExternalSecretResolverService],
  exports: [ExternalSecretResolverService],
})
export class ExternalSecretsModule {}
