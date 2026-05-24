import type { AntigravityPermissionMode } from '../settings';

export interface AntigravityPromptRequest {
  apiKey?: string;
  id: string;
  permissionMode: AntigravityPermissionMode;
  prompt: string;
  sessionId: string;
  systemPrompt?: string;
  type: 'prompt';
  workspace: string;
}

export interface AntigravityCancelRequest {
  id: string;
  sessionId?: string;
  type: 'cancel';
}

export interface AntigravityPingRequest {
  id: string;
  type: 'ping';
}

export interface AntigravityShutdownRequest {
  id: string;
  type: 'shutdown';
}

export type AntigravityBridgeRequest =
  | AntigravityCancelRequest
  | AntigravityPingRequest
  | AntigravityPromptRequest
  | AntigravityShutdownRequest;

export type AntigravityBridgeEvent =
  | { id: string; type: 'ready'; ok: true; python: string }
  | { id: string; type: 'text_delta'; text: string }
  | { id: string; type: 'thinking_delta'; text: string }
  | { id: string; type: 'tool_call'; name: string; input?: Record<string, unknown> }
  | { id: string; type: 'usage'; usage: Record<string, unknown> }
  | { id: string; sessionId?: string; type: 'done' }
  | { id: string; content: string; type: 'error' };

export function isAntigravityBridgeEvent(value: unknown): value is AntigravityBridgeEvent {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof (value as { id?: unknown }).id === 'string'
    && typeof (value as { type?: unknown }).type === 'string';
}
