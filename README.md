# RPAD Service

Microservicio para gestionar y auditar reportes entre demandante y prestador, preservar temporalmente el contexto del chat, administrar evidencias privadas y registrar decisiones de auditoría.

## Estado de integración

El origen del chat y su caché todavía no existen. RPAD define una entrada de contexto desacoplada: el backend puede crear un reporte en estado PENDING_CONTEXT y entregar posteriormente la instantánea mediante el endpoint interno de chat-snapshot. La instantánea se guarda en PostgreSQL con hash SHA-256. No se asume un esquema de Redis ni se conecta directamente a una caché ajena hasta acordar su contrato.

Después de archivar un reporte, RPAD elimina su instantánea local, marca sus evidencias para purga y publica eventos para que el microservicio propietario elimine el chat de origen. El borrado de archivos se procesa en segundo plano. El servicio de origen debe consumir rpad.source-chat.purge.requested y confirmar la purga en el endpoint correspondiente.

## Stack

- NestJS 11 y TypeScript
- PostgreSQL y Prisma
- JWT RS256 validado contra JWKS del backend
- Azure Blob Storage privado con URL SAS de corta duración
- Azure Service Bus Topic con transactional outbox

## Ejecución local

1. Copia .env.example como .env y completa la configuración local. No subas .env ni credenciales.
2. Inicia PostgreSQL con docker compose up -d postgres.
3. Instala dependencias con npm ci.
4. Genera Prisma Client con npm run prisma:generate.
5. Aplica el esquema con npm run db:migrate.
6. Inicia con npm run start:dev.

La aplicación escucha en el puerto 3000 y expone OpenAPI en /docs. Los endpoints de negocio requieren un JWT RS256 válido. Sin AUTH_JWKS_URI, AUTH_ISSUER y AUTH_AUDIENCE configurados, el servicio falla de forma cerrada. Blob Storage y Service Bus son opcionales durante el arranque; sus operaciones quedan no disponibles o en outbox hasta configurar los adaptadores.

## API inicial

- POST /internal/rpad/reports — crea el caso con claimantId, providerId, chatId y descripción; acepta una instantánea opcional.
- GET /internal/rpad/reports — lista reportes; los auditores ven todos y los usuarios solo los propios.
- GET /internal/rpad/reports/:id — detalle autorizado.
- POST /internal/rpad/reports/:id/chat-snapshot — el backend entrega los mensajes capturados; rol SERVICE.
- GET /internal/rpad/reports/:id/chat — consulta de chat para partes o auditor, mientras el caso no esté archivado.
- POST /internal/rpad/reports/:id/evidence/upload-intents — solicita URL SAS temporal para imagen o video.
- POST /internal/rpad/reports/:id/evidence/:evidenceId/complete — verifica la carga, MIME, tamaño y firma básica; calcula hash.
- GET /internal/rpad/reports/:id/evidence/:evidenceId/url — URL SAS de lectura temporal.
- POST /internal/rpad/reports/:id/decisions — decisión y acciones propuestas; rol AUDITOR.
- POST /internal/rpad/reports/:id/archive — archiva el caso y agenda purga; rol AUDITOR.
- POST /internal/rpad/reports/:id/chat-purge-confirmation — confirma la eliminación del chat de origen; rol SERVICE.
- GET /internal/rpad/reports/:id/history — bitácora de auditoría.
- GET /health — liveness.

Estados: PENDING_CONTEXT, OPEN, UNDER_REVIEW, RESOLVED y ARCHIVED. La decisión registra a qué parte se favorece, justificación y acciones SANCTION/RESTORATION. RPAD publica rpad.decision.recorded; los servicios propietarios ejecutan las acciones y confirman resultados mediante eventos en una siguiente iteración.

## Evidencias y privacidad

Se aceptan JPEG, PNG, WebP, MP4, QuickTime y WebM. Límites iniciales: 15 MiB por imagen y 250 MiB por video, validados al completar la carga. Los objetos son privados y las SAS duran pocos minutos. Nunca se guardan medios binarios en PostgreSQL.

La API archiva el reporte antes de solicitar la eliminación. El worker borra los objetos locales y el evento rpad.source-chat.purge.requested permite que el servicio de chat elimine su caché. El registro conserva IDs de partes, decisión, hashes y bitácora, pero no conserva el texto del chat ni los archivos tras el archivo. La eliminación real en Azure también depende de configurar soft delete, versionado, backups y sus periodos de retención de acuerdo con la política legal del producto; el código no puede garantizar purga física mientras esas funciones retengan versiones.

El repositorio es público por solicitud, pero no debe incluir datos reales, tokens, URL SAS, secretos ni muestras con información personal. Usa un rol PostgreSQL de runtime con permisos mínimos y no permite editar o borrar eventos de auditoría desde la API.

## Configuración

Consulta .env.example. JWT usa JWKS y RS256; el claim de roles y el claim de ID son configurables. Roles esperados: USER, AUDITOR, SERVICE y ADMIN. Para el backend, usa SERVICE; los auditores deben incluir AUDITOR.

## Límites actuales

- El contrato del microservicio/cache de chat está pendiente. La entrada de snapshot y el evento de purga son los contratos provisionales.
- Las acciones de sanción y reparación quedan registradas y publicadas como eventos; RPAD no cambia cuentas externas directamente.
- El análisis antivirus y la validación de video más profunda deben agregarse antes de producción.
- Las pruebas automatizadas cubren la lógica base; valida el proveedor JWKS, el contenedor privado, la suscripción Service Bus y las reglas de purga en el entorno destino antes de desplegar.
