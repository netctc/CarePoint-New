# Guía técnica de despliegue - CarePoint V2 entorno de test en Ubuntu VPS

**Rama:** `entorno-v2`  
**Ámbito:** pruebas técnicas, integración y UAT con datos sintéticos  
**No usar con datos reales de pacientes ni credenciales de producción.**

## 1. Objetivo y estado de la rama

La rama `entorno-v2` contiene el baseline funcional actualmente integrado en `v2/development` más la capa específica de infraestructura y operación para un entorno de pruebas reproducible en VPS Ubuntu.

Baseline funcional sincronizado: `8d305e307e390544fd9358ba08eaa32872b7c2bc`.  
Merge de sincronización: `94bd5dd0d0426996ad9495e0ea9d28d47ded4d25`.

La rama añade, entre otros:

- `ops/test-v2/compose.yaml`
- `ops/test-v2/Dockerfile.flutter-web`
- `ops/test-v2/nginx/carepoint-v2-http.conf.template`
- `ops/test-v2/scripts/bootstrap-ubuntu.sh`
- `ops/test-v2/scripts/install-nginx-tls.sh`
- `ops/test-v2/scripts/deploy.sh`
- `ops/test-v2/scripts/smoke.sh`
- `ops/test-v2/scripts/verify-public.sh`
- `ops/test-v2/variables.required.txt`
- workflows `Entorno V2 Test Lane` y `Entorno V2 VPS Contract`

## 2. Arquitectura del entorno

Servicios Docker:

| Servicio | Host | Uso |
|---|---:|---|
| API | 127.0.0.1:4200 | Backend CarePoint |
| Admin Web | 127.0.0.1:3200 | Portal de administración |
| Patient Web | 127.0.0.1:8280 | Flutter Web paciente |
| Doctor Web | 127.0.0.1:8281 | Flutter Web doctor |
| Provider Web | 127.0.0.1:8282 | Flutter Web otros proveedores |
| PostgreSQL 16 | solo red Docker | Base de datos |
| Redis 7 | solo red Docker | Cache/estado auxiliar |

Nginx se ejecuta en el host y publica cinco FQDN por HTTPS. PostgreSQL y Redis no deben exponerse a Internet.

En `entorno-v2`, Compose sobrescribe los puertos de ejecución de API y Admin a `4200` y `3200` respectivamente. El Dockerfile genérico del repositorio conserva sus defaults para no alterar otros carriles. Patient/Doctor/Provider siguen escuchando dentro de sus contenedores Nginx en el puerto 80, pero se publican sólo en loopback como `8280/8281/8282`.

## 3. Requisitos del VPS

Baseline recomendado:

- Ubuntu 24.04 LTS.
- 4 vCPU, 8 GB RAM y 80 GB SSD como mínimo práctico para construir las tres apps Flutter Web.
- 8 vCPU, 16 GB RAM y 120 GB SSD para mayor margen durante builds.
- Acceso SSH con usuario no root y privilegios sudo.
- Salida a Internet para apt, Docker Hub/GHCR, npm, pub.dev y Let's Encrypt.
- Un dominio o subdominios administrables por DNS.

Puertos públicos:

- SSH: sólo desde la IP de administración y por el puerto realmente utilizado.
- TCP 80: HTTP/ACME.
- TCP 443: HTTPS.
- No abrir 3200, 4200, 8280, 8281, 8282, 5432 ni 6379.

## 4. DNS requerido

Crear cinco registros A/AAAA hacia la IP pública del VPS:

- `TEST_API_DOMAIN`
- `TEST_ADMIN_DOMAIN`
- `TEST_PATIENT_DOMAIN`
- `TEST_DOCTOR_DOMAIN`
- `TEST_PROVIDER_DOMAIN`

Ejemplo lógico:

```text
api-test.example.com
admin-test.example.com
patient-test.example.com
doctor-test.example.com
provider-test.example.com
```

No solicitar certificados hasta que los cinco nombres resuelvan al VPS.

## 5. Preparación inicial del sistema

Conectarse por SSH y, si el proveedor entrega acceso root, crear primero un operador no root. Ejemplo orientativo:

```bash
adduser carepoint
usermod -aG sudo carepoint
```

Copiar/instalar la clave SSH autorizada y comprobar que el nuevo usuario puede iniciar sesión antes de modificar el firewall.

Clonar el repositorio privado usando una clave SSH o credencial GitHub autorizada; no incrustar tokens en scripts ni URLs persistentes:

```bash
git clone --branch entorno-v2 --single-branch git@github.com:netctc/CarePoint-New.git
cd CarePoint-New
```

Ejecutar el bootstrap:

```bash
sudo bash ops/test-v2/scripts/bootstrap-ubuntu.sh
```

El script instala:

- paquetes base: ca-certificates, curl, git, gnupg, openssl;
- Nginx;
- Fail2ban;
- UFW, sin activarlo automáticamente;
- Docker Engine, CLI, containerd, Buildx y Docker Compose plugin desde el repositorio oficial de Docker;
- Certbot y certbot-nginx en `/opt/certbot`.

Verificar:

```bash
sudo docker version
sudo docker compose version
nginx -v
certbot --version
systemctl --no-pager --full status docker nginx fail2ban
```

## 6. Firewall del host

El bootstrap no activa UFW para evitar bloquear accidentalmente SSH.

Una vez confirmada la IP administrativa y el puerto SSH:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from <ADMIN_PUBLIC_IP>/32 to any port <SSH_PORT> proto tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

La configuración Compose de CarePoint enlaza los puertos de aplicación a `127.0.0.1` y no publica PostgreSQL/Redis. No modificar ese comportamiento sin una revisión específica.

## 7. Variables de entorno

No se usan ni se deben versionar archivos `.env`. Las variables se exportan en la sesión de despliegue o se inyectan desde el gestor de secretos del VPS/CI.

Variables de routing obligatorias:

```bash
export TEST_API_DOMAIN=api-test.example.com
export TEST_ADMIN_DOMAIN=admin-test.example.com
export TEST_PATIENT_DOMAIN=patient-test.example.com
export TEST_DOCTOR_DOMAIN=doctor-test.example.com
export TEST_PROVIDER_DOMAIN=provider-test.example.com
export CAREPOINT_API_PUBLIC_BASE="https://${TEST_API_DOMAIN}/api/v1"
```

Generar secretos exclusivos para este entorno:

```bash
export TEST_POSTGRES_PASSWORD="$(openssl rand -hex 24)"
export TEST_REDIS_PASSWORD="$(openssl rand -hex 24)"

export MFA_ENVELOPE_KEY_BASE64="$(openssl rand -base64 32)"
export CLINICAL_ENVELOPE_KEY_BASE64="$(openssl rand -base64 32)"
export ORDER_ENVELOPE_KEY_BASE64="$(openssl rand -base64 32)"
export ORDER_SIGNING_SECRET_BASE64="$(openssl rand -base64 32)"
export DOCUMENT_ENVELOPE_KEY_BASE64="$(openssl rand -base64 32)"
export DOCUMENT_SIGNING_SECRET_BASE64="$(openssl rand -base64 32)"
export MESSAGING_ENVELOPE_KEY_BASE64="$(openssl rand -base64 32)"
export TELEHEALTH_ENVELOPE_KEY_BASE64="$(openssl rand -base64 32)"
export TELEHEALTH_MOCK_SIGNING_SECRET="$(openssl rand -base64 32)"
```

Opcional para una base nueva:

```bash
export BOOTSTRAP_ADMIN_EMAIL=<email-test>
export BOOTSTRAP_ADMIN_PASSWORD=<password-test-fuerte>
export LOAD_SYNTHETIC_PILOT_FIXTURES=true
```

Opcional para identificación del build:

```bash
export TEST_RELEASE_VERSION=entorno-v2
# TEST_RELEASE_SHA se resuelve automáticamente a git rev-parse HEAD si se omite.
```

Opcional para routing/ETA:

```bash
export FIELD_ROUTE_MAPS_PROVIDER=DIRECT_DISTANCE_V1
```

Si se prueba Mapbox, usar un token exclusivo de sandbox y las variables descritas en `ops/test-v2/variables.required.txt`.

Reglas:

- No reutilizar secretos, contraseñas, claves de firma ni tokens de producción.
- No ejecutar `set -x` en una sesión que contenga estos secretos.
- Mantener todos los gateways externos en mock/sandbox salvo la integración que se esté probando explícitamente.

## 8. Configuración Nginx HTTP

Dar permisos de ejecución a los scripts:

```bash
chmod +x ops/test-v2/scripts/*.sh
```

Instalar la configuración HTTP preservando las variables exportadas:

```bash
export ISSUE_TLS=false
sudo -E bash ops/test-v2/scripts/install-nginx-tls.sh
```

El script:

1. valida los cinco hostnames;
2. renderiza `carepoint-v2-http.conf.template`;
3. crea `/etc/nginx/sites-available/carepoint-v2-test`;
4. habilita el site;
5. deshabilita el site por defecto;
6. ejecuta `nginx -t`;
7. recarga Nginx.

Rutas:

- API -> `http://127.0.0.1:4200`
- Admin -> `http://127.0.0.1:3200`
- Patient -> `http://127.0.0.1:8280`
- Doctor -> `http://127.0.0.1:8281`
- Provider -> `http://127.0.0.1:8282`

## 9. Despliegue de la plataforma

Confirmar la rama:

```bash
git fetch origin
git switch entorno-v2
git pull --ff-only origin entorno-v2
git rev-parse HEAD
```

Ejecutar:

```bash
sudo -E ops/test-v2/scripts/deploy.sh
```

El script realiza:

1. validación de variables obligatorias;
2. validación de `CAREPOINT_API_PUBLIC_BASE`;
3. `docker compose config`;
4. build de API, Admin y las tres aplicaciones Flutter Web;
5. arranque de PostgreSQL y Redis;
6. espera hasta healthchecks;
7. ejecución de migraciones Prisma mediante `npm run db:deploy`;
8. bootstrap opcional del administrador;
9. carga opcional de fixtures sintéticos;
10. arranque de API, Admin, Patient, Doctor y Provider;
11. espera hasta healthcheck del API.

Comprobar el estado:

```bash
sudo docker compose -f ops/test-v2/compose.yaml ps
sudo docker compose -f ops/test-v2/compose.yaml logs --tail=100 api
```

## 10. Smoke test local

Ejecutar:

```bash
ops/test-v2/scripts/smoke.sh
```

Debe devolver PASS para:

- API: `http://127.0.0.1:4200/api/v1/services/search`
- Admin: `http://127.0.0.1:3200/login`
- Patient: `http://127.0.0.1:8280/healthz`
- Doctor: `http://127.0.0.1:8281/healthz`
- Provider: `http://127.0.0.1:8282/healthz`

No continuar con TLS/publicación si falla este paso.

## 11. Activación TLS

Comprobar primero el DNS:

```bash
getent ahosts "$TEST_API_DOMAIN"
getent ahosts "$TEST_ADMIN_DOMAIN"
getent ahosts "$TEST_PATIENT_DOMAIN"
getent ahosts "$TEST_DOCTOR_DOMAIN"
getent ahosts "$TEST_PROVIDER_DOMAIN"
```

Después:

```bash
export CERTBOT_EMAIL=<correo-operador>
export ISSUE_TLS=true
sudo -E bash ops/test-v2/scripts/install-nginx-tls.sh
```

El instalador solicita un certificado que cubre los cinco nombres, activa redirección HTTP->HTTPS, valida Nginx y ejecuta `certbot renew --dry-run`.

## 12. Verificación pública

Ejecutar:

```bash
ops/test-v2/scripts/verify-public.sh
```

Debe validar los cinco endpoints HTTPS y comprobar que HTTP termina redirigiendo a HTTPS.

## 13. Operación diaria

Estado:

```bash
sudo docker compose -f ops/test-v2/compose.yaml ps
```

Logs:

```bash
sudo docker compose -f ops/test-v2/compose.yaml logs --tail=200 api
sudo docker compose -f ops/test-v2/compose.yaml logs --tail=200 admin
```

Reinicio controlado:

```bash
sudo docker compose -f ops/test-v2/compose.yaml restart
```

Parada sin borrar datos:

```bash
sudo docker compose -f ops/test-v2/compose.yaml down
```

No usar `down -v` salvo que se quiera destruir deliberadamente PostgreSQL, Redis y almacenamiento local del entorno.

## 14. Actualización de la rama en el VPS

Antes de actualizar:

```bash
git status
git rev-parse HEAD
sudo docker compose -f ops/test-v2/compose.yaml ps
```

Para cambios de código:

```bash
git fetch origin
git switch entorno-v2
git pull --ff-only origin entorno-v2
sudo -E ops/test-v2/scripts/deploy.sh
ops/test-v2/scripts/smoke.sh
ops/test-v2/scripts/verify-public.sh
```

Registrar siempre el SHA desplegado.

## 15. Copia de seguridad y rollback

Antes de una actualización relevante, guardar al menos una copia de PostgreSQL:

```bash
mkdir -p ~/carepoint-backups
sudo docker compose -f ops/test-v2/compose.yaml exec -T postgres \
  pg_dump -U carepoint_test -d carepoint_test -Fc \
  > ~/carepoint-backups/carepoint_test_$(date +%Y%m%d_%H%M%S).dump
```

Rollback de aplicación a un SHA conocido:

```bash
git fetch origin
git switch --detach <SHA_CONOCIDO_BUENO>
sudo -E ops/test-v2/scripts/deploy.sh
ops/test-v2/scripts/smoke.sh
```

Las migraciones Prisma son forward-oriented; si una versión antigua no es compatible con el esquema ya migrado, restaurar la copia de base de datos correspondiente en vez de intentar deshacer SQL manualmente.

## 16. Política de datos y seguridad

Este carril es sintético/no producción:

- sólo personas y datos de prueba;
- nunca PHI/PII real;
- claves independientes de producción;
- PostgreSQL/Redis no publicados;
- cifrado y firma locales de test deben permanecer activados;
- MFA no debe deshabilitarse para facilitar pruebas;
- pagos, seguros, claims, notificaciones, DICOM y telehealth en mock/sandbox salvo prueba explícita;
- no registrar payloads clínicos completos, passwords ni tokens;
- retirar/rotar secretos al destruir el VPS.

## 17. Gates de validación

La rama contiene dos contratos específicos:

- `Entorno V2 Test Lane`: build Node, tres builds Flutter Web, validación Compose y contrato de scripts.
- `Entorno V2 VPS Contract`: sintaxis y límites del carril VPS/sintético, incluyendo verificación pública.

Además, ejecutar siempre `smoke.sh` después del despliegue y `verify-public.sh` después de activar DNS/TLS o modificar routing.

## 18. Criterios de aceptación del entorno

El entorno se considera listo para pruebas integrales cuando:

- `entorno-v2` contiene el baseline funcional objetivo;
- Compose valida sin errores;
- PostgreSQL y Redis están healthy y no expuestos;
- API está healthy;
- Admin y las tres apps Flutter Web responden localmente;
- Nginx valida con `nginx -t`;
- los cinco FQDN resuelven al VPS;
- Certbot tiene certificados válidos;
- HTTP redirige a HTTPS;
- `smoke.sh` pasa;
- `verify-public.sh` pasa;
- sólo se usan datos sintéticos;
- el SHA desplegado queda registrado.

## 19. Diagnóstico rápido

API no healthy:

```bash
sudo docker compose -f ops/test-v2/compose.yaml logs --tail=300 api
sudo docker compose -f ops/test-v2/compose.yaml ps
```

Nginx:

```bash
sudo nginx -t
sudo journalctl -u nginx --since "-30 min" --no-pager
```

Certbot:

```bash
sudo certbot certificates
sudo certbot renew --dry-run
```

DNS:

```bash
getent ahosts <fqdn>
```

Disco:

```bash
df -h
sudo docker system df
```

No ejecutar `docker system prune --volumes` en un VPS con un entorno que deba conservar datos.
