import type { InputRequest } from "@scholaraio-hub/shared";
import { useMutation } from "@tanstack/react-query";
import { Bell, Check, PenLine, X } from "lucide-react";
import { useState } from "react";
import { sessionApi } from "../../../core/library";
import { toolSummary } from "./renderers/registry";

/**
 * Floating approval panel from the pre-refactor session page. Tool approvals offer
 * Approve / Approve + Accept Edits / Deny; AskUserQuestion-style requests render
 * their questions and submit the answers with an approval.
 */
export function InputRequestPanel({
  request,
  sessionId,
  onDone,
}: { request: InputRequest; sessionId: string; onDone: () => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const mutation = useMutation({
    mutationFn: (decision: "approve" | "approve_accept_edits" | "deny") =>
      sessionApi.input(sessionId, request.id, decision, answers),
    onSuccess: onDone,
  });
  const data =
    request.toolInput && typeof request.toolInput === "object"
      ? (request.toolInput as Record<string, unknown>)
      : {};
  const questions = Array.isArray(data.questions)
    ? (data.questions as {
        question: string;
        options?: { label: string; description?: string }[];
        /** Codex marks answers such as tokens as secret: never shown as typed. */
        secret?: boolean;
      }[])
    : [];
  const summary = request.toolName
    ? `${request.toolName} ${toolSummary(request.toolName, request.toolInput)}`
    : request.prompt;
  return (
    <div className="tool-approval-fixed" role="presentation">
      <div className="tool-approval-panel" role="alert" aria-live="assertive">
        <div className="tool-approval-header">
          <Bell className="tool-approval-icon" aria-hidden="true" />
          <span className="tool-approval-question" title={request.prompt || summary}>
            {questions.length ? request.prompt || request.toolName : summary}
          </span>
        </div>
        {questions.length ? (
          <div className="space-y-2 mb-2 max-h-[30dvh] overflow-auto">
            {questions.map((question, index) => (
              <label key={question.question} className="block text-sm">
                {question.question}
                <input
                  className="hub-input block w-full mt-1"
                  type={question.secret ? "password" : "text"}
                  autoComplete={question.secret ? "off" : undefined}
                  // Suggestions would reveal choices next to a masked field; secrets get none.
                  list={question.secret ? undefined : `options-${request.id}-${index}`}
                  value={answers[question.question] ?? ""}
                  onChange={(event) =>
                    setAnswers((previous) => ({
                      ...previous,
                      [question.question]: event.target.value,
                    }))
                  }
                />
                {question.secret ? null : (
                  <datalist id={`options-${request.id}-${index}`}>
                    {question.options?.map((option) => (
                      <option key={option.label} value={option.label}>
                        {option.description}
                      </option>
                    ))}
                  </datalist>
                )}
              </label>
            ))}
          </div>
        ) : null}
        <div className="tool-approval-options">
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate("approve")}
            className="tool-approval-option primary"
          >
            <Check size={13} aria-hidden="true" />
            {questions.length ? "Submit" : "Approve"}
          </button>
          {questions.length ? null : (
            <button
              type="button"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate("approve_accept_edits")}
              className="tool-approval-option"
            >
              <PenLine size={13} aria-hidden="true" />
              Approve + Accept Edits
            </button>
          )}
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate("deny")}
            className="tool-approval-option danger"
          >
            <X size={13} aria-hidden="true" />
            Deny
          </button>
        </div>
        {mutation.error ? (
          <p role="alert" className="text-error text-xs mt-2">
            {mutation.error.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
