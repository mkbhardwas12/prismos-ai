// Answer receipts — thin, testable wrappers over the Rust receipt commands.
// A receipt is a locally signed record (digests, model, sources, audit link) of
// what produced an answer. Issuing happens *after* the answer is on screen and
// only when the user opted in, so it never adds latency to chat.

import { invoke } from "@tauri-apps/api/core";
import type { AnswerReceipt, GeneratedAttachment, ReceiptVerification } from "../types";

export interface ReceiptInput {
  question: string;
  answer: string;
  model: string;
  agent: string;
  context_node_ids?: string[];
  sources?: string[];
}

export async function issueAnswerReceipt(input: ReceiptInput): Promise<AnswerReceipt> {
  const json = await invoke<string>("issue_answer_receipt", { input: JSON.stringify(input) });
  return JSON.parse(json) as AnswerReceipt;
}

export async function verifyAnswerReceipt(id: string, answer?: string): Promise<ReceiptVerification> {
  const json = await invoke<string>("verify_answer_receipt", { id, answer: answer ?? null });
  return JSON.parse(json) as ReceiptVerification;
}

export async function exportAnswerReceipt(id: string): Promise<GeneratedAttachment> {
  const json = await invoke<string>("export_answer_receipt", { id });
  return JSON.parse(json) as GeneratedAttachment;
}

/** Separator every answer path appends before its footer line. */
export const ANSWER_FOOTER_SEPARATOR = "\n\n───\n";

/** The signed answer is the message content without the UI footer. */
export function answerTextOf(messageContent: string): string {
  const cut = messageContent.lastIndexOf(ANSWER_FOOTER_SEPARATOR);
  return cut === -1 ? messageContent : messageContent.slice(0, cut);
}

export function shortReceiptId(id: string): string {
  return id.slice(0, 8);
}
