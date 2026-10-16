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
    expect(AGENT_CHAT_RESPONSE_JSON_SCHEMA.properties.actions.items.anyOf).toHaveLength(4); // CREATE, UPDATE, DELETE, TIMELINE
  });
});

describe('text line provider schema parity', () => {
  it('declares baseDir and englishFont in canonical and Gemini create and update schemas', () => {
    const actionItems = AGENT_CHAT_RESPONSE_JSON_SCHEMA.properties.actions.items as unknown as { anyOf: { properties: Record<string, { properties?: Record<string, unknown> }> }[] };
    const schemas = [
      actionItems.anyOf[0]!.properties.item!.properties!,
      actionItems.anyOf[1]!.properties.updates!.properties!,
      GEMINI_RESPONSE_SCHEMA.properties.actions.items.properties.item.properties as Record<string, unknown>,
      GEMINI_RESPONSE_SCHEMA.properties.actions.items.properties.updates.properties as Record<string, unknown>,
    ];
    for (const schema of schemas) {
      expect(schema).toHaveProperty('baseDir');
      expect(schema).toHaveProperty('englishFont');
    }
  });
});

describe('graph motion provider schema parity', () => {
  it('declares dot fields and Move-along-graph rows in both schemas', () => {
    const actionItems = AGENT_CHAT_RESPONSE_JSON_SCHEMA.properties.actions.items as unknown as { anyOf: { properties: Record<string, { properties?: Record<string, { items?: { properties?: Record<string, unknown> } }> }> }[] };
    const canonicalCreate = actionItems.anyOf[0]!.properties.item!.properties!;
    const canonicalUpdate = actionItems.anyOf[1]!.properties.updates!.properties!;
    const gemini = GEMINI_RESPONSE_SCHEMA.properties.actions.items.properties;
    for (const schema of [canonicalCreate, canonicalUpdate, gemini.item.properties as Record<string, unknown>, gemini.updates.properties as Record<string, unknown>]) {
      expect(schema).toHaveProperty('dot.properties.attachment');
      expect(schema).toHaveProperty('dot.properties.showCoordinates');
    }
    expect(canonicalCreate.targets!.items!.properties).toHaveProperty('targetX');
    expect(gemini.item.properties.targets.items.properties).toHaveProperty('targetX');
    expect(gemini.item.properties.mode.enum).toContain('graphFollow');
  });
});

describe('connector provider schema parity', () => {
  it('declares shape endpoints in both schemas', () => {
    const actionItems = AGENT_CHAT_RESPONSE_JSON_SCHEMA.properties.actions.items as unknown as { anyOf: { properties: Record<string, { properties?: Record<string, unknown> }> }[] };
    const gemini = GEMINI_RESPONSE_SCHEMA.properties.actions.items.properties;
    for (const schema of [actionItems.anyOf[0]!.properties.item!.properties!, actionItems.anyOf[1]!.properties.updates!.properties!, gemini.item.properties as Record<string, unknown>, gemini.updates.properties as Record<string, unknown>]) {
      expect(schema).toHaveProperty('endpoints.properties.start.properties.kind.enum');
    }
  });
});
