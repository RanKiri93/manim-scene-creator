import { describe, expect, it } from 'vitest';
import { AGENT_CHAT_RESPONSE_JSON_SCHEMA } from '../types';
import { GEMINI_RESPONSE_SCHEMA } from './gemini';

describe('camera provider schema parity', () => {
  it('declares the camera target and destination fields in canonical and Gemini item schemas', () => {
    const actionItems = AGENT_CHAT_RESPONSE_JSON_SCHEMA.properties.actions.items as unknown as { anyOf: { properties: Record<string, { properties?: Record<string, unknown> }> }[] };
    const canonicalCreate = actionItems.anyOf[0]!.properties.item!.properties!;
    const geminiItem = (GEMINI_RESPONSE_SCHEMA.properties.actions.items.properties.item.properties as Record<string, unknown>);
    const canonicalUpdate = actionItems.anyOf[1]!.properties.updates!.properties!;
    const geminiUpdate = (GEMINI_RESPONSE_SCHEMA.properties.actions.items.properties.updates.properties as Record<string, unknown>);
    for (const field of ['targetMode', 'targetId', 'region', 'targetFrameId', 'targetWidth', 'offsetX', 'offsetY', 'startTime', 'duration']) {
      expect(canonicalCreate).toHaveProperty(field);
      expect(geminiItem).toHaveProperty(field);
    }
    for (const field of ['targetMode', 'targetId', 'region', 'targetFrameId', 'targetWidth', 'offsetX', 'offsetY', 'startTime', 'duration']) {
      expect(canonicalUpdate).toHaveProperty(field);
      expect(geminiUpdate).toHaveProperty(field);
    }
    expect(AGENT_CHAT_RESPONSE_JSON_SCHEMA.properties.actions.items.anyOf).toHaveLength(3);
  });
});
