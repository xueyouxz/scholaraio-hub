import type { InputRequest } from "@scholaraio-hub/shared";
import { useMutation } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { useState } from "react";
import { sessionApi } from "../../../core/sessions";
import { Markdown } from "../../../shared/components/Markdown";
import { rendererFor, toolSummary } from "./renderers/registry";
import { field } from "./renderers/types";

type Decision = "approve" | "approve_accept_edits" | "deny";

interface Question {
  question: string;
  header?: string;
  options: { label: string; description?: string }[];
  /** Codex marks answers such as tokens as secret: never shown as typed. */
  secret: boolean;
}

/** AskUserQuestion input, the shape both providers' questions arrive in. */
function questionsOf(request: InputRequest): Question[] {
  const list = (request.toolInput as { questions?: unknown } | undefined)?.questions;
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) => {
    const question = field(entry, "question");
    if (!question) return [];
    const options = (entry as { options?: unknown }).options;
    return [
      {
        question,
        header: field(entry, "header") || undefined,
        options: Array.isArray(options)
          ? options.flatMap((option) =>
              field(option, "label")
                ? [{ label: field(option, "label"), description: field(option, "description") }]
                : [],
            )
          : [],
        secret: (entry as { secret?: unknown }).secret === true,
      },
    ];
  });
}

/**
 * A decision the agent is waiting on: questions to answer, a plan to approve,
 * or a tool call to allow. `inline` asks on the row of the call it is about,
 * the way Claude Code asks in the transcript; `floating` pins the same prompt
 * over the transcript when that row is not on screen.
 */
export function InputRequestPrompt({
  request,
  sessionId,
  placement,
  onDone,
}: {
  request: InputRequest;
  sessionId: string;
  placement: "inline" | "floating";
  onDone: () => void;
}) {
  const form = <DecisionForm request={request} sessionId={sessionId} onDone={onDone} />;
  if (placement === "inline") return form;
  // Away from its row, say which call this is about.
  const title = request.toolName
    ? `${request.toolName} ${toolSummary(request.toolName, request.toolInput)}`.trim()
    : request.prompt;
  return (
    <div className="tool-approval-fixed" role="presentation">
      <div className="tool-approval-panel" role="alert" aria-live="assertive">
        <div className="tool-approval-header">
          <Bell className="tool-approval-icon" aria-hidden="true" />
          <span className="tool-approval-question" title={title}>
            {title}
          </span>
        </div>
        {form}
      </div>
    </div>
  );
}

function DecisionForm({
  request,
  sessionId,
  onDone,
}: {
  request: InputRequest;
  sessionId: string;
  onDone: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const decide = useMutation({
    mutationFn: (decision: Decision) => sessionApi.input(sessionId, request.id, decision, answers),
    onSuccess: onDone,
  });
  const busy = decide.isPending;
  const button = (decision: Decision, label: string, primary = false) => (
    <button
      type="button"
      className={`inline-decision${primary ? " inline-decision-primary" : ""}`}
      disabled={busy}
      onClick={() => decide.mutate(decision)}
    >
      {label}
    </button>
  );
  const failure = decide.error ? (
    <p role="alert" className="text-error text-xs">
      {decide.error.message}
    </p>
  ) : null;

  const questions = questionsOf(request);
  if (questions.length) {
    const answer = (question: string, value: string) =>
      setAnswers((current) => ({ ...current, [question]: value }));
    const complete = questions.every((question) => answers[question.question]?.trim());
    return (
      <fieldset className="inline-input" aria-label="Agent question">
        {questions.map((question) => (
          <fieldset key={question.question} className="inline-question">
            <legend>
              {question.header ? (
                <span className="inline-question-header">{question.header}</span>
              ) : null}
              {question.question}
            </legend>
            {/* Choices shown next to a masked field would give the secret away. */}
            {question.options.length && !question.secret ? (
              <div className="inline-question-options">
                {question.options.map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    className="inline-option"
                    aria-pressed={answers[question.question] === option.label}
                    title={option.description || undefined}
                    onClick={() => answer(question.question, option.label)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
            <input
              className="inline-question-text"
              type={question.secret ? "password" : "text"}
              autoComplete={question.secret ? "off" : undefined}
              aria-label={question.question}
              placeholder={
                question.options.length && !question.secret ? "Or type an answer" : "Type an answer"
              }
              value={answers[question.question] ?? ""}
              onChange={(event) => answer(question.question, event.target.value)}
            />
          </fieldset>
        ))}
        <div className="inline-decisions">
          <button
            type="button"
            className="inline-decision inline-decision-primary"
            disabled={busy || !complete}
            onClick={() => decide.mutate("approve")}
          >
            Submit
          </button>
          {button("deny", "Skip")}
        </div>
        {failure}
      </fieldset>
    );
  }

  if (request.toolName === "ExitPlanMode") {
    return (
      <fieldset className="inline-input" aria-label="Plan approval">
        <Markdown
          text={field(request.toolInput, "plan")}
          className="session-markdown inline-plan"
        />
        <div className="inline-decisions">
          {button("approve_accept_edits", "Yes, and auto-accept edits", true)}
          {button("approve", "Yes, approve each edit")}
          {button("deny", "No, keep planning")}
        </div>
        {failure}
      </fieldset>
    );
  }

  // Accepting edits from here on only means something for a call that edits files.
  const editsFiles = !!request.toolName && !!rendererFor(request.toolName).fileChanges;
  return (
    <fieldset className="inline-input" aria-label="Permission request">
      <p className="inline-input-prompt">Allow this {request.toolName ?? "action"}?</p>
      <div className="inline-decisions">
        {button("approve", "Allow", true)}
        {editsFiles ? button("approve_accept_edits", "Allow and accept edits") : null}
        {button("deny", "Deny")}
      </div>
      {failure}
    </fieldset>
  );
}
