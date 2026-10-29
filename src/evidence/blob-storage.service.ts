import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BlobServiceClient, BlobSASPermissions } from '@azure/storage-blob';
import { createHash } from 'node:crypto';

@Injectable()
export class BlobStorageService {
  constructor(private readonly config: ConfigService) {}
  private container() {
    const connection = this.config.get<string>('AZURE_STORAGE_CONNECTION_STRING');
    if (!connection) throw new ServiceUnavailableException('Evidence storage is not configured');
    return BlobServiceClient.fromConnectionString(connection).getContainerClient(this.config.get<string>('AZURE_BLOB_CONTAINER') || 'rpad-evidence');
  }

  async createUploadUrl(key: string, mimeType: string) {
    const container = this.container();
    await container.createIfNotExists();
    const blob = container.getBlockBlobClient(key);
    const expiresOn = new Date(Date.now() + Number(this.config.get('EVIDENCE_UPLOAD_TTL_SECONDS') || 600) * 1000);
    const startsOn = new Date(Date.now() - 60_000);
    const uploadUrl = await blob.generateSasUrl({ permissions: BlobSASPermissions.parse('cw'), startsOn, expiresOn, contentType: mimeType });
    return { uploadUrl, expiresAt: expiresOn.toISOString(), method: 'PUT', headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': mimeType } };
  }

  async createReadUrl(key: string) {
    const blob = this.container().getBlobClient(key);
    const expiresOn = new Date(Date.now() + Number(this.config.get('EVIDENCE_READ_TTL_SECONDS') || 300) * 1000);
    const url = await blob.generateSasUrl({ permissions: BlobSASPermissions.parse('r'), expiresOn });
    return { url, expiresAt: expiresOn.toISOString() };
  }

  async verifyAndHash(key: string, mimeType: string, expectedSize: number) {
    const blob = this.container().getBlobClient(key);
    const props = await blob.getProperties();
    if (!props.contentLength || props.contentLength !== expectedSize) throw new BadRequestException('Uploaded file size does not match the declared size');
    if (props.contentType !== mimeType) throw new BadRequestException('Uploaded MIME type does not match the declared type');
    const download = await blob.download();
    if (!download.readableStreamBody) throw new BadRequestException('Uploaded file could not be read');
    const hash = createHash('sha256');
    let first = Buffer.alloc(0);
    for await (const part of download.readableStreamBody) {
      const chunk = Buffer.from(part);
      hash.update(chunk);
      if (first.length < 16) first = Buffer.concat([first, chunk.subarray(0, 16 - first.length)]);
    }
    const valid = mimeType === 'image/jpeg' ? first[0] === 0xff && first[1] === 0xd8 && first[2] === 0xff
      : mimeType === 'image/png' ? first.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : mimeType === 'image/webp' ? first.toString('ascii', 0, 4) === 'RIFF' && first.toString('ascii', 8, 12) === 'WEBP'
      : mimeType === 'video/webm' ? first.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
      : first.toString('ascii', 4, 8) === 'ftyp';
    if (!valid) throw new BadRequestException('File signature does not match the declared media type');
    return hash.digest('hex');
  }

  async delete(key: string): Promise<void> {
    await this.container().getBlobClient(key).deleteIfExists({ deleteSnapshots: 'include' });
  }
}
