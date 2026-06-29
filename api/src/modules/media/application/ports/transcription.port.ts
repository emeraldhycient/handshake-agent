/**
 * Speech-to-text port. The dev mock returns a canned transcript; a real provider
 * (OpenAI-compatible Whisper) is a port swap — application code never imports the
 * concrete adapter. Mirrors the EMAIL_PROVIDER / KYC_PROVIDER pattern.
 */
export const TRANSCRIPTION_PORT = Symbol('TRANSCRIPTION_PORT');

export interface TranscribeInput {
  bytes: Buffer;
  mimeType: string;
  filename?: string;
}
export interface TranscriptionResult {
  text: string;
}
export interface ITranscriptionPort {
  transcribe(input: TranscribeInput): Promise<TranscriptionResult>;
}
