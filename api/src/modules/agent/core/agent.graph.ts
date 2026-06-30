import { StateGraph, END } from '@langchain/langgraph';
import { Annotation } from '@langchain/langgraph';
import { IntentSchema, type Intent } from '@handshake-agent/contracts';
import type { ConversationTurn, LlmProvider } from './ports/llm-provider.port';

// ---------------------------------------------------------------------------
// State annotation — the shape of data flowing through the graph nodes.
// ---------------------------------------------------------------------------

const AgentState = Annotation.Root({
  userText: Annotation<string>(),
  // Short-term memory threaded in by the calling layer (NOT a checkpointer —
  // CLAUDE.md §6). Defaults to an empty list so single-turn callers are unchanged.
  history: Annotation<ConversationTurn[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  intent: Annotation<Intent | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RunAgentInput {
  /** The raw natural-language message from the user. */
  userText: string;
  /** Injected LlmProvider — the graph has no direct LLM dependency. */
  llm: LlmProvider;
  /**
   * Optional prior conversation turns (short-term memory) supplied by the
   * calling layer. Lets a follow-up message ("50k", "the first one") be
   * interpreted as the answer to the agent's previous question. Defaults to an
   * empty list; the agent never loads history from a database (no checkpointer,
   * CLAUDE.md §6).
   */
  history?: ConversationTurn[];
}

/**
 * Runs the agent graph for a single turn.
 *
 * Implementation note: uses a minimal LangGraph v1 `StateGraph` with one node
 * (`extract_intent`) so the topology is graph-ready and can be extended with
 * additional nodes (clarification, tool-call loops) without restructuring the
 * calling layer.
 *
 * The model PROPOSES — this function returns a validated `Intent` only; it
 * never executes a transaction, reads a database, or imports Nest symbols.
 * (CLAUDE.md §3.1, §3.2, §6)
 */
export async function runAgent(input: RunAgentInput): Promise<Intent> {
  const { userText, llm, history = [] } = input;

  // Build the graph inline so the LlmProvider closure is captured per-call.
  // For a long-lived service the compiled graph can be cached — but the
  // LlmProvider must still be injected rather than imported.
  const graph = new StateGraph(AgentState)
    .addNode('extract_intent', async (state) => {
      const raw = await llm.extractIntent(state.userText, state.history);
      // Parse defensively: if the adapter returns something invalid the Zod
      // error propagates — the core guarantees the caller sees only valid Intent.
      const intent = IntentSchema.parse(raw);
      return { intent };
    })
    .addEdge('__start__', 'extract_intent')
    .addEdge('extract_intent', END)
    .compile();

  const finalState = await graph.invoke({ userText, history, intent: null });

  // intent is set by the extract_intent node; the type is narrowed by the
  // Zod parse inside the node, so a null here is impossible in practice.
  return finalState.intent as Intent;
}
