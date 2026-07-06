// Central AI Gateway. All AI calls in Forge Core go through this module.
// Providers are configured exclusively via environment variables (.env),
// so Forge stays portable and independent of any specific runtime.

import { db, aiCallsTable, memoryItemsTable } from "@workspace/db";
import { ilike, or, desc } from "drizzle-orm";
import { logger } from "./logger";

export const TASK_TYPES = [
  "planning",
  "architecture",
  "codegeneration",
  "testing",
  "securityreview",
  "documentation",
  "summary",
  "erroranalysis",
] as const;

export type TaskType = (typeof TASK_TYPES)[number];

interface ProviderConfig {
  name: string;
  configured: boolean;
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
}

function openAiCompatible(name: string, envPrefix: string, defaults: { baseUrl: string; model: string }): ProviderConfig {
  const apiKey = process.env[`${envPrefix}_API_KEY`];
  return {
    name,
    configured: Boolean(apiKey),
    baseUrl: process.env[`${envPrefix}_BASE_URL`] ?? defaults.baseUrl,
    apiKey,
    model: process.env[`${envPrefix}_MODEL`] ?? defaults.model,
  };
}

export function getProviders(): ProviderConfig[] {
  return [
    openAiCompatible("openai", "OPENAI", { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" }),
    openAiCompatible("anthropic", "ANTHROPIC", { baseUrl: "https://api.anthropic.com/v1", model: "claude-3-5-haiku-latest" }),
    openAiCompatible("custom", "CUSTOM_AI", { baseUrl: "http://localhost:11434/v1", model: "llama3" }),
  ];
}

export function getDefaultProviderName(): string {
  return process.env.AI_DEFAULT_PROVIDER ?? "openai";
}

export function getFallbackProviderName(): string | undefined {
  return process.env.AI_FALLBACK_PROVIDER;
}

// Task-type routing: AI_ROUTE_<TASKTYPE>=providerName in .env
export function providerForTaskType(taskType: string): string {
  const routed = process.env[`AI_ROUTE_${taskType.toUpperCase()}`];
  return routed ?? getDefaultProviderName();
}

export function providerSummary(): {
  name: string;
  configured: boolean;
  isDefault: boolean;
  isFallback: boolean;
  taskTypes: string[];
}[] {
  const providers = getProviders();
  const def = getDefaultProviderName();
  const fallback = getFallbackProviderName();
  return providers.map((p) => ({
    name: p.name,
    configured: p.configured,
    isDefault: p.name === def,
    isFallback: p.name === fallback,
    taskTypes: TASK_TYPES.filter((t) => providerForTaskType(t) === p.name),
  }));
}

export async function getMemoryContext(query: string, limit = 3): Promise<string> {
  const pattern = `%${query.slice(0, 80)}%`;
  const items = await db
    .select()
    .from(memoryItemsTable)
    .where(or(ilike(memoryItemsTable.title, pattern), ilike(memoryItemsTable.content, pattern)))
    .orderBy(desc(memoryItemsTable.createdAt))
    .limit(limit);
  if (items.length === 0) return "";
  return items.map((i) => `[memory:${i.category}] ${i.title}: ${i.content}`).join("\n");
}

interface InvokeOutcome {
  provider: string;
  model: string;
  response: string;
  tokensIn: number | null;
  tokensOut: number | null;
  costIndication: string | null;
}

async function callAnthropic(p: ProviderConfig, prompt: string, context: string): Promise<InvokeOutcome> {
  const res = await fetch(`${p.baseUrl}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": p.apiKey ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: p.model,
      max_tokens: 1024,
      messages: [{ role: "user", content: context ? `${context}\n\n${prompt}` : prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as {
    content?: { text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = data.content?.map((c) => c.text ?? "").join("") ?? "";
  const tokensIn = data.usage?.input_tokens ?? null;
  const tokensOut = data.usage?.output_tokens ?? null;
  return {
    provider: p.name,
    model: p.model,
    response: text,
    tokensIn,
    tokensOut,
    costIndication: tokensIn != null && tokensOut != null ? `~${tokensIn + tokensOut} tokens` : null,
  };
}

async function callOpenAiCompatible(p: ProviderConfig, prompt: string, context: string): Promise<InvokeOutcome> {
  const res = await fetch(`${p.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${p.apiKey ?? ""}`,
    },
    body: JSON.stringify({
      model: p.model,
      messages: [
        ...(context ? [{ role: "system", content: `Relevant Forge memory:\n${context}` }] : []),
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`${p.name} error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const tokensIn = data.usage?.prompt_tokens ?? null;
  const tokensOut = data.usage?.completion_tokens ?? null;
  return {
    provider: p.name,
    model: p.model,
    response: data.choices?.[0]?.message?.content ?? "",
    tokensIn,
    tokensOut,
    costIndication: tokensIn != null && tokensOut != null ? `~${tokensIn + tokensOut} tokens` : null,
  };
}

async function callProvider(p: ProviderConfig, prompt: string, context: string): Promise<InvokeOutcome> {
  if (p.name === "anthropic") return callAnthropic(p, prompt, context);
  return callOpenAiCompatible(p, prompt, context);
}

export async function invokeGateway(
  taskType: TaskType,
  prompt: string,
  context?: string,
): Promise<{ id: number } & InvokeOutcome> {
  const providers = getProviders();
  const primaryName = providerForTaskType(taskType);
  const fallbackName = getFallbackProviderName();

  const chain = [primaryName, fallbackName]
    .filter((n): n is string => Boolean(n))
    .map((n) => providers.find((p) => p.name === n))
    .filter((p): p is ProviderConfig => Boolean(p && p.configured));

  if (chain.length === 0) {
    const [row] = await db
      .insert(aiCallsTable)
      .values({
        provider: primaryName,
        model: "n/a",
        taskType,
        status: "error",
        errorMessage: "No AI provider configured. Set OPENAI_API_KEY / ANTHROPIC_API_KEY / CUSTOM_AI_API_KEY in .env",
      })
      .returning();
    logger.warn({ taskType, callId: row?.id }, "AI invoke without configured provider");
    throw new GatewayError(
      "No AI provider is configured. Add OPENAI_API_KEY, ANTHROPIC_API_KEY or CUSTOM_AI_API_KEY to your .env file.",
    );
  }

  const memoryContext = context ?? (await getMemoryContext(prompt));
  let lastError: Error | null = null;

  for (const p of chain) {
    try {
      const outcome = await callProvider(p, prompt, memoryContext);
      const [row] = await db
        .insert(aiCallsTable)
        .values({
          provider: outcome.provider,
          model: outcome.model,
          taskType,
          status: "success",
          tokensIn: outcome.tokensIn,
          tokensOut: outcome.tokensOut,
          costIndication: outcome.costIndication,
        })
        .returning();
      return { id: row.id, ...outcome };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      await db.insert(aiCallsTable).values({
        provider: p.name,
        model: p.model,
        taskType,
        status: "error",
        errorMessage: lastError.message.slice(0, 500),
      });
      logger.warn({ provider: p.name, taskType, err: lastError.message }, "AI provider call failed, trying fallback");
    }
  }

  throw new GatewayError(`All AI providers failed. Last error: ${lastError?.message ?? "unknown"}`);
}

export class GatewayError extends Error {}
