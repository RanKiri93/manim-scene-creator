export const MTPROJ_BUNDLE_FORMAT_VERSION = 1;

export class MtprojPackError extends Error {
  readonly failed: { trackId: string; text: string; reason: string }[];

  constructor(
    message: string,
    failed: { trackId: string; text: string; reason: string }[],
  ) {
    super(message);
    this.name = 'MtprojPackError';
    this.failed = failed;
  }
}

export class MtprojUnpackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MtprojUnpackError';
  }
}
