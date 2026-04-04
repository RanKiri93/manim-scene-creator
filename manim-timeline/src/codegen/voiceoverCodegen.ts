import type { VoiceoverConfig } from '@/types/scene';

/**
 * Generate the import block for manim-voiceover if any item uses it.
 */
export function generateVoiceoverImports(usesRecorder: boolean, usesTts: boolean): string {
  const lines: string[] = [];

  if (usesRecorder || usesTts) {
    lines.push('from manim_voiceover import VoiceoverScene');
  }
  if (usesRecorder) {
    lines.push('from manim_voiceover.services.recorder import RecorderService');
  }
  if (usesTts) {
    lines.push('from manim_voiceover.services.gtts import GTTSService');
  }

  return lines.join('\n') + (lines.length ? '\n' : '');
}

/**
 * Generate the speech service setup line inside construct().
 */
export function generateSpeechServiceSetup(voices: VoiceoverConfig[]): string {
  const usesRecorder = voices.some((v) => v.voiceKind === 'recorder');
  if (usesRecorder) {
    return '        self.set_speech_service(RecorderService())\n';
  }
  return '        self.set_speech_service(GTTSService(lang="iw", transcription_model="base"))\n';
}
