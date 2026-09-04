/**
 * Object storage — one S3-compatible bucket (MinIO locally, any S3 in
 * production), keyed per tenant under `tenants/<id>/…` so a workspace's files
 * can be listed and purged by prefix. Configuration is all-or-nothing: a
 * partial `S3_*` set fails fast at startup instead of failing at the first
 * upload; no `S3_*` at all means the feature is shown as unavailable.
 */
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const VARS = [
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
] as const;

export type StorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

/** The configuration when complete, null when absent; throws when partial. */
export function storageConfig(env: NodeJS.ProcessEnv = process.env): StorageConfig | null {
  const present = VARS.filter((v) => Boolean(env[v]));
  if (present.length === 0) return null;
  if (present.length < VARS.length) {
    const missing = VARS.filter((v) => !env[v]);
    throw new Error(
      `Object storage is partially configured — missing ${missing.join(", ")}. Set all S3_* variables or none.`,
    );
  }
  return {
    endpoint: env.S3_ENDPOINT!,
    region: env.S3_REGION!,
    bucket: env.S3_BUCKET!,
    accessKeyId: env.S3_ACCESS_KEY_ID!,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
    forcePathStyle: env.S3_FORCE_PATH_STYLE !== "false",
  };
}

export function storageConfigured(): boolean {
  return storageConfig() !== null;
}

/** Fail fast: called once at process start by every app that stores files. */
export function assertStorageConfig(): void {
  storageConfig();
}

let client: S3Client | null = null;
function s3(): { client: S3Client; bucket: string } {
  const cfg = storageConfig();
  if (!cfg) throw new Error("storage_unconfigured");
  client ??= new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: cfg.forcePathStyle,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  return { client, bucket: cfg.bucket };
}

/** Where a tenant's files live — the purge deletes this prefix and lists what remains. */
export function tenantPrefix(tenantId: string): string {
  return `tenants/${tenantId}/`;
}

export async function putObject(
  key: string,
  body: Uint8Array | Buffer,
  contentType: string,
  cacheControl = "public, max-age=300",
): Promise<void> {
  const { client, bucket } = s3();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: cacheControl,
    }),
  );
}

export async function getObject(
  key: string,
): Promise<{ body: Uint8Array; contentType: string | null } | null> {
  const { client, bucket } = s3();
  try {
    const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = out.Body ? await out.Body.transformToByteArray() : new Uint8Array();
    return { body, contentType: out.ContentType ?? null };
  } catch (err) {
    if (
      (err as { name?: string }).name === "NoSuchKey" ||
      (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404
    )
      return null;
    throw err;
  }
}

export async function deleteObject(key: string): Promise<void> {
  const { client, bucket } = s3();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function listKeys(prefix: string): Promise<string[]> {
  const { client, bucket } = s3();
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const out = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
    );
    for (const o of out.Contents ?? []) if (o.Key) keys.push(o.Key);
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

/** Deletes everything under a prefix and returns how many objects went. */
export async function deletePrefix(prefix: string): Promise<number> {
  const { client, bucket } = s3();
  const keys = await listKeys(prefix);
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
      }),
    );
  }
  return keys.length;
}
