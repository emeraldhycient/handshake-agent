import { MockTranscriptionProvider } from './mock-transcription.provider';

describe('MockTranscriptionProvider', () => {
  it('returns a deterministic non-empty transcript without touching the network', async () => {
    const provider = new MockTranscriptionProvider();
    const a = await provider.transcribe({
      bytes: Buffer.from('x'),
      mimeType: 'audio/ogg',
    });
    const b = await provider.transcribe({
      bytes: Buffer.from('y'),
      mimeType: 'audio/webm',
    });
    expect(a.text).toBe('[voice note transcript]');
    expect(b.text).toBe(a.text); // deterministic
  });
});
