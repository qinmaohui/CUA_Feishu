import crypto from 'crypto';

import { logger } from '@main/logger';
import { AgentMemoryItem, AgentMemoryStore } from '@main/store/agentMemory';
import { Operator } from '@main/store/types';
import { SettingStore } from '@main/store/setting';

const LOCAL_EMBEDDING_DIM = 128;

const toUnitVector = (vector: number[]): number[] => {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!norm) {
    return vector;
  }
  return vector.map((value) => value / norm);
};

const createLocalEmbedding = (text: string): number[] => {
  const vec = new Array<number>(LOCAL_EMBEDDING_DIM).fill(0);
  const tokens = text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  if (!tokens.length) {
    return vec;
  }

  tokens.forEach((token) => {
    const hash = crypto.createHash('sha256').update(token).digest();
    for (let i = 0; i < hash.length; i += 1) {
      const idx = hash[i] % LOCAL_EMBEDDING_DIM;
      const sign = (hash[(i + 1) % hash.length] & 1) === 0 ? 1 : -1;
      vec[idx] += sign;
    }
  });

  return toUnitVector(vec);
};

type EmbeddingResponse = {
  data?: Array<{
    embedding?: number[];
  }>;
};

const tryRemoteEmbedding = async (text: string): Promise<number[] | null> => {
  const settings = SettingStore.getStore();
  const baseURL = settings.vlmBaseUrl?.trim();
  const apiKey = settings.vlmApiKey?.trim();
  const model = settings.vlmModelName?.trim();

  if (!baseURL || !apiKey || !model) {
    return null;
  }

  const endpoint = new URL('/embeddings', baseURL).toString();

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: text,
      }),
    });

    if (!resp.ok) {
      logger.warn('[memoryEmbedding] Remote embedding failed:', resp.status);
      return null;
    }

    const data = (await resp.json()) as EmbeddingResponse;
    const embedding = data?.data?.[0]?.embedding;
    if (!embedding?.length) {
      return null;
    }

    return toUnitVector(embedding);
  } catch (error) {
    logger.warn('[memoryEmbedding] Remote embedding error:', error);
    return null;
  }
};

export const embedInstruction = async (text: string): Promise<number[]> => {
  const normalized = text.trim();
  if (!normalized) {
    return new Array<number>(LOCAL_EMBEDDING_DIM).fill(0);
  }

  const remote = await tryRemoteEmbedding(normalized);
  if (remote?.length) {
    return remote;
  }

  return createLocalEmbedding(normalized);
};

export const cosineSimilarity = (a: number[], b: number[]): number => {
  if (!a.length || !b.length || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (!normA || !normB) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

export type MemoryMatch = {
  memory: AgentMemoryItem;
  score: number;
};

export const findTopKSimilarMemories = async (
  instruction: string,
  operator: Operator,
  k = 3,
): Promise<MemoryMatch[]> => {
  const queryEmbedding = await embedInstruction(instruction);
  const memories = AgentMemoryStore.getAll().filter(
    (item) => item.operator === operator,
  );

  const scored = memories
    .map((memory) => {
      const score = cosineSimilarity(
        queryEmbedding,
        memory.instructionEmbedding,
      );
      return { memory, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(k, 1));

  return scored;
};
