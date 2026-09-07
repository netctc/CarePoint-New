import { Injectable } from "@nestjs/common";
import { SmartConfigurationService } from "../../security/smart-configuration.service";

type FhirResource = Record<string, unknown>;
type JsonObject = Record<string, unknown>;

@Injectable()
export class FhirSmartCapabilityService {
  constructor(private readonly smart: SmartConfigurationService) {}

  augment(statement: FhirResource): FhirResource {
    const rest = Array.isArray(statement.rest) ? [...statement.rest] : [];
    const server: JsonObject = rest.length > 0 && this.isObject(rest[0]) ? { ...rest[0] } : { mode: "server" };
    const security: JsonObject = this.isObject(server.security) ? { ...server.security } : {};
    const extensions = Array.isArray(security.extension)
      ? security.extension.filter((item) => !(this.isObject(item) && item.url === "http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris"))
      : [];
    extensions.push({
      url: "http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris",
      extension: [
        { url: "authorize", valueUri: `${this.smart.issuerUrl()}/smart/authorize` },
        { url: "token", valueUri: `${this.smart.issuerUrl()}/smart/token` },
      ],
    });
    security.extension = extensions;
    security.description = "CarePoint bearer sessions and patient-mediated SMART OAuth 2.0 authorization-code tokens are supported. SMART scopes never expand underlying CarePoint clinical authorization.";
    server.security = security;
    if (rest.length > 0) rest[0] = server;
    else rest.push(server);

    const software = this.isObject(statement.software) ? statement.software : {};
    const implementation = this.isObject(statement.implementation) ? statement.implementation : {};
    return {
      ...statement,
      software: { ...software, version: "slice-10.6" },
      implementation: {
        ...implementation,
        description: "CarePoint FHIR R4 read-only facade with strict patient-scoped search, deterministic pagination, SMART 2.2-style patient scopes, PKCE S256 and fail-closed clinical authorization.",
      },
      rest,
    };
  }

  private isObject(value: unknown): value is JsonObject {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }
}
