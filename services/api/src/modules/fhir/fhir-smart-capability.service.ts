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
        { url: "authorize", valueUri: `${this.smart.issuerUrl()}/smart/browser/authorize` },
        { url: "token", valueUri: this.smart.tokenEndpointUrl() },
      ],
    });
    security.extension = extensions;
    security.service = [{
      coding: [{
        system: "http://terminology.hl7.org/CodeSystem/restful-security-service",
        code: "SMART-on-FHIR",
        display: "SMART-on-FHIR",
      }],
    }];
    security.description = "CarePoint supports patient-mediated SMART authorization plus pre-registered asymmetric backend-services clients. Backend clients use private_key_jwt and narrowly registered system scopes; clinical system scopes authorize protected Bulk Data export only and do not enable interactive system reads of clinical resources.";
    server.security = security;
    server.resource = this.augmentResources(server.resource);
    server.operation = this.augmentOperations(server.operation);
    if (rest.length > 0) rest[0] = server;
    else rest.push(server);

    const software = this.isObject(statement.software) ? statement.software : {};
    const implementation = this.isObject(statement.implementation) ? statement.implementation : {};
    return {
      ...statement,
      software: { ...software, version: "slice-10.13" },
      implementation: {
        ...implementation,
        description: "CarePoint FHIR R4 read-only facade with patient-scoped SMART browser authorization, asymmetric backend services and hardened Bulk Data $export. Slice 10.13 makes Bulk Data jobs durable in PostgreSQL, adds multi-instance lease-based recovery, bounded retry/backoff and automatic expired-artifact cleanup while retaining Redis for distributed security controls and rolling-deployment compatibility.",
      },
      rest,
    };
  }

  private augmentResources(value: unknown): unknown[] {
    const resources = Array.isArray(value) ? value.map((item) => this.isObject(item) ? { ...item } : item) : [];
    const patient = resources.find((item) => this.isObject(item) && item.type === "Patient");
    if (this.isObject(patient)) {
      const interactions = Array.isArray(patient.interaction) ? [...patient.interaction] : [];
      if (!interactions.some((item) => this.isObject(item) && item.code === "search-type")) interactions.push({ code: "search-type" });
      patient.interaction = interactions;
      patient.searchParam = [{ name: "_id", type: "token", documentation: "Exact CarePoint Patient resource id; system-scope search only." }];
    }
    return resources;
  }

  private augmentOperations(value: unknown): unknown[] {
    const operations = Array.isArray(value) ? [...value] : [];
    const definition = "http://hl7.org/fhir/uv/bulkdata/OperationDefinition/export";
    const existing = operations.find((item) => this.isObject(item) && item.name === "export");
    const exportOperation = {
      name: "export",
      definition,
      documentation: "Asynchronous FHIR Bulk Data system-level export for Patient, Appointment, Encounter, Observation, MedicationRequest, ServiceRequest and DiagnosticReport when every requested type is covered by the backend token's registered system scope. Patient and Appointment retain strict _typeFilter support. Jobs are durably persisted in PostgreSQL and recovered by lease-based workers after API restarts; output remains protected by client ownership, scope checks, retention, integrity and storage lifecycle controls.",
    };
    if (this.isObject(existing)) Object.assign(existing, exportOperation);
    else operations.push(exportOperation);
    return operations;
  }

  private isObject(value: unknown): value is JsonObject {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }
}
