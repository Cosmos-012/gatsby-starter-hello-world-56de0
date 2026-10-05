import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface Head { size: number; contentType?: string }
/** Abstraction du stockage de preuves : MinIO, S3, Garage, SeaweedFS… (API S3). Les clés sont générées par le serveur. */
export interface Storage {
  /** Crée le bucket s'il n'existe pas (au démarrage) ; idempotent. */
  ensureBucket?(): Promise<void>;
  presignPut(key: string, o: { contentType: string; size: number; sha256Hex?: string }): Promise<{ url: string; headers: Record<string, string> }>;
  presignGet(key: string, filename: string): Promise<string>;
  head(key: string): Promise<Head | null>;
}

const hexToB64 = (h: string) => Buffer.from(h, 'hex').toString('base64');

export function s3Storage(o: { endpoint: string; publicEndpoint?: string; region?: string; bucket: string; accessKeyId: string; secretAccessKey: string; expiresSeconds?: number }): Storage {
  const credentials = { accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey };
  // Le SDK AWS v3 ajoute par défaut aux URL présignées une somme CRC32 calculée sur un corps VIDE (x-amz-checksum-crc32=AAAAAA==) :
  // tout serveur S3 rejette alors le vrai fichier (BadDigest). On ne calcule une somme que lorsqu'elle est demandée (SHA-256 explicite).
  const base = { region: o.region ?? 'us-east-1', forcePathStyle: true, credentials,
    requestChecksumCalculation: 'WHEN_REQUIRED' as const, responseChecksumValidation: 'WHEN_REQUIRED' as const };
  const s3 = new S3Client({ ...base, endpoint: o.endpoint });                         // accès serveur (réseau interne)
  // Les URL présignées sont consommées par le navigateur : elles doivent être signées pour l'adresse publique (la signature couvre l'hôte et le chemin,
  // le proxy ne doit donc ni réécrire le chemin ni changer l'hôte). Sans adresse publique, on retombe sur l'adresse interne (dev local).
  const signer = new S3Client({ ...base, endpoint: o.publicEndpoint ?? o.endpoint });
  const expiresIn = o.expiresSeconds ?? 300;
  return {
    async ensureBucket() {
      try { await s3.send(new HeadBucketCommand({ Bucket: o.bucket })); return; }
      catch (e: any) { if (e?.$metadata?.httpStatusCode !== 404 && e?.name !== 'NotFound' && e?.name !== 'NoSuchBucket') throw e; }
      try { await s3.send(new CreateBucketCommand({ Bucket: o.bucket })); }
      catch (e: any) { if (e?.name !== 'BucketAlreadyOwnedByYou' && e?.name !== 'BucketAlreadyExists') throw e; }   // course entre instances
    },
    async presignPut(key, { contentType, size, sha256Hex }) {
      const cmd = new PutObjectCommand({ Bucket: o.bucket, Key: key, ContentType: contentType, ContentLength: size,
        ...(sha256Hex ? { ChecksumSHA256: hexToB64(sha256Hex) } : {}) });
      const url = await getSignedUrl(signer, cmd, { expiresIn, signableHeaders: new Set(['content-type', 'content-length']) });
      // La somme SHA-256 est portée par l'URL signée (paramètre x-amz-checksum-sha256) : la renvoyer aussi en en-tête casse la signature.
      return { url, headers: { 'content-type': contentType } };
    },
    presignGet: (key, filename) => getSignedUrl(signer, new GetObjectCommand({ Bucket: o.bucket, Key: key,
      ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(filename)}` }), { expiresIn }),
    async head(key) {
      try { const r = await s3.send(new HeadObjectCommand({ Bucket: o.bucket, Key: key })); return { size: Number(r.ContentLength ?? 0), contentType: r.ContentType }; }
      catch (e: any) { if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound') return null; throw e; }
    },
  };
}

/** Stockage mémoire : tests et développement local sans serveur S3. `put` simule le téléversement du client. */
export function memoryStorage() {
  const objects = new Map<string, Head>();
  const impl: Storage & { put(key: string, h: Head): void; objects: Map<string, Head> } = {
    objects,
    put: (key, h) => void objects.set(key, h),
    presignPut: async (key, o) => ({ url: `memory://put/${key}`, headers: { 'content-type': o.contentType } }),
    presignGet: async (key, filename) => `memory://get/${key}?name=${encodeURIComponent(filename)}`,
    head: async (key) => objects.get(key) ?? null,
  };
  return impl;
}
